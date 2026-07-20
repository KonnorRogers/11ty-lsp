import type { CodeInformation, CodeMapping, LanguagePlugin, VirtualCode } from "@volar/language-core"
import { forEachEmbeddedCode } from "@volar/language-core"
import type * as nodes from "nunjucks/src/nodes.js"
import * as ts from "typescript"
import type { TypeScriptExtraServiceScript } from '@volar/typescript';
import { getLanguageService as getHTMLLanguageService } from "vscode-html-languageservice"
import * as html from 'vscode-html-languageservice';
import { TextDocument } from "vscode-languageserver-textdocument"
import type { URI } from "vscode-uri"
import { getDocumentRegions } from "../embeddedSupport"
import { jsonValueToTsType } from "./jsonToTsType"
import { NunjucksExtension, NunjucksParser } from "./nunjucksParser"
import * as lexer from "nunjucks/src/lexer.js";
import { NEW_LINE_WITH_CAPTURE_GROUP } from "../constants";
import { buildFiltersDeclaration, FILTERS_VAR } from "./builtinFilters";

// Regex of if the word is a proper key. non-spaces and "_" or "-" are all valid.
const IDENTIFIER_RE = /^(\S|_|-)*$/
// A member name we can emit as `x.name` rather than `x["name"]`.
const JS_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const DATA_VAR = "data"
// Sentinel we insert after "." to not break parsing.
export const SENTINEL = "__COMPLETION__"

interface Tok {
  type: string
  value: string
  start: number  // absolute offset in source
  end: number    // absolute offset just past the token
}

interface Segment {
  /** offset into the original Nunjucks document */
  sourceOffset: number
  /** length of the corresponding span in the original document */
  sourceLength: number
  /** offset into the transcribed expression text (relative, 0-based) */
  generatedOffset: number
  /** length of the corresponding span in the transcribed expression text */
  generatedLength: number
  /**
   * Whether TS completion may fire through this segment. Defaults to `true`.
   * A filter *name* maps here only for hover/go-to — filter-name completion is
   * owned by the service plugin (which knows the project's custom filters),
   * so this is `false` for those segments.
   */
  completion?: boolean
}

interface Transcribed {
  /** e.g. `data.obj.a.b.c.d` */
  text: string
  segments: Segment[]
}

export interface Insertion {
  /** offset in the ORIGINAL text where synthetic text was inserted */
  sourceOffset: number
  /** length of the inserted text (must contain no newlines) */
  length: number
}

export interface PatchedText {
  text: string
  /** sorted ascending by sourceOffset */
  insertions: Insertion[]
}

function applyInsertions(
  original: string,
  edits: Array<{ offset: number; text: string }>
): PatchedText {
  const sorted = [...edits].sort((a, b) => a.offset - b.offset)
  const insertions: Insertion[] = []
  let out = ""
  let last = 0
  for (const e of sorted) {
    out += original.slice(last, e.offset) + e.text
    insertions.push({ sourceOffset: e.offset, length: e.text.length })
    last = e.offset
  }
  return { text: out + original.slice(last), insertions }
}

/** patched offset -> original offset; null if the offset is inside synthetic text */
export function toSourceOffset(p: PatchedText, generatedOffset: number): number | null {
  let delta = 0
  for (const ins of p.insertions) {
    const genStart = ins.sourceOffset + delta
    if (generatedOffset < genStart) break
    if (generatedOffset < genStart + ins.length) return null
    delta += ins.length
  }
  return generatedOffset - delta
}

/**
 * Same, but offsets inside synthetic text collapse onto the point the text
 * was inserted at rather than returning null.
 *
 * This is what mapping wants. Nunjucks parses the *patched* text, so every
 * AST node's line/col is in patched coordinates, but `CodeMapping`s have to
 * be expressed against the original document or they point at the wrong
 * characters — or, for a sentinel at EOF, off the end of the document
 * entirely. Collapsing falls out usefully: `{{ page.` transcribes to a
 * segment spanning `.__COMPLETION__`, whose end collapses back onto the
 * real `.`, leaving a 1-char source span over the dot the user typed. TS
 * still sees the full `.__COMPLETION__` on the generated side, so
 * completion just after the dot lists the real members of `page`.
 */
export function toSourceOffsetClamped(p: PatchedText, generatedOffset: number): number {
  let delta = 0
  for (const ins of p.insertions) {
    const genStart = ins.sourceOffset + delta
    if (generatedOffset < genStart) break
    if (generatedOffset < genStart + ins.length) return ins.sourceOffset
    delta += ins.length
  }
  return generatedOffset - delta
}

interface Lexed {
  tokens: Tok[]
  tags: _Tokenizer["tags"]
  /** lexer threw partway — everything after the last token is unlexed */
  truncated: boolean
}

function tokenize(src: string, opts?: object): Lexed {
  const tokenizer = lexer.lex(src, opts)
  const tokens: Tok[] = []
  let truncated = false
  try {
    while (true) {
      const start = tokenizer.index
      const token = tokenizer.nextToken()
      if (!token) {
        break
      }
      tokens.push({ type: token.type, value: token.value, start, end: tokenizer.index })
    }
  } catch {
    // Unterminated string or comment, stray char. Keep what we got.
    truncated = true
  }
  return { tokens, tags: tokenizer.tags, truncated }
}

/**
 * Transcribes a template expression into a TypeScript expression against the
 * synthesized `data` / `__filters` declarations, producing one `Segment` per
 * meaningful piece so hover/completion on any individual piece maps back to
 * its exact source range — not the whole expression at once.
 *
 * Handles the data-access chains (`{{ obj.a.b }}`) that carry the data types,
 * the filters (`{{ x | join(",") }}`) that carry filter types and propagate
 * their return type, and the literals that appear as filter arguments.
 * Anything it doesn't model returns `null`, and the caller falls back to
 * pulling typeable sub-expressions out of it.
 *
 * `bound` are names introduced by an enclosing `{% for %}` — they aren't
 * `data` properties, so a chain rooted at one can't be transcribed (loop
 * variable typing is deferred); returning `null` for it lets the caller skip
 * it rather than emit a bogus `data.item`.
 */
function transcribeExpr(node: nodes.AnyNode, document: TextDocument, patched: PatchedText, bound: ReadonlySet<string>): Transcribed | null {
  switch (node.typename) {
    case "Symbol": return transcribeSymbol(node, document, patched, bound)
    case "LookupVal": return transcribeLookup(node, document, patched, bound)
    case "Literal": return transcribeLiteral(node)
    case "Filter":
    case "FilterAsync": return transcribeFilter(node, document, patched, bound)
    case "Group": {
      // A parenthesized single expression, e.g. `(items | first)` in
      // `(items | first).name`.
      const children = (node as unknown as { children?: nodes.AnyNode[] }).children
      return children?.length === 1 ? transcribeExpr(children[0], document, patched, bound) : null
    }
    default: return null
  }
}

function transcribeSymbol(node: nodes.AnyNode, document: TextDocument, patched: PatchedText, bound: ReadonlySet<string>): Transcribed | null {
  const name = (node as nodes.Symbol).value
  if (bound.has(name)) return null
  const start = document.offsetAt({ line: node.lineno, character: node.colno })
  const sourceOffset = toSourceOffsetClamped(patched, start)
  const prefix = `${DATA_VAR}.`
  return {
    text: prefix + name,
    segments: [{
      sourceOffset,
      // A wholly synthetic symbol (the sentinel in `{{ }}`) collapses to a
      // zero-length source range at the point we inserted it, which is
      // exactly where the caret sits.
      sourceLength: toSourceOffsetClamped(patched, start + name.length) - sourceOffset,
      generatedOffset: prefix.length,
      generatedLength: name.length,
    }],
  }
}

function transcribeLookup(node: nodes.AnyNode, document: TextDocument, patched: PatchedText, bound: ReadonlySet<string>): Transcribed | null {
  const lookup = node as unknown as { target: nodes.AnyNode; val: nodes.AnyNode }
  const target = transcribeExpr(lookup.target, document, patched, bound)
  if (!target) {
    return null
  }

  // `val`'s declared type (`Token & { value: unknown }`) doesn't expose
  // `typename`, but at runtime it's a real AST node — cast to check it.
  const keyNode = lookup.val as unknown as nodes.AnyNode
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
  // Both ends go through the mapper: for a real key this is unchanged,
  // and for a sentinel key the end collapses back onto the dot, leaving a
  // 1-char source span over the `.` the user actually typed.
  const sourceOffset = toSourceOffsetClamped(patched, dotOffset)
  const sourceLength = toSourceOffsetClamped(patched, keyOffset + key.length) - sourceOffset

  return {
    text: target.text + memberText,
    segments: [
      ...target.segments,
      {
        sourceOffset,
        sourceLength,
        generatedOffset: target.text.length,
        generatedLength: memberText.length,
      },
    ],
  }
}

/** A literal filter argument (`{{ x | join(", ") }}`) — no source mapping needed. */
function transcribeLiteral(node: nodes.AnyNode): Transcribed {
  const value = (node as nodes.Literal).value
  let text: string
  if (typeof value === "string") text = JSON.stringify(value)
  else if (typeof value === "number" || typeof value === "boolean") text = String(value)
  else if (value === null) text = "null"
  else text = "(undefined as any)"
  return { text, segments: [] }
}

/**
 * `{{ x | join(", ") }}` -> `__filters.join(data.x, ", ")`. Nunjucks already
 * models a filter as a call whose first argument is the piped value, so the
 * transcription is a direct rewrite, and the built-in filter types (see
 * `builtinFilters.ts`) give the call — and everything downstream of it — a
 * real return type.
 */
function transcribeFilter(node: nodes.AnyNode, document: TextDocument, patched: PatchedText, bound: ReadonlySet<string>): Transcribed | null {
  const filter = node as unknown as { name?: nodes.AnyNode; args?: { children?: nodes.AnyNode[] } }
  const nameNode = filter.name
  const name = nameNode?.typename === "Symbol" ? (nameNode as nodes.Symbol).value : undefined
  const children = filter.args?.children ?? []
  if (typeof name !== "string" || children.length === 0) {
    return null
  }

  // The piped value is the first argument; if it can't be transcribed (e.g. a
  // loop-bound root) we can't type the call meaningfully, so bail and let the
  // caller pull data chains out of the args instead.
  const input = transcribeExpr(children[0], document, patched, bound)
  if (!input) {
    return null
  }
  const rest = children.slice(1).map(
    (arg) => transcribeExpr(arg, document, patched, bound) ?? { text: "(undefined as any)", segments: [] as Segment[] }
  )

  const usesDot = JS_IDENTIFIER_RE.test(name)
  const access = usesDot ? `${FILTERS_VAR}.${name}` : `${FILTERS_VAR}[${JSON.stringify(name)}]`

  const segments: Segment[] = []
  if (usesDot && nameNode) {
    // Map the source filter name onto the generated member for hover/go-to,
    // but leave completion to the service plugin (see `Segment.completion`).
    const start = document.offsetAt({ line: nameNode.lineno, character: nameNode.colno })
    const sourceOffset = toSourceOffsetClamped(patched, start)
    segments.push({
      sourceOffset,
      sourceLength: toSourceOffsetClamped(patched, start + name.length) - sourceOffset,
      generatedOffset: FILTERS_VAR.length + 1, // just past `__filters.`
      generatedLength: name.length,
      completion: false,
    })
  }

  let text = `${access}(`
  const append = (part: Transcribed) => {
    const shift = text.length
    text += part.text
    for (const seg of part.segments) segments.push({ ...seg, generatedOffset: seg.generatedOffset + shift })
  }
  append(input)
  for (const arg of rest) {
    text += ", "
    append(arg)
  }
  text += ")"

  return { text, segments }
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
function collectExpressions(node: unknown, document: TextDocument, patched: PatchedText, bound: ReadonlySet<string>, out: Transcribed[]): void {
  if (node == null || typeof node !== "object") return

  if (Array.isArray(node)) {
    for (const item of node) {
      collectExpressions(item, document, patched, bound, out)
    }
    return
  }

  const n = node as nodes.AnyNode

  if (n.typename === "Symbol" || n.typename === "LookupVal") {
    const transcribed = transcribeExpr(n, document, patched, bound)
    if (transcribed) {
      out.push(transcribed)
      // Fully consumed as one chain — don't also descend into
      // `target`/`val` as separate top-level chains.
      return
    }
    // Couldn't transcribe the whole chain (loop-bound root, or a computed
    // `obj[expr]` access) — fall through and look for independently
    // resolvable data-access sub-expressions nested inside it (e.g. `obj`
    // and `key` in `obj[key]`).
  }

  // `{{ x | join(",") }}` becomes `__filters.join(data.x, ",")`, giving the
  // filter a real type and propagating its return type to anything wrapping
  // it. The filter name itself maps for hover only — completion of filter
  // names is the service plugin's job (it knows the project's own filters).
  if (n.typename === "Filter" || n.typename === "FilterAsync") {
    const transcribed = transcribeExpr(n, document, patched, bound)
    if (transcribed) {
      out.push(transcribed)
      return
    }
    // Couldn't type the whole filter (e.g. a loop-bound input) — pull any
    // typeable data chains out of its arguments instead.
    const filterNode = n as unknown as Record<"args", nodes.AnyNode | null>
    collectExpressions(filterNode.args, document, patched, bound, out)
    return
  }

  if (n.typename === "For") {
    // `For`'s fields aren't declared as real properties in the local
    // nunjucks type overrides (only `.fields` is), so read dynamically.
    const forNode = n as unknown as Record<"arr" | "name" | "body" | "else_", nodes.AnyNode | null>
    collectExpressions(forNode.arr, document, patched, bound, out)
    const nested = new Set(bound)
    for (const name of forLoopBoundNames(forNode.name as nodes.AnyNode)) nested.add(name)
    collectExpressions(forNode.body, document, patched, nested, out)
    if (forNode.else_) {
      collectExpressions(forNode.else_, document, patched, bound, out)
    }
    return
  }

  for (const field of (n as unknown as { fields?: string[] }).fields ?? []) {
    collectExpressions((n as any)[field], document, patched, bound, out)
  }
}

/**
 * Nunjucks's parser throws on a dangling `.` with nothing after it, on an
 * empty `{{ }}`, and on an unclosed tag — and gives up on the *rest of the
 * document* too (see `safeParseAsRoot`). So without this, typing `{{ page.`
 * loses completions not just for that expression but for everything after
 * it. Inserting a placeholder identifier (and, where needed, a synthetic
 * closer) makes it parse as a throwaway property access instead.
 *
 * The insertions change offsets, so the result carries the list of edits
 * with it — see `toSourceOffsetClamped` for mapping back to the original.
 */
export function patchDanglingMemberAccess(text: string, opts?: object): PatchedText {
  return applyInsertions(text, computeDanglingEdits(text, opts))
}

export function buildNunjucksTypeScriptSource(
  documentText: string,
  data: unknown,
  extensions?: NunjucksExtension[]
): { text: string; mappings: CodeMapping[] } {
  // The AST comes from the *patched* text, so node line/col are patched
  // coordinates and the document we resolve them against has to be the
  // patched one too. `transcribeChain` maps the resulting offsets back to
  // the original document via `toSourceOffsetClamped`.
  const patched = patchDanglingMemberAccess(documentText)
  const document = TextDocument.create("untitled:nunjucks", "njk", 0, patched.text)
  const parser = new NunjucksParser({})
  const { ast } = parser.parseContent(patched.text, extensions)

  const dataType = data === undefined ? "unknown" : jsonValueToTsType(data)
  let generated = `declare const ${DATA_VAR}: ${dataType};\n`
  // Filter types are shared and source-independent, so the same declaration is
  // prepended to every synthesized file. Nothing maps back to it.
  generated += buildFiltersDeclaration()
  const mappings: CodeMapping[] = []

  const expressions: Transcribed[] = []
  collectExpressions(ast, document, patched, new Set(), expressions)

  for (const expr of expressions) {
    const statementStart = generated.length
    generated += `(${expr.text});\n`
    const exprOffsetInStatement = 1 // leading "("

    for (const seg of expr.segments) {
      const generatedOffset = statementStart + exprOffsetInStatement + seg.generatedOffset

      if (seg.sourceLength === 0) {
        // A wholly synthetic symbol — the sentinel standing in for an empty
        // `{{ }}`. It collapses to a zero-length source range at the point we
        // inserted it, but the caret can be anywhere in the surrounding
        // whitespace ("{{ | }}"), which a single zero-length mapping would
        // miss. Anchor one at every offset in that run instead; each lands
        // exactly at the sentinel's start in the generated text — i.e. just
        // after `data.`, where TS lists the top-level keys.
        let start = seg.sourceOffset
        while (start > 0 && (documentText[start - 1] === " " || documentText[start - 1] === "\t")) start--
        let end = seg.sourceOffset
        while (end < documentText.length && (documentText[end] === " " || documentText[end] === "\t")) end++

        const offsets: number[] = []
        for (let offset = start; offset <= end; offset++) offsets.push(offset)

        mappings.push({
          sourceOffsets: offsets,
          generatedOffsets: offsets.map(() => generatedOffset),
          lengths: offsets.map(() => 0),
          generatedLengths: offsets.map(() => seg.generatedLength),
          data: {
            completion: true,
            semantic: true,
            navigation: true,
            verification: false,
            structure: false,
            format: false,
          } satisfies CodeInformation,
        })
        continue
      }

      mappings.push({
        sourceOffsets: [seg.sourceOffset],
        generatedOffsets: [generatedOffset],
        lengths: [seg.sourceLength],
        generatedLengths: [seg.generatedLength],
        data: {
          // Filter-name segments opt out so the service plugin owns filter
          // completion; data segments default to on.
          completion: seg.completion ?? true,
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

  // Every template's synthesized file declares its own `data` — without
  // this, the file has no imports/exports, so TS treats it as a global
  // script rather than a module, and `declare const data` from every open
  // template ends up merged into one shared global scope. Whichever
  // template's declaration TS resolves first then "wins" for *all* of them,
  // so e.g. hovering `obj` in one template can show another template's data
  // shape. Forcing module scope via a top-level `export {}` gives each
  // synthesized file its own local `data`.
  generated += `export {};\n`

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
  document: html.HTMLDocument
  documentType: "html"
  embeddedCodes: VirtualCode[]

  constructor(public snapshot: ts.IScriptSnapshot) {
    this.snapshot = new StringScriptSnapshot("")
    this.mappings = [{
      sourceOffsets: [0],
      generatedOffsets: [0],
      lengths: [snapshot.getLength()],
      data: {
        completion: true,
        format: true,
        navigation: true,
        semantic: true,
        structure: true,
        verification: true,
      },
    }];

    // TODO: We don't always get handed an HTML document. We need to tolerate MD, JSON, etc.
    this.document = htmlLanguageService.parseHTMLDocument(
      html.TextDocument.create('', 'html', 0, snapshot.getText(0, snapshot.getLength()))
    );

    this.documentType = "html"

    if (this.documentType === "html") {
      this.embeddedCodes = [...getEmbeddedCodesForHTMLDocument(snapshot, this.document)];
    } else {
      this.embeddedCodes = []
    }
  }

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
  embeddedCodes: VirtualCode[]
  snapshot: ts.IScriptSnapshot

  private html = new HtmlMirrorVirtualCode()
  private css = new CssRegionVirtualCode()
  data: NunjucksTsVirtualCode

  constructor() {
    this.snapshot = new StringScriptSnapshot("")
    this.data = new NunjucksTsVirtualCode(this.snapshot)
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

/** Matches `.njk`, `.nunjucks`, `.jinja`, `.html`, and compound forms like `foo.jinja.html`. */
const NUNJUCKS_FILE_RE = /\.(njk|nunjucks|jinja|html|md)(\.|$)/

/**
 * LanguageIds editors report for these files beyond VS Code's own
 * "nunjucks" (from this project's `contributes.languages`).
 * Neovim sends its buffer's `filetype` option *verbatim* as the LSP languageId,
 * and users commonly set a compound filetype like `jinja.html` (stacking
 * "jinja" and "html" ftplugins/treesitter parsers) for better highlighting.
 * Example:
 * html.jinja, html+jinja, njk.html, you see where im going with this....
 */
const NUNJUCKS_LANGUAGE_IDS_RE = /(nunjucks|njk|jinja)/

/**
 * For an *opened* document, Volar calls `createVirtualCode` with whatever
 * languageId the client reported in `textDocument/didOpen` — verbatim, not
 * re-derived through `getLanguageId` below (that hook only covers files
 * resolved indirectly, e.g. via imports, that were never explicitly
 * opened). So matching only `languageId === "nunjucks"` here would silently
 * do nothing for a buffer Neovim opened as `jinja.html`, `jinja`, etc.,
 * even though the file itself is exactly the kind of file we handle —
 * checking the URI's own extension makes that independent of whatever
 * string a given editor/user setup happens to report.
 */
function isNunjucksDocument(uri: URI, languageId: string): boolean {
  return NUNJUCKS_FILE_RE.test(uri.path) || NUNJUCKS_LANGUAGE_IDS_RE.test(languageId)
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
      if (NUNJUCKS_FILE_RE.test(uri.path)) {
        return "nunjucks"
      }
      return undefined
    },
    // Without this, the TS project machinery has no way to know that one
    // of our embedded codes is an actual TypeScript file it should include
    // in a real `ts.Program` — completion/hover on it would silently come
    // back empty.
    typescript: {
      extraFileExtensions: [{ extension: 'nunjucks', isMixedContent: true, scriptKind: ts.ScriptKind.Deferred }],
      getServiceScript(root) {
        const tsCode = root.embeddedCodes?.find((code) => code.id === "nunjucks-data-ts")
        if (!tsCode) return undefined
        return {
          code: tsCode,
          extension: ".ts",
          scriptKind: ts.ScriptKind.TS,
        }
      },
      getExtraServiceScripts(fileName, root) {
	const scripts: TypeScriptExtraServiceScript[] = [];
	for (const code of forEachEmbeddedCode(root)) {
          if (code.languageId === 'javascript') {
            scripts.push({
              fileName: fileName + '.' + code.id + '.js',
              code,
              extension: '.js',
              scriptKind: 1 satisfies ts.ScriptKind.JS,
            });
          }
          else if (code.languageId === 'typescript') {
            scripts.push({
              fileName: fileName + '.' + code.id + '.ts',
              code,
              extension: '.ts',
              scriptKind: 3 satisfies ts.ScriptKind.TS,
            });
          }
	}
	return scripts;
      },
    },
    createVirtualCode(uri, languageId, snapshot) {
      if (!isNunjucksDocument(uri, languageId)) {
        return undefined
      }
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

/**
 * https://github.com/volarjs/starter/blob/master/packages/language-server/src/languagePlugin.ts#L78-L143
 */
function* getEmbeddedCodesForHTMLDocument(snapshot: ts.IScriptSnapshot, htmlDocument: html.HTMLDocument): Generator<VirtualCode> {
  const styles = htmlDocument.roots.filter(root => root.tag === 'style');
  const scripts = htmlDocument.roots.filter(root => root.tag === 'script');

  for (let i = 0; i < styles.length; i++) {
    const style = styles[i];
    if (style.startTagEnd !== undefined && style.endTagStart !== undefined) {
      const styleText = snapshot.getText(style.startTagEnd, style.endTagStart);
      yield {
        id: 'style_' + i,
        languageId: 'css',
        snapshot: {
          getText: (start, end) => styleText.substring(start, end),
          getLength: () => styleText.length,
          getChangeRange: () => undefined,
        },
        mappings: [{
          sourceOffsets: [style.startTagEnd],
          generatedOffsets: [0],
          lengths: [styleText.length],
          data: {
            completion: true,
            format: true,
            navigation: true,
            semantic: true,
            structure: true,
            verification: true,
          },
        }],
        embeddedCodes: [],
      };
    }
  }

  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i]
    if (script.startTagEnd !== undefined && script.endTagStart !== undefined) {
      const text = snapshot.getText(script.startTagEnd, script.endTagStart);
      const lang = script.attributes?.lang;
      const isTs = lang === 'ts' || lang === '"ts"' || lang === "'ts'";
      yield {
        id: 'script_' + i,
        languageId: isTs ? 'typescript' : 'javascript',
        snapshot: {
          getText: (start, end) => text.substring(start, end),
          getLength: () => text.length,
          getChangeRange: () => undefined,
        },
        mappings: [{
          sourceOffsets: [script.startTagEnd],
          generatedOffsets: [0],
          lengths: [text.length],
          data: {
            completion: true,
            format: true,
            navigation: true,
            semantic: true,
            structure: true,
            verification: true,
          },
        }],
        embeddedCodes: [],
      };
    }
  }
}

const isWhiteSpace = (t: Tok) => t.type === lexer.TOKEN_WHITESPACE
const isKey = (t: Tok) =>
  t.type === lexer.TOKEN_SYMBOL || t.type === lexer.TOKEN_INT

interface Edit { offset: number; text: string }

/**
 * A tag is only ever considered to close on its *own line*. The lexer keeps
 * consuming in expression mode after an unclosed `{{`, so given
 *
 *     {{ eleventy.
 *     {{ obj.a }}
 *
 * it happily reports the second line's `}}` as the first tag's closer — and
 * the patched text would then nest `{{` inside an expression and fail to
 * parse, losing completions for the whole document. When that happens we
 * close the tag synthetically at its own line end and resume scanning from
 * the next line, so the following tags get looked at on their own terms.
 */
export function computeDanglingEdits(src: string, opts?: object): Edit[] {
  const edits: Edit[] = []
  let from = 0
  while (from < src.length) {
    const resumeAt = scanFrom(src, from, edits, opts)
    if (resumeAt === undefined || resumeAt <= from) break
    from = resumeAt
  }
  return edits
}

/**
 * Scans one run of `src` starting at `base`, appending edits. Returns the
 * offset to resume scanning from after a synthetically-closed tag, or
 * `undefined` once the rest of the input is consumed.
 */
function scanFrom(src: string, base: number, edits: Edit[], opts?: object): number | undefined {
  const { tokens, tags } = tokenize(src.slice(base), opts)
  // `tokenize` works on the slice, so shift every offset back into `src`.
  for (const t of tokens) {
    t.start += base
    t.end += base
  }

  // Only pad when the source doesn't already supply whitespace, so we never
  // fuse with a neighbouring token (notably a `-}}` whitespace-control
  // closer) but also never introduce a gratuitous double space.
  const padBefore = (at: number) => (at > 0 && /\s/.test(src[at - 1]) ? "" : " ")
  const padAfter = (at: number) => (at < src.length && /\s/.test(src[at]) ? "" : " ")

  let openTok: Tok | null = null   // the {{ or {% that started the current tag
  let tagName: string | null = null // first symbol after {%
  let contentCount = 0
  // Content that appeared before the end of the opening tag's own line. An
  // unclosed `{{` makes the lexer keep consuming in expression mode, so the
  // HTML that follows (`</body>`, ...) arrives as content tokens — counting
  // those would hide the fact that the user's tag is actually empty.
  let contentOnOpenLine = 0
  // Where in `edits` the current tag's edits begin, so a synthetic closer
  // can discard anything we queued past it.
  let editsAtTagStart = 0

  const nextMeaningful = (i: number): Tok | undefined => {
    for (let j = i + 1; j < tokens.length; j++) if (!isWhiteSpace(tokens[j])) return tokens[j]
    return undefined
  }

  // An unclosed tag gets its synthetic closer at the end of *its own line*,
  // not at EOF. Appending at EOF would pull everything after the caret
  // (`</body></html>`, the rest of the template) inside the expression, and
  // nunjucks would fail to parse the whole document — losing every
  // completion rather than just this one.
  const endOfLine = (offset: number) => {
    const nl = src.indexOf("\n", offset)
    return nl === -1 ? src.length : nl
  }

  const finish = (endTok: Tok | undefined) => {
    if (!openTok) return
    const isVar = openTok.type === lexer.TOKEN_VARIABLE_START
    if (!endTok) {
      // Everything past the synthetic closer is not really inside this tag,
      // so drop sentinels we queued for it (e.g. a `.` in HTML below).
      const closerAt = endOfLine(openTok.start)
      edits.length = editsAtTagStart + edits.slice(editsAtTagStart).filter((e) => e.offset <= closerAt).length
    }
    const content = endTok ? contentCount : contentOnOpenLine
    // `{{ }}` or a bare `{{` at EOF: parser dies on an empty expression.
    if (content === 0 && isVar) {
      const at = endTok ? endTok.start : endOfLine(openTok.start)
      edits.push({
        offset: at,
        text: endTok
          ? `${padBefore(at)}${SENTINEL}${padAfter(at)}`
          : `${padBefore(at)}${SENTINEL} ${tags.VARIABLE_END}`,
      })
    } else if (!endTok) {
      const at = endOfLine(openTok.start)
      edits.push({ offset: at, text: `${padBefore(at)}${closerFor(isVar, tagName, tags)}` })
    }
    openTok = null; tagName = null; contentCount = 0; contentOnOpenLine = 0
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]

    if (t.type === lexer.TOKEN_VARIABLE_START || t.type === lexer.TOKEN_BLOCK_START) {
      finish(undefined)          // previous tag never closed
      openTok = t
      editsAtTagStart = edits.length
      continue
    }
    if (t.type === lexer.TOKEN_VARIABLE_END || t.type === lexer.TOKEN_BLOCK_END) {
      if (openTok && t.start > endOfLine(openTok.start)) {
        // Closer belongs to a later line — this tag never really closed.
        const resumeAt = endOfLine(openTok.start) + 1
        finish(undefined)
        return resumeAt
      }
      finish(t)
      continue
    }
    if (!openTok || isWhiteSpace(t)) {
      continue
    }

    if (contentCount === 0 && openTok.type === lexer.TOKEN_BLOCK_START) {
      tagName = t.value
    }
    contentCount++
    if (t.start < endOfLine(openTok.start)) {
      contentOnOpenLine++
    }

    if (t.type === lexer.TOKEN_OPERATOR && t.value === ".") {
      const next = nextMeaningful(i)
      if (!next || !isKey(next)) {
        edits.push({ offset: t.end, text: `${SENTINEL}${padAfter(t.end)}` })
      }
    }
  }
  finish(undefined)
  return undefined
}

function closerFor(isVar: boolean, tagName: string | null, tags: LexerOptions["tags"]) {
  if (isVar) {
    return tags.VARIABLE_END
  }


  // TODO: We should actually compute these off of custom extensions.
  const block_closers: Record<string, string> = {
    if: "endif", for: "endfor", block: "endblock", macro: "endmacro",
    filter: "endfilter", call: "endcall", raw: "endraw",
    verbatim: "endverbatim", asyncEach: "endeach", asyncAll: "endall",
  }

  const end = tagName && block_closers[tagName]
  return end
    ? `${tags.BLOCK_END} ${tags.BLOCK_START} ${end} ${tags.BLOCK_END}`
    : tags.BLOCK_END
}
