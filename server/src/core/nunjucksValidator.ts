import { TextDocument } from "vscode-languageserver-textdocument";
import { NunjucksSettings } from "../settings/nunjucksSettings";
import { Diagnostic } from "vscode-languageserver";
import { NunjucksParser } from "./nunjucksParser";

export class NunjucksValidator {
  constructor(public parser: NunjucksParser) {}

  validate(document: TextDocument, settings: Partial<NunjucksSettings>): Diagnostic[] {
    const content = document.getText();
    return this.validateContent(content, settings)
  }

  validateContent (content: string, settings: Partial<NunjucksSettings>): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const result = this.parser.parseContent(content)

    // no errors
    if (!result.error) {
      return diagnostics
    }

    diagnostics.push({
      message: result.error.message,
      range: {
        start: {
          line: result.error.lineno,
          character: result.error.colno,
        },
        end: {
          line: result.error.lineno,
          character: result.error.colno,
        }
      }
    })

    return diagnostics
  }
}
