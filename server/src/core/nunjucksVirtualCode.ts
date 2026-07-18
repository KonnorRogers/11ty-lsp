import type { CodeInformation, CodeMapping, LanguagePlugin, VirtualCode } from "@volar/language-core"
// Augments `LanguagePlugin` with the `typescript` field used below — needed
// purely for its module-augmentation side effect (see @volar/typescript's
// index.d.ts).
import type {} from "@volar/typescript"
import type * as nodes from "nunjucks/src/nodes.js"
import * as ts from "typescript"
import { getLanguageService as getHTMLLanguageService } from "vscode-html-languageservice"
import { TextDocument } from "vscode-languageserver-textdocument"
import type { URI } from "vscode-uri"
import { getDocumentRegions } from "../embeddedSupport"
import { jsonValueToTsType } from "./jsonToTsType"
import { NunjucksExtension, NunjucksParser } from "./nunjucksParser"

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const DATA_VAR = "data"

interface Segment {
  /** offset into the original Nunjucks document */
  sourceOffset: number
  /** length of the corresponding span in the original document */
  sourceLength: number
  /** offset into the transcribed expression text (relative, 0-based) */
  generatedOffset: number
  /** length of the corresponding span in the transcribed expression text */
  generatedLength: number
}

interface Transcribed {
  /** e.g. `data.obj.a.b.c.d` */
  text: string
  segments: Segment[]
}

/**
 * Transcribes a `Symbol` or `LookupVal` chain (`{{ obj.a.b }}`) into a TS
 * member-access expression on the synthesized `data` const, producing one
 * `Segment` per dotted/bracketed piece so hover/completion on any individual
 * segment maps back to the exact source range for that piece — not the
 * whole chain at once.
 */
function transcribeChain(node: nodes.AnyNode, document: TextDocument): Transcribed | null {
  if (node.typename === "Symbol") {
    const sourceOffset = document.offsetAt({ line: node.lineno, character: node.colno })
    const prefix = `${DATA_VAR}.`
    return {
      text: prefix + node.value,
      segments: [{
        sourceOffset,
        sourceLength: node.value.length,
        generatedOffset: prefix.length,
        generatedLength: node.value.length,
      }],
    }
  }

  if (node.typename === "LookupVal") {
    const target = transcribeChain(node.target as nodes.AnyNode, document)
    if (!target) return null

    // `val`'s declared type (`Token & { value: unknown }`) doesn't expose
    // `typename`, but at runtime it's a real AST node — cast to check it.
    const keyNode = node.val as unknown as nodes.AnyNode
    // Computed member access (`obj[someVar]`) parses `val` as a `Symbol`
    // (a variable reference), not a static string key — v1 only supports
    // static dotted/bracket access, so bail out.
    if (keyNode.typename !== "Literal" || typeof keyNode.value !== "string") {
      return null
    }

    const key = keyNode.value
    const isIdentifier = IDENTIFIER_RE.test(key)
    const memberText = isIdentifier ? `.${key}` : `[${JSON.stringify(key)}]`

    // `node.colno` is the position of the member-access token itself (the
    // `.` or `[`), and `keyNode.colno` is the position of the key text —
    // together they bound the full source span for this one segment.
    const dotOffset = document.offsetAt({ line: node.lineno, character: node.colno })
    const keyOffset = document.offsetAt({ line: keyNode.lineno, character: keyNode.colno })
    const sourceLength = (keyOffset - dotOffset) + key.length

    return {
      text: target.text + memberText,
      segments: [
        ...target.segments,
        {
          sourceOffset: dotOffset,
          sourceLength,
          generatedOffset: target.text.length,
          generatedLength: memberText.length,
        },
      ],
    }
  }

  return null
}

/** Names bound by an enclosing `{% for %}` — not real `data` properties. */
function forLoopBoundNames(nameNode: nodes.AnyNode): string[] {
  if (nameNode.typename === "Symbol") return [nameNode.value]
  // `{% for key, value in obj %}` parses `name` as an Array of Symbols.
  if ("children" in nameNode) {
    return (nameNode.children as nodes.AnyNode[])
      .filter((c): c is nodes.Symbol => c.typename === "Symbol")
      .map((c) => c.value)
  }
  return []
}

function rootSymbolName(node: nodes.AnyNode): string | null {
  if (node.typename === "Symbol") return node.value
  if (node.typename === "LookupVal") return rootSymbolName(node.target as nodes.AnyNode)
  return null
}

/**
 * Walks the whole AST once, emitting a transcribed statement for every
 * top-level `Symbol`/`LookupVal` chain found anywhere (output expressions,
 * `{% if %}` tests, the iterable side of `{% for %}`, filter targets, etc.) —
 * we don't need to model Nunjucks operators/filters as TS, since we only
 * care about type-checking the underlying data-access sub-expressions
 * wherever they occur.
 *
 * Symbols bound by an enclosing `{% for %}` are skipped rather than
 * mistyped: loop-variable typing is deferred (see plan).
 */
function collectExpressions(node: unknown, document: TextDocument, bound: ReadonlySet<string>, out: Transcribed[]): void {
  if (node == null || typeof node !== "object") return

  if (Array.isArray(node)) {
    for (const item of node) collectExpressions(item, document, bound, out)
    return
  }

  const n = node as nodes.AnyNode

  if (n.typename === "Symbol" || n.typename === "LookupVal") {
    const rootName = rootSymbolName(n)
    if (rootName != null && !bound.has(rootName)) {
      const transcribed = transcribeChain(n, document)
      if (transcribed) {
        out.push(transcribed)
        // Fully consumed as one chain — don't also descend into
        // `target`/`val` as separate top-level chains.
        return
      }
    }
    // Couldn't transcribe the whole chain (loop-bound root, or a computed
    // `obj[expr]` access) — fall through and look for independently
    // resolvable data-access sub-expressions nested inside it (e.g. `obj`
    // and `key` in `obj[key]`).
  }

  if (n.typename === "For") {
    // `For`'s fields aren't declared as real properties in the local
    // nunjucks type overrides (only `.fields` is), so read dynamically.
    const forNode = n as unknown as Record<"arr" | "name" | "body" | "else_", nodes.AnyNode | null>
    collectExpressions(forNode.arr, document, bound, out)
    const nested = new Set(bound)
    for (const name of forLoopBoundNames(forNode.name as nodes.AnyNode)) nested.add(name)
    collectExpressions(forNode.body, document, nested, out)
    if (forNode.else_) collectExpressions(forNode.else_, document, bound, out)
    return
  }

  for (const field of (n as unknown as { fields?: string[] }).fields ?? []) {
    collectExpressions((n as any)[field], document, bound, out)
  }
}

/**
 * Matches a dangling member-access dot with nothing typed after it yet
 * (`{{ page. }}`, mid-typing) — capturing the run of same-line whitespace
 * between the dot and the tag's closing delimiter.
 */
const DANGLING_DOT_RE = /\.([ \t]+)(?=-?(?:%\}|\}\}))/g

/**
 * Nunjucks's parser throws on a dangling `.` with nothing after it, and
 * gives up on the *rest of the document* too (see `safeParseAsRoot`) — so
 * without this, typing `{{ page. }}` loses completions not just for that
 * expression but for everything after it. Substituting the first
 * whitespace character after such a dot with a placeholder identifier
 * makes it parse as a (throwaway) property access instead. This is a
 * same-length substitution, so every other node's position in the document
 * is completely unaffected, and TS completion at that position — which
 * still maps back to right after the real dot — lists real members of
 * whatever came before it regardless of the placeholder's name.
 *
 * Only handles same-line whitespace (`[ \t]+`, not `\n`) deliberately: were
 * the run to include a newline, swapping it out would change the line
 * count from that point on and corrupt every subsequent position instead.
 * `{{ page.\n}}` (dangling dot, closing tag on the next line) is left
 * unpatched rather than risking that.
 */
function patchDanglingMemberAccess(text: string): string {
  return text.replace(DANGLING_DOT_RE, (_match, whitespace: string) => `.x${whitespace.slice(1)}`)
}

export function buildNunjucksTypeScriptSource(
  documentText: string,
  data: unknown,
  extensions?: NunjucksExtension[]
): { text: string; mappings: CodeMapping[] } {
  // Positions are computed against the *original* text — the patch below
  // never changes length or line breaks, so they stay valid either way.
  const document = TextDocument.create("untitled:nunjucks", "njk", 0, documentText)
  const parser = new NunjucksParser({})
  const { ast } = parser.parseContent(patchDanglingMemberAccess(documentText), extensions)

  const dataType = data === undefined ? "unknown" : jsonValueToTsType(data)
  let generated = `declare const ${DATA_VAR}: ${dataType};\n`
  const mappings: CodeMapping[] = []

  const expressions: Transcribed[] = []
  collectExpressions(ast, document, new Set(), expressions)

  for (const expr of expressions) {
    const statementStart = generated.length
    generated += `(${expr.text});\n`
    const exprOffsetInStatement = 1 // leading "("

    for (const seg of expr.segments) {
      mappings.push({
        sourceOffsets: [seg.sourceOffset],
        generatedOffsets: [statementStart + exprOffsetInStatement + seg.generatedOffset],
        lengths: [seg.sourceLength],
        generatedLengths: [seg.generatedLength],
        data: {
          completion: true,
          // hover, go-to-definition, inlay hints, etc.
          semantic: true,
          navigation: true,
          // these expressions are synthetic statements the source never
          // actually contains, so TS diagnostics on them wouldn't make sense
          // to report back onto the template.
          verification: false,
          structure: false,
          format: false,
        } satisfies CodeInformation,
      })
    }
  }

  return { text: generated, mappings }
}

class StringScriptSnapshot implements ts.IScriptSnapshot {
  constructor(private text: string) {}
  getText(start: number, end: number): string { return this.text.slice(start, end) }
  getLength(): number { return this.text.length }
  getChangeRange(): undefined { return undefined }
}

const fullCapabilities: CodeInformation = {
  verification: true,
  completion: true,
  semantic: true,
  navigation: true,
  structure: true,
  format: true,
}

/** A single mapping covering the whole document 1:1 (same offsets both sides). */
function identityMapping(length: number): CodeMapping {
  return {
    sourceOffsets: [0],
    generatedOffsets: [0],
    lengths: [length],
    data: fullCapabilities,
  }
}

/**
 * The synthesized `declare const data: ...; (data.obj.a); ...` embedded
 * code, so `volar-service-typescript` can drive completion/hover for
 * Nunjucks data expressions with a real `ts.LanguageService`.
 */
export class NunjucksTsVirtualCode implements VirtualCode {
  id = "nunjucks-data-ts"
  languageId = "typescript"
  mappings: CodeMapping[] = []
  snapshot: ts.IScriptSnapshot = new StringScriptSnapshot("")

  update(documentText: string, data: unknown, extensions?: NunjucksExtension[]) {
    const { text, mappings } = buildNunjucksTypeScriptSource(documentText, data, extensions)
    this.snapshot = new StringScriptSnapshot(text)
    this.mappings = mappings
  }
}

const htmlLanguageService = getHTMLLanguageService()

/**
 * Nunjucks templates are HTML with `{{ }}`/`{% %}` sprinkled in, so — same
 * as the old hand-rolled `htmlMode.ts` — we just hand `volar-service-html`
 * the raw document text as-is (1:1 identity mapping) and let its parser
 * tolerate the extra syntax.
 */
export class HtmlMirrorVirtualCode implements VirtualCode {
  id = "nunjucks-html"
  languageId = "html"
  mappings: CodeMapping[] = []
  snapshot: ts.IScriptSnapshot = new StringScriptSnapshot("")

  update(documentText: string) {
    this.snapshot = new StringScriptSnapshot(documentText)
    this.mappings = [identityMapping(documentText.length)]
  }
}

/**
 * Everything outside `<style>`/`style="..."` is replaced with whitespace
 * (preserving length and line breaks — see `embeddedSupport.ts`), so the
 * generated CSS text lines up character-for-character with the source.
 *
 * Mapping the *whole* document 1:1 (like the html code below) would be
 * wrong here though: `volar-service-css` treats blanked-out whitespace as a
 * valid, empty stylesheet and happily returns generic completions
 * (at-rules, pseudo-classes, ...) for it. Volar's completion aggregation
 * lets the first embedded code that returns any non-empty completion list
 * "claim" the request and skips the rest — so that CSS noise would block
 * real completions (e.g. from the TS data code) everywhere outside actual
 * style regions. Mapping only the real `<style>`/`style="..."` spans keeps
 * the CSS service silent everywhere else, same as the old `cssMode.ts`.
 */
export class CssRegionVirtualCode implements VirtualCode {
  id = "nunjucks-css"
  languageId = "css"
  mappings: CodeMapping[] = []
  snapshot: ts.IScriptSnapshot = new StringScriptSnapshot("")

  update(documentText: string) {
    const document = TextDocument.create("untitled:nunjucks", "html", 0, documentText)
    const regions = getDocumentRegions(htmlLanguageService, document)
    const cssText = regions.getEmbeddedDocument("css").getText()
    this.snapshot = new StringScriptSnapshot(cssText)

    const fullRange = { start: document.positionAt(0), end: document.positionAt(documentText.length) }
    this.mappings = regions
      .getLanguageRanges(fullRange)
      .filter((range) => range.languageId === "css")
      .map((range): CodeMapping => {
        const start = document.offsetAt(range.start)
        const end = document.offsetAt(range.end)
        // The whited-out CSS snapshot preserves offsets 1:1 with the
        // source, so the same numeric offset works on both sides.
        return { sourceOffsets: [start], generatedOffsets: [start], lengths: [end - start], data: fullCapabilities }
      })
  }
}

export class NunjucksRootVirtualCode implements VirtualCode {
  id = "root"
  languageId = "nunjucks"
  mappings: CodeMapping[] = []
  snapshot: ts.IScriptSnapshot = new StringScriptSnapshot("")
  embeddedCodes: VirtualCode[]

  private html = new HtmlMirrorVirtualCode()
  private css = new CssRegionVirtualCode()
  private data = new NunjucksTsVirtualCode()

  constructor() {
    this.embeddedCodes = [this.html, this.css, this.data]
  }

  update(documentText: string, data: unknown, extensions?: NunjucksExtension[]) {
    this.snapshot = new StringScriptSnapshot(documentText)
    this.mappings = [identityMapping(documentText.length)]

    this.html.update(documentText)
    this.css.update(documentText)
    this.data.update(documentText, data, extensions)
  }
}

/**
 * `getData`/`getExtensions` are looked up per-document (keyed by the same
 * 11ty config resolution `server.ts` already does via `getDataForFile`), so
 * the plugin doesn't need to know anything about 11ty itself — it's just
 * handed the current data snapshot and the project's real registered
 * nunjucks tags/shortcodes for a given file.
 */
export function createNunjucksLanguagePlugin(
  getData: (uri: URI) => unknown,
  getExtensions: (uri: URI) => NunjucksExtension[] | undefined
): LanguagePlugin<URI, NunjucksRootVirtualCode> {
  return {
    getLanguageId(uri) {
      if (/\.(njk|nunjucks|jinja|html)(\.|$)/.test(uri.path)) {
        return "nunjucks"
      }
      return undefined
    },
    // Without this, the TS project machinery has no way to know that one
    // of our embedded codes is an actual TypeScript file it should include
    // in a real `ts.Program` — completion/hover on it would silently come
    // back empty.
    typescript: {
      extraFileExtensions: [],
      getServiceScript(root) {
        const tsCode = root.embeddedCodes?.find((code) => code.id === "nunjucks-data-ts")
        if (!tsCode) return undefined
        return {
          code: tsCode,
          extension: ".ts",
          scriptKind: ts.ScriptKind.TS,
        }
      },
    },
    createVirtualCode(uri, languageId, snapshot) {
      if (languageId !== "nunjucks") return undefined
      const code = new NunjucksRootVirtualCode()
      const text = snapshot.getText(0, snapshot.getLength())
      code.update(text, getData(uri), getExtensions(uri))
      return code
    },
    updateVirtualCode(uri, virtualCode, newSnapshot) {
      const text = newSnapshot.getText(0, newSnapshot.getLength())
      virtualCode.update(text, getData(uri), getExtensions(uri))
      return virtualCode
    },
  }
}
