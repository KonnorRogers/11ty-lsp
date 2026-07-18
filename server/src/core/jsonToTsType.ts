/**
 * Turns a runtime JS/JSON value (e.g. the data 11ty produces for a template)
 * into TypeScript type source text, so it can be used as the type of a
 * `declare const` in a virtual TS file and get real completions/hover.
 *
 * Object-property values are literal-typed (`title: "My Post"`) — 11ty data
 * for a given template is a deterministic snapshot, so the literal is both
 * accurate and more useful on hover than just `string`. Array *elements*
 * are widened instead: a collection's items don't share one fixed value,
 * and literal-unioning every element (e.g. every post title) would be
 * useless noise. `insideArray` tracks which regime the current value is in.
 */

const MAX_DEPTH = 8

export function jsonValueToTsType(
  value: unknown,
  insideArray = false,
  seen: Set<unknown> = new Set(),
  depth = 0
): string {
  if (depth > MAX_DEPTH) return "unknown"
  if (value === null) return "null"
  if (value === undefined) return "undefined"

  const type = typeof value
  if (type === "string") return insideArray ? "string" : JSON.stringify(value)
  if (type === "number") return insideArray ? "number" : String(value)
  if (type === "boolean") return insideArray ? "boolean" : String(value)
  if (type === "bigint") return "bigint"
  if (type === "function") return "((...args: any[]) => any)"
  if (type !== "object") return "unknown"

  if (value instanceof Date) return "Date"
  if (value instanceof RegExp) return "RegExp"

  // Cycle guard: same shape as `decycle()` in getJSONData.ts. Marking on the
  // way down and unmarking in `finally` means it only trips on ancestors
  // (actual cycles), not on sibling values that happen to be `===`.
  if (seen.has(value)) return "unknown"

  seen.add(value)
  try {
    if (Array.isArray(value)) {
      if (value.length === 0) return "unknown[]"

      const elementTypes = new Set(value.map((item) => jsonValueToTsType(item, true, seen, depth + 1)))
      if (elementTypes.size === 1) {
        return `${[...elementTypes][0]}[]`
      }
      return `(${[...elementTypes].join(" | ")})[]`
    }

    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return "Record<string, unknown>"

    const props = entries.map(([key, propValue]) => {
      // Propagate `insideArray` as-is (don't reset to false): a property of
      // an array element is still non-representative of one fixed value —
      // once inside an array, every descendant stays widened.
      const propType = jsonValueToTsType(propValue, insideArray, seen, depth + 1)
      // Scalars already show their current value via the literal type
      // itself (`detail: (property) foo: "bar"`); a doc comment would just
      // repeat that. Objects/arrays stay widened/structural though, so a
      // JSDoc preview of the actual value is the only place it shows up —
      // TS surfaces `/** ... */` on a type-literal member as real
      // completion-item/hover documentation, not just detail text.
      const doc = insideArray ? null : describeValueForDoc(propValue)
      const jsdoc = doc ? `${toJsDocComment(doc)}\n` : ""
      return `${jsdoc}${propertyKeyToTs(key)}: ${propType};`
    })

    // One property per line: TS's JSDoc-to-declaration association for
    // type-literal members needs the comment on its own line to reliably
    // attach as that member's documentation (all on one line, it doesn't).
    return `{\n${props.join("\n")}\n}`
  } finally {
    seen.delete(value)
  }
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function propertyKeyToTs(key: string): string {
  return IDENTIFIER_RE.test(key) ? key : JSON.stringify(key)
}

const MAX_DOC_PREVIEW_LENGTH = 200

/** A short preview of a non-primitive value's current contents, or null if there's nothing useful to show. */
function describeValueForDoc(value: unknown): string | null {
  if (value === null || value === undefined || typeof value !== "object") return null
  if (value instanceof Date) return value.toISOString()

  try {
    const json = JSON.stringify(value)
    if (!json) return null
    return json.length > MAX_DOC_PREVIEW_LENGTH ? json.slice(0, MAX_DOC_PREVIEW_LENGTH) + "…" : json
  } catch {
    return null // circular reference or other unstringifiable value
  }
}

/** Renders `text` as a single-line JSDoc comment safe to inline before a type-literal member. */
function toJsDocComment(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").replace(/\*\//g, "* /")
  return `/** ${oneLine} */`
}

/**
 * Convenience wrapper producing a standalone `type X = ...;` declaration.
 */
export function jsonValueToTsTypeDeclaration(value: unknown, typeName: string): string {
  return `type ${typeName} = ${jsonValueToTsType(value)};`
}
