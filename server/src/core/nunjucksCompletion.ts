import { AnyNode } from "nunjucks/src/nodes.js";
import {
  CompletionItem,
  CompletionItemKind,
  Position,
  InsertTextFormat,
  MarkupKind
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { NunjucksSettings } from '../settings/nunjucksSettings';
import { getContext } from './getContext';
import * as definitions from './definitions'
import { DataOrError } from '../constants';
import { NunjucksProvider } from './nunjucksProvider';

export class NunjucksCompletionProvider extends NunjucksProvider {
  provideCompletions(
    document: TextDocument,
    position: Position,
    settings: NunjucksSettings,
    data?: DataOrError | null
  ): CompletionItem[] {
    const completions: CompletionItem[] = []

    const {
      previousContent,
    } = getContext(document, position.line, position.character);

    const {
      currentLineContent,
    } = getContext(document, position.line, position.character);

    const word = this.getWordAtCursor(currentLineContent, position.character, position.line);

    if (!word) { return completions }

    // do we need to parse??
    const result = this.parser.parseDocument(document);
    let currentNode = this.parser.findNodeAtPosition(result.ast, position.line, position.character)

    completions.concat(this.getCompletionForNode(currentNode, data));
    // return Object.values(definitions.generalCompletions);
    // switch (context.type) {
    //   default:
    //     return this.getGeneralCompletions(document);
    // }

    return completions
  }


  getCompletionForNode(node: AnyNode | null, data?: DataOrError | null): CompletionItem[] {
    const completions: CompletionItem[] = []

    if (!node) { return completions }

    let value = null
    if (node.typename === "Symbol") {
      // @ts-expect-error
      value = data[node.value]
    }

    if (value) {
      completions.concat(
        Object.keys(value).map((key) => {
          return {
            label: key
          }
        })
      )
    }

    return completions
  }



  resolveCompletion(item: CompletionItem): CompletionItem {
    return item;
  }

}
