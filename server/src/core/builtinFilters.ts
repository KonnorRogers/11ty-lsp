/**
 * Hand-authored TypeScript signatures for the filters a template can pipe
 * into (`{{ x | filter }}`). Nunjucks parses `foo | join(",")` as
 * `join(foo, ",")` — already call shape — so `nunjucksVirtualCode.ts`
 * transcribes a filter into a call on a declared `__filters` object of this
 * type. TypeScript then supplies hover, signature help, and — the real win —
 * return-type propagation, so `{{ (items | first).<caret> }}` completes on
 * the element type.
 *
 * The map is deliberately finite: nunjucks' own built-ins plus the filters
 * 11ty registers. Anything not listed (a project's own custom filters) is
 * caught by the index signature and typed loosely, so unknown filters degrade
 * to `any` rather than becoming a hard error.
 */

export const FILTERS_VAR = "__filters"

/**
 * Each entry is one property of the `__filters` object type. `input` is always
 * the piped value; the rest are the filter's declared arguments. Signatures
 * favour correct *return* types (that's what propagates), and stay loose on
 * argument types where nunjucks is permissive.
 */
const BUILTIN_FILTER_SIGNATURES: Record<string, string> = {
  // — sequences: return-type propagation matters most here —
  first: "<T>(input: readonly T[]): T",
  last: "<T>(input: readonly T[]): T",
  random: "<T>(input: readonly T[]): T",
  reverse: "<T>(input: readonly T[]): T[]",
  sort: "<T>(input: readonly T[], reverse?: boolean, caseSensitive?: boolean, attribute?: string): T[]",
  slice: "<T>(input: readonly T[], slices: number, fillWith?: T): T[][]",
  batch: "<T>(input: readonly T[], linecount: number, fillWith?: T): T[][]",
  select: "<T>(input: readonly T[], ...args: unknown[]): T[]",
  reject: "<T>(input: readonly T[], ...args: unknown[]): T[]",
  selectattr: "<T>(input: readonly T[], ...args: unknown[]): T[]",
  rejectattr: "<T>(input: readonly T[], ...args: unknown[]): T[]",
  groupby: "<T>(input: readonly T[], attribute: string): Record<string, T[]>",
  list: "(input: string): string[]",
  dictsort: "(input: object, caseSensitive?: boolean, by?: 'key' | 'value'): [string, unknown][]",

  // — numbers —
  abs: "(input: number): number",
  round: "(input: number, precision?: number, method?: 'common' | 'ceil' | 'floor'): number",
  sum: "(input: readonly number[], attribute?: string, start?: number): number",
  int: "(input: unknown, defaultValue?: number, base?: number): number",
  float: "(input: unknown, defaultValue?: number): number",
  length: "(input: unknown): number",
  wordcount: "(input: string): number",

  // — strings —
  upper: "(input: string): string",
  lower: "(input: string): string",
  capitalize: "(input: string): string",
  title: "(input: string): string",
  trim: "(input: string): string",
  truncate: "(input: string, length?: number, killwords?: boolean, end?: string, leeway?: number): string",
  replace: "(input: string, search: string | RegExp, replacement: string, maxCount?: number): string",
  center: "(input: string, width?: number): string",
  indent: "(input: string, width?: number, indentFirstLine?: boolean): string",
  nl2br: "(input: string): string",
  string: "(input: unknown): string",
  striptags: "(input: string, preserveLineBreaks?: boolean): string",
  urlencode: "(input: unknown): string",
  urlize: "(input: string, length?: number, nofollow?: boolean): string",
  escape: "(input: unknown): string",
  forceescape: "(input: unknown): string",
  safe: "(input: unknown): string",
  dump: "(input: unknown, spaces?: number): string",

  // — misc —
  default: "<T, D>(input: T, defaultValue: D, boolean?: boolean): T | D",
  d: "<T, D>(input: T, defaultValue: D, boolean?: boolean): T | D",
  e: "(input: unknown): string",

  // — 11ty-registered filters —
  url: "(input: string, pathPrefixOverride?: string): string",
  slug: "(input: string): string",
  slugify: "(input: string): string",
  inputPathToUrl: "(input: string): string",
  log: "<T>(input: T, ...messages: unknown[]): T",
}

/**
 * The `declare const __filters: { ... }` header prepended to every synthesized
 * file. The index signature makes an unknown (custom) filter resolve to
 * `(input, ...args) => any` instead of a "property does not exist" error, so a
 * project's own filters still type-check through as `any`.
 */
export function buildFiltersDeclaration(): string {
  const members = Object.entries(BUILTIN_FILTER_SIGNATURES)
    .map(([name, signature]) => `  ${name}${signature};`)
    .join("\n")
  return (
    `declare const ${FILTERS_VAR}: {\n` +
    `  [filter: string]: (input: any, ...args: any[]) => any;\n` +
    `${members}\n` +
    `};\n`
  )
}
