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
import * as nodes from "nunjucks/src/nodes.js"
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
    let completions: CompletionItem[] = []

    const {
      currentLineContent,
      contentBeforeOffset,
      contentAfterOffset,
      contentOnLineBeforeOffset,
      contentOnLineAfterOffset
    } = getContext(document, position.line, position.character);

    const word = this.getWordAtCursor(currentLineContent, position.character - 1, position.line);

    if (!word) { return completions }

    const patched = /\.\s*$/.test(contentBeforeOffset)
      ? contentBeforeOffset + contentBeforeOffset + SENTINEL + contentOnLineAfterOffset + contentAfterOffset
      : contentBeforeOffset + currentLineContent + contentAfterOffset

    const result = this.parser.parseContent(patched);
    const {node, parents} = this.parser.findNodeAtPosition(result.ast, position.line, position.character - 1)
    const value = this.getValueForNode(node, parents, data)

    completions = this.getCompletionsForValue(value)

    return completions
  }

  getValueForNode (node: AnyNode | null, parents: Map<AnyNode, AnyNode | null>, data?: DataOrError | null) {
    if (!node) { return null }
    if (!data) { return null }

    // These are "top level" {{ thing }}
    if (node.typename === "Symbol") {
      // // @ts-expect-error
      // let value = data[node.value]

      return data
    }

    // These are "nested" {{ data.thing }}
    if (node.typename === "LookupVal") {
      const keys = this.getKeysForLookupValNode(node)
      const context = this.dig(data, ...keys.slice(0, keys.length - 1))

      return context
    }

    // These are terminating points of a LookupVal {{ data.foo.bar }}
    //                                                          ^ Literal
    //                                                      ^ LookupVal
    //                                                 ^ LookupVal
    if (node.typename === "Literal") {
      const nodeParents = this.getParentsForNode(node, parents)
      let parentLookupNode: nodes.LookupVal | null = null
      for (const p of nodeParents) {
        if (p.typename === "LookupVal") {
          parentLookupNode = p
          break
        }
      }

      // Walk back to find closest LookupVal node.
      if (parentLookupNode) {
        const keys = this.getKeysForLookupValNode(parentLookupNode)
        if (keys.length > 1) {
          // We need to slice off the last key because we're getting completions for the previous object.
          const context = this.dig(data, ...keys.slice(0, keys.length - 1))
          return context
        }
      }
    }

    return null
  }


  getCompletionsForValue(value: any): CompletionItem[] {
    let completions: CompletionItem[] = []

    if (value == null) { return completions }

    Object.keys(value).forEach((key) => {
      completions.push({
        label: key,
        detail: `Value: ` + this.valueToText(value[key]),
        kind: CompletionItemKind.Text,
      })
    })

    return completions
  }



  resolveCompletion(item: CompletionItem): CompletionItem {
    return item;
  }

}
