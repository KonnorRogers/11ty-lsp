import { AnyNode } from "nunjucks/src/nodes.js";
import { logger } from "../logger"
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
      currentLineContent,
    } = getContext(document, position.line, position.character);

    // - 1 is an assumption since we're on a completion.
    const word = this.getWordAtCursor(currentLineContent, position.character - 2, position.line);

    logger.write({word})
    if (!word) { return completions }

    if (word?.word.endsWith(".")) {
    }

    const result = this.parser.parseDocument(document);
    let currentNode = this.parser.findNodeAtPosition(result.ast, position.line, position.character)

    logger.write({currentNode})
    // completions.concat(this.getCompletionForNode(currentNode, data));
    // return Object.values(definitions.generalCompletions);
    // switch (context.type) {
    //   default:
    //     return this.getGeneralCompletions(document);
    // }

    return completions
  }


  getCompletionForNode(node: AnyNode | null, data?: DataOrError | null): CompletionItem[] {
    const completions: CompletionItem[] = [
    ]

    completions.push({
      label: "key",
      kind: CompletionItemKind.Text,
    })

    if (!node) { return completions }

    let value = null
    if (node.typename === "Symbol") {
      // @ts-expect-error
      value = data[node.value]
    }

    if (value) {
      const keys = Object.keys(value).map((key) => {
        return {
          label: key
        }
      })

      completions.concat([{
        label: "key",
        kind: CompletionItemKind.Text,
      }])
    }

    return completions
  }



  resolveCompletion(item: CompletionItem): CompletionItem {
    return item;
  }

}
