import type { LanguageServiceContext, LanguageServicePlugin, LanguageServicePluginInstance } from "@volar/language-service"
import { DiagnosticSeverity, MarkupKind } from "vscode-languageserver"
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
      diagnosticProvider: {
        interFileDependencies: true,
        workspaceDiagnostics: false,
      },
    },
    create(context: LanguageServiceContext): LanguageServicePluginInstance {
      return {
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
              end: document.positionAt(document.getText().length),
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
