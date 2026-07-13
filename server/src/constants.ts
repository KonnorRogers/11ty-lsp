export const NEW_LINE = /\r\n?|\n/g

export type DataOrError =
  | Array<Record<string, unknown>>
  | Record<string, unknown>
  | Object
  | DataError;

export type DataError = Error & { lineno?: number; colno?: number }

