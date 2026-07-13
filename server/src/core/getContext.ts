import { TextDocument } from "vscode-languageserver-textdocument";
import { NEW_LINE } from "../constants";

/**
 * Finds the string for the document + linenumber + linenumber offset.
 */
export function getContext (document: TextDocument, lineNumber: number, lineOffset: number) {
  const lines = document.getText().split(NEW_LINE);
  const currentLineContent = lines[lineNumber]
  const contentBeforeOffset = currentLineContent.slice(0, lineOffset)
  return {
    previousContent: lines.slice(0, lineNumber - 1).join("\n"),
    currentLineContent,
    contentBeforeOffset,
  }
}

