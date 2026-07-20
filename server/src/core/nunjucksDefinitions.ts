/**
 * Discovery of a project's *own* nunjucks vocabulary — the shortcodes, paired
 * shortcodes, custom tags and filters it registers through `eleventyConfig`.
 *
 * The nunjucks `Environment` we already capture (see `getJSONData`) knows the
 * *names* of every registered tag via `extensionsList`, but not their
 * arguments: 11ty wraps each user function in a `ShortcodeFunction` whose
 * `run` is a `(...args)` closure over the original. The original is
 * unreachable by property access, so parameter names can only be recovered at
 * *registration* time.
 *
 * That's what this does — it wraps the `addShortcode`/`addFilter`/... methods
 * on the `UserConfig` object before the project's own config function runs,
 * records each registration, then delegates. Nothing is intercepted
 * permanently; the wrappers live only for the duration of one build.
 */

export type NunjucksDefinitionKind = "shortcode" | "pairedShortcode" | "tag" | "filter"

export interface NunjucksDefinition {
  name: string
  kind: NunjucksDefinitionKind
  /** User-facing parameter names, in order. */
  params: string[]
  /** The parameter list exactly as written, for display. */
  signature: string
  isAsync: boolean
}

/**
 * 11ty mirrors engine-agnostic registrations onto the engine-specific ones
 * (`addShortcode` also calls `addNunjucksShortcode`, and so on), so the same
 * name arrives several times. Both spellings map to the same kind and are
 * deduped below.
 */
const METHOD_KINDS: Record<string, NunjucksDefinitionKind> = {
  addShortcode: "shortcode",
  addNunjucksShortcode: "shortcode",
  addAsyncShortcode: "shortcode",
  addNunjucksAsyncShortcode: "shortcode",
  addPairedShortcode: "pairedShortcode",
  addNunjucksPairedShortcode: "pairedShortcode",
  addPairedAsyncShortcode: "pairedShortcode",
  addNunjucksPairedAsyncShortcode: "pairedShortcode",
  addNunjucksTag: "tag",
  addFilter: "filter",
  addNunjucksFilter: "filter",
  addAsyncFilter: "filter",
  addNunjucksAsyncFilter: "filter",
}

/**
 * The mirrored registration forwards through a `(...args)` wrapper, which
 * carries no parameter names. When both a real and a mirrored registration
 * exist for one name, the real one wins.
 */
const MIRROR_SIGNATURE = /^\.\.\.\w+$/

/** Splits a parameter list on top-level commas, ignoring nested/quoted ones. */
export function splitParams(source: string): string[] {
  const params: string[] = []
  let current = ""
  let depth = 0
  let quote: string | null = null

  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (quote) {
      if (char === quote && source[i - 1] !== "\\") quote = null
      current += char
      continue
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char
      current += char
      continue
    }
    if (char === "(" || char === "[" || char === "{") depth++
    else if (char === ")" || char === "]" || char === "}") depth--
    else if (char === "," && depth === 0) {
      params.push(current)
      current = ""
      continue
    }
    current += char
  }
  if (current.trim()) params.push(current)
  return params
}

/** `widths = [400, 800]` -> `widths`; destructured params have no usable name. */
function parameterName(raw: string): string {
  let param = raw.trim()
  const equals = param.indexOf("=")
  if (equals > 0) param = param.slice(0, equals).trim()
  if (param.startsWith("...")) param = param.slice(3)
  if (param.startsWith("{") || param.startsWith("[")) return ""
  return param
}

function describeFunction(fn: unknown): { params: string[]; signature: string; isAsync: boolean } {
  if (typeof fn !== "function") return { params: [], signature: "", isAsync: false }
  const source = Function.prototype.toString.call(fn)
  const open = source.indexOf("(")
  const close = source.indexOf(")", open)
  const signature = open === -1 || close === -1 ? "" : source.slice(open + 1, close).trim()
  return {
    params: splitParams(signature).map(parameterName).filter(Boolean),
    signature,
    isAsync: /^\s*async\b/.test(source),
  }
}

export interface DefinitionCollector {
  /** Wraps the registration methods on an 11ty `UserConfig`. */
  install(userConfig: Record<string, unknown>): void
  /** Names known to the built environment but never registered (nunjucks built-ins). */
  addBuiltinFilters(names: readonly string[]): void
  definitions(): NunjucksDefinition[]
}

export function createDefinitionCollector(): DefinitionCollector {
  const byKey = new Map<string, NunjucksDefinition>()

  const record = (definition: NunjucksDefinition) => {
    const key = `${definition.kind}:${definition.name}`
    const existing = byKey.get(key)
    if (existing) {
      // Keep whichever registration actually named its parameters.
      const existingIsMirror = MIRROR_SIGNATURE.test(existing.signature)
      const incomingIsMirror = MIRROR_SIGNATURE.test(definition.signature)
      if (existingIsMirror && !incomingIsMirror) byKey.set(key, definition)
      else if (definition.isAsync && !existing.isAsync) existing.isAsync = true
      return
    }
    byKey.set(key, definition)
  }

  return {
    install(userConfig) {
      for (const [method, kind] of Object.entries(METHOD_KINDS)) {
        const original = userConfig[method]
        if (typeof original !== "function") continue
        userConfig[method] = function (this: unknown, name: unknown, fn: unknown, ...rest: unknown[]) {
          if (typeof name === "string") {
            const described = describeFunction(fn)
            record({
              name,
              kind,
              // A paired shortcode receives the block's rendered content as
              // its first argument — 11ty supplies that, not the template
              // author, so it isn't part of the call signature. `addNunjucksTag`
              // is handed the engine and returns an extension that parses its
              // own arguments, so its parameters say nothing about call sites.
              params:
                kind === "tag" ? []
                : kind === "pairedShortcode" ? described.params.slice(1)
                : described.params,
              signature: described.signature,
              isAsync: described.isAsync,
            })
          }
          return (original as Function).call(this, name, fn, ...rest)
        }
      }
    },

    addBuiltinFilters(names) {
      for (const name of names) {
        const key = `filter:${name}`
        if (!byKey.has(key)) {
          byKey.set(key, { name, kind: "filter", params: [], signature: "", isAsync: false })
        }
      }
    },

    definitions() {
      return [...byKey.values()]
    },
  }
}

/**
 * `{% image "src", "alt" %}` — nunjucks separates shortcode arguments with
 * commas, same as a function call.
 */
export function snippetFor(definition: NunjucksDefinition, closed: boolean): string {
  const args = definition.params.map((param, index) => `\${${index + 1}:${param}}`).join(", ")
  const call = args ? `${definition.name} ${args}` : definition.name

  if (definition.kind !== "pairedShortcode") return call
  // A paired shortcode is useless without its closing tag, so complete the
  // whole block — unless the author already typed the `%}` themselves.
  if (closed) return call
  return `${call} %}\n\t$0\n{% end${definition.name} %`
}

export type CompletionSlot =
  /** The tag-name slot of a block tag: `{% |` */
  | { slot: "tag"; closed: boolean }
  /** Just after a pipe, in either tag flavour: `{{ foo | |` */
  | { slot: "filter"; closed: boolean }
  | null

/**
 * Where the caret is, in terms of what could legally be named there.
 *
 * Deliberately a scan of the raw text rather than an AST walk: this has to
 * work on the half-typed, unparseable input that completion exists to serve
 * (`{% ` with nothing after it is exactly when you want tag names).
 */
export function completionSlotAt(text: string, offset: number): CompletionSlot {
  const before = text.slice(0, offset)

  const blockOpen = before.lastIndexOf("{%")
  const variableOpen = before.lastIndexOf("{{")
  const open = Math.max(blockOpen, variableOpen)
  if (open < 0) return null

  // A closer after the last opener means the caret is in plain template text.
  const lastClose = Math.max(before.lastIndexOf("%}"), before.lastIndexOf("}}"))
  if (lastClose > open) return null

  // Only look at the current line for the closer: an unclosed tag shouldn't
  // pick up a `%}` belonging to something further down the document.
  const lineEnd = text.indexOf("\n", offset)
  const rest = text.slice(offset, lineEnd === -1 ? text.length : lineEnd)
  const closed = /%\}|\}\}/.test(rest)

  const inner = before.slice(open + 2)

  // `| ` anywhere after the last pipe with no intervening comma/paren.
  if (/\|\s*[\w-]*$/.test(inner)) return { slot: "filter", closed }

  // First word of a block tag, and nothing else typed yet.
  if (open === blockOpen && /^\s*[\w-]*$/.test(inner)) return { slot: "tag", closed }

  return null
}
