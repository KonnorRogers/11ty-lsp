import { TextDocument } from "vscode-languageserver-textdocument";
import { NEW_LINE_WITH_CAPTURE_GROUP } from "../constants";

/**
 * Finds the string for the document + linenumber + linenumber offset.
 */
export function getContext (document: TextDocument, lineNumber: number, lineOffset: number) {
  const parts = document.getText().split(NEW_LINE_WITH_CAPTURE_GROUP)
  // parts = [line0, sep0, line1, sep1, ..., lineN]
  //   even indices = line contents, odd indices = the exact terminator that followed
  const currentLineContent = parts[lineNumber * 2] ?? ""
  const contentOnLineBeforeOffset = currentLineContent.slice(0, lineOffset)
  const contentOnLineAfterOffset = currentLineContent.slice(lineOffset)

  return {
    // full line
    contentBeforeOffset: parts.slice(0, lineNumber * 2).join(""),
    currentLineContent,
    contentOnLineBeforeOffset,
    contentOnLineAfterOffset,
    // full line
    contentAfterOffset: parts.slice(lineNumber * 2 + 1).join(""),
  }
}

