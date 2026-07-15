import { TextDocument } from "vscode-languageserver-textdocument";
import { NunjucksSettings } from "../settings/nunjucksSettings";
import { Diagnostic } from "vscode-languageserver";
import { NunjucksParser } from "./nunjucksParser";
import { NEW_LINE } from "../constants";

export class NunjucksValidator {
  constructor(public parser: NunjucksParser) {}

  validate(document: TextDocument, settings: Partial<NunjucksSettings>): Diagnostic[] {
    const content = document.getText();
    return this.validateContent(content, settings)
  }

  validateContent (content: string, settings: Partial<NunjucksSettings>): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const result = this.parser.parseContent(content)

    const docLines = content.split(NEW_LINE)
    const finalLine = docLines.length - 1
    const finalChar = docLines[finalLine].length - 1

    // no errors
    if (!result.error) {
      return diagnostics
    }

    const hasPos = result.error.lineno != null && result.error.colno != null

    // nunjucks lines + chars are all 1-indexed so we need to subtract 1.
    const startLine = hasPos ? result.error.lineno - 1 : 0
    const startChar = hasPos ? result.error.colno - 1 : 0
    const endLine = hasPos ? result.error.lineno - 1 : finalLine
    const endChar = hasPos ? result.error.colno : finalChar

    diagnostics.push({
      message: "Nunjucks parsing error: " + result.error.message,
      range: {
        start: {
          line: startLine,
          character: startChar,
        },
        end: {
          line: endLine,
          character: endChar,
        }
      }
    })

    return diagnostics
  }
}
