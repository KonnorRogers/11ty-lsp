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

/**
 * Insertion value to prevent AST parsing errors.
 */
const SENTINEL = "__completion__"

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
      contentBeforeOffset,
      contentAfterOffset
    } = getContext(document, position.line, position.character);

    // - 1 is an assumption since we're on a completion.
    const word = this.getWordAtCursor(currentLineContent, position.character, position.line);

    if (!word) { return completions }

    const patched = /\.\s*$/.test(contentBeforeOffset)
      ? contentBeforeOffset + SENTINEL + contentAfterOffset
      : contentBeforeOffset + contentAfterOffset

    const result = this.parser.parseContent(patched);
    let currentNode = this.parser.findNodeAtPosition(result.ast, position.line, position.character)

    logger.write({ currentNode })
    // completions.concat(this.getCompletionForNode(currentNode, data));
    // return Object.values(definitions.generalCompletions);
    // switch (context.type) {
    //   default:
    //     return this.getGeneralCompletions(document);
    // }

    return completions
  }


  getCompletionForNode(node: AnyNode | null, data?: DataOrError | null): CompletionItem[] {
    let completions: CompletionItem[] = [
    ]

    if (!node) { return completions }

    let value = null
    if (node.typename === "Symbol") {
      // @ts-expect-error
      value = data[node.value]
    }

    if (value) {
      const keys = Object.keys(value).map((key) => {
        return {
          label: key,
          kind: CompletionItemKind.Text,
        }
      })

      completions = completions.concat(keys)
    }

    return completions
  }



  resolveCompletion(item: CompletionItem): CompletionItem {
    return item;
  }

}
