import { TextDocument } from "vscode-languageserver-textdocument";

/**
 * Finds the string for the document + linenumber + linenumber offset.
 */
export function getContext (document: TextDocument, lineNumber: number, lineOffset: number) {
  const parts = document.getText().split(/(\r\n|\n)/)
  // parts = [line0, sep0, line1, sep1, ..., lineN]
  //   even indices = line contents, odd indices = the exact terminator that followed
  const currentLineContent = parts[lineNumber * 2] ?? ""
  const contentBeforeOffset = currentLineContent.slice(0, lineOffset)
  const contentAfterOffset = currentLineContent.slice(lineOffset)

  return {
    // full line
    previousContent: parts.slice(0, lineNumber * 2).join(""),
    currentLineContent,
    contentBeforeOffset,
    contentAfterOffset,
    // full line
    afterContent: parts.slice(lineNumber * 2 + 1).join(""),
  }
}

