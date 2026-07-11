import {
  CompletionItem,
  CompletionItemKind,
  Position,
  InsertTextFormat,
  MarkupKind
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { NunjucksParser } from './nunjucksParser';
import { NunjucksSettings } from '../settings/nunjucksSettings';
import { getContext } from './getContext';
import * as definitions from './definitions'

export class NunjucksCompletionProvider {
  constructor(private parser: NunjucksParser) {}

  provideCompletions(
    document: TextDocument,
    position: Position,
    settings: NunjucksSettings
  ): CompletionItem[] {
    const {
      previousContent,
      contentBeforeOffset,
    } = getContext(document, position.line, position.character);

    // const result = this.parser.parseContent(previousContent + "\n" + contentBeforeOffset)

    // if (result.error) {
    //   return this.getGeneralCompletions();
    // }

    // result.ast.isPrototypeOf

    return Object.values(definitions.generalCompletions);
    // switch (context.type) {
    //   default:
    //     return this.getGeneralCompletions(document);
    // }
  }


  getCompletionContext (content: string) {
  }

  resolveCompletion(item: CompletionItem): CompletionItem {
    return item;
  }

}
