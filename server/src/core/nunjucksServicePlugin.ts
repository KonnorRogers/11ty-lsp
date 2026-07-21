import type { LanguageServiceContext, LanguageServicePlugin, LanguageServicePluginInstance } from "@volar/language-service"
import { CompletionItemKind, DiagnosticSeverity, InsertTextFormat, MarkupKind } from "vscode-languageserver"
import type { TextDocument } from "vscode-languageserver-textdocument"
import { URI } from "vscode-uri"
import { DataOrError } from "../constants"
import { serializeError } from "../logger"
import { NunjucksSettings } from "../settings/nunjucksSettings"
import * as definitions from "./definitions"
import { getContext } from "./getContext"
import { NunjucksExtension, NunjucksParser } from "./nunjucksParser"
import { NunjucksProvider } from "./nunjucksProvider"
import { NunjucksValidator } from "./nunjucksValidator"
import { completionSlotAt, snippetFor, type NunjucksDefinition } from "./nunjucksDefinitions"

/**
 * Volar wraps *every* virtual code — including our own root "nunjucks"
 * one — behind a synthetic `volar-embedded-content://...` URI when handing
 * it to service plugins; `document.uri` is never the plain `file://` uri
 * our 11ty-lookup functions (`getData`/`getExtensions`, keyed by real file
 * path) expect. Decode back to the real source uri before calling them.
 */
function resolveSourceUri(context: LanguageServiceContext, documentUri: string): string {
  const decoded = context.decodeEmbeddedDocumentUri(URI.parse(documentUri))
  return decoded ? decoded[0].toString() : documentUri
}

export interface NunjucksServicePluginHost {
  getSettings(uri: string): NunjucksSettings | Promise<NunjucksSettings>
  /** The 11ty data (or config/build error) for the file at `uri`, if any. */
  getData(uri: string): DataOrError | undefined | null
  /** The project's real registered nunjucks tags/shortcodes for the file at `uri`, if known. */
  getExtensions(uri: string): NunjucksExtension[] | undefined
  /** The project's shortcodes/tags/filters with argument lists, if a build has run. */
  getDefinitions(uri: string): NunjucksDefinition[] | undefined
}

/**
 * Everything data-driven (`{{ obj.foo }}` completion/hover) now comes from
 * the synthesized TypeScript embedded code (see nunjucksVirtualCode.ts) via
 * `volar-service-typescript`. This plugin only covers what TS can't help
 * with: filter-name documentation on hover, and surfacing Nunjucks
 * parse errors / 11ty build errors as diagnostics.
 */
export function createNunjucksServicePlugin(host: NunjucksServicePluginHost): LanguageServicePlugin {
  const parser = new NunjucksParser({})
  const validator = new NunjucksValidator(parser)
  const provider = new NunjucksProvider(parser)

  return {
    name: "nunjucks",
    capabilities: {
      hoverProvider: true,
      completionProvider: {
        // `%` fires on `{%`, `|` on a filter pipe, and space covers
        // `{% ` / `| ` where the name slot opens up.
        triggerCharacters: [
          "{",
          "%",
          "|",
          " ",
        ],
      },
      diagnosticProvider: {
        interFileDependencies: true,
        workspaceDiagnostics: false,
      },
    },
    create(context: LanguageServiceContext): LanguageServicePluginInstance {
      return {
        async provideCompletionItems(document: TextDocument, position) {
          // Shortcodes and filters only exist in the template language
          // itself, so this is the root document's business — the embedded
          // html/css/ts codes have nothing to say here.
          if (document.languageId !== "nunjucks") return

          const sourceUri = resolveSourceUri(context, document.uri)
          const settings = await host.getSettings(sourceUri)
          if (!settings.enabledFeatures?.completion) return

          const definitions = host.getDefinitions(sourceUri)
          if (!definitions?.length) return

          const text = document.getText()
          const slot = completionSlotAt(text, document.offsetAt(position))
          if (!slot) return

          const wanted =
            slot.slot === "filter"
              ? definitions.filter((d) => d.kind === "filter")
              : definitions.filter((d) => d.kind !== "filter")

          return {
            isIncomplete: false,
            items: wanted.map((definition) => {
              const signature = definition.params.length ? `(${definition.params.join(", ")})` : ""
              const detail =
                definition.kind === "pairedShortcode" ? "paired shortcode"
                : definition.kind === "tag" ? "nunjucks tag"
                : definition.kind

              return {
                label: definition.name,
                kind: definition.kind === "filter" ? CompletionItemKind.Function : CompletionItemKind.Snippet,
                detail: `${signature} — ${detail}${definition.isAsync ? " (async)" : ""}`,
                documentation: {
                  kind: MarkupKind.PlainText,
                  value: `${definition.name}(${definition.params.join(", ")})\n\nRegistered by this project's Eleventy config.`,
                },
                // Filters take their input from the pipe, so completing a
                // call signature there would be wrong.
                insertText: slot.slot === "filter" ? definition.name : snippetFor(definition, slot.closed),
                insertTextFormat: slot.slot === "filter" ? InsertTextFormat.PlainText : InsertTextFormat.Snippet,
              }
            }),
          }
        },

        async provideHover(document: TextDocument, position) {
          // Volar invokes every registered plugin against the root document
          // *and* every embedded one (html/css/ts) — this plugin only makes
          // sense against the root Nunjucks document itself.
          if (document.languageId !== "nunjucks") return null

          const sourceUri = resolveSourceUri(context, document.uri)
          const settings = await host.getSettings(sourceUri)
          if (!settings.enabledFeatures?.hover) return null

          const { currentLineContent } = getContext(document, position.line, position.character)
          const word = provider.getWordAtCursor(currentLineContent, position.character, position.line)

          if (!word) {
            return null
          }

          const { ast } = parser.parseDocument(document, host.getExtensions(sourceUri))
          const { node } = parser.findNodeAtPosition(ast, position.line, position.character)

          // Only filters should be provided directly as completions. Literals, Symbols, and LookupVal's should all go through TypeScript typing.
          if (node?.typename !== "Filter") {
            return null
          }

          const documentation = definitions.filters[word.word]?.documentation as string | undefined

          if (!documentation) {
            return null
          }

          return {
            contents: { kind: MarkupKind.PlainText, value: documentation },
            range: word.range,
          }
        },

        async provideDiagnostics(document: TextDocument) {
          if (document.languageId !== "nunjucks") return []

          const sourceUri = resolveSourceUri(context, document.uri)
          const settings = await host.getSettings(sourceUri)
          if (!settings.enabledFeatures?.diagnostics) return []

          const diagnostics = validator.validate(document, settings, host.getExtensions(sourceUri))

          const data = host.getData(sourceUri)
          if (data instanceof Error) {
            // @ts-expect-error 11ty bakes it on "originalError"
            const err = data.originalError
            const hasPos = typeof err === "object" && err != null && "lineno" in err && "colno" in err

            let range = {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 }
              // end: document.positionAt(document.getText().length),
            }

            if (hasPos) {
              // 11ty reports kind of useless numbers, so we ignore them and
              // just highlight the whole file — that makes it obvious the
              // 11ty build itself is broken, not the template.
            }

            diagnostics.unshift({
              range,
              message: "Error compiling 11ty: " + JSON.stringify(serializeError(data), null, 2),
              source: "[11ty-lsp]: 11ty CLI",
              severity: DiagnosticSeverity.Error,
            })
          }

          return diagnostics
        },
      }
    },
  }
}
