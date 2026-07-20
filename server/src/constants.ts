export const NEW_LINE = /\r\n?|\n/g
/**
 * This is needed to split at new lines and maintain the line terminator.
 */
export const NEW_LINE_WITH_CAPTURE_GROUP = /(\r\n?|\n)/g

export type DataOrError =
  | Array<Record<string, unknown>>
  | Record<string, unknown>
  | Object
  | DataError;

export type DataError = Error & { lineno?: number; colno?: number }


export const ELEVENTY_OR_BUILDAWESOME_PACKAGES = [
  "@11ty/eleventy",
  "@awesome.me/buildawesome"
]


