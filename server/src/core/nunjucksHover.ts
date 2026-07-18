import { TextDocument } from "vscode-languageserver-textdocument";
import { Hover, MarkupKind, Position, Range } from "vscode-css-languageservice";
import { NunjucksSettings } from "../settings/nunjucksSettings";
import { getContext } from "./getContext";
import * as definitions from "./definitions"
import { AnyNode, Literal, LookupVal, Symbol as SymbolNode } from "nunjucks/src/nodes.js";
import { logger } from "../logger";
import { NunjucksProvider } from "./nunjucksProvider";
import * as nodes from "nunjucks/src/nodes.js"

export class NunjucksHoverProvider extends NunjucksProvider {
  provideHover(
    document: TextDocument,
    position: Position,
    settings: NunjucksSettings,
    data: unknown
  ): Hover | null {
    const {
      currentLineContent,
    } = getContext(document, position.line, position.character);

    const word = this.getWordAtCursor(currentLineContent, position.character, position.line);

    if (!word) { return null }

    // do we need to parse??
    const result = this.parser.parseDocument(document);
    let { node, parents } = this.parser.findNodeAtPosition(result.ast, position.line, position.character)
    // logger.write(JSON.stringify(this.serializeNode(result.ast), null, 2))

    if (node) {
      let p: nodes.AnyNode | null = node;
      const chain: string[] = [];
      while (p) {
        chain.push(this.debugNode(p));
        p = parents.get(p) ?? null;
      }
      logger.write(chain.join(" -> "));
      // logger.write({ parents: JSON.stringify(parentNodes, null, 2) })
    }
    // logger.write({hi: "hi"})
    const hover = this.wordToHoverDocumentationForNode(node, word, data);

    // Find what's at the current position
    return hover;
  }

  debugNode (n: nodes.AnyNode | null) {
    let value = ""
    if (n?.typename === "LookupVal") {
      value = "val: " + JSON.stringify(n.val, null, 2)
    }
    if (n?.typename === "Symbol" || n?.typename === "Literal") {
      value = n.value
    }
    return n ? `${n.typename}(${n.lineno}:${n.colno}): ${value}` : "null";
  }

  findParentNodes (node: nodes.AnyNode) {
    const parents = [node]
    let currentNode = node
    while (true) {
      // @ts-expect-error
      if (currentNode.parent) {
        // @ts-expect-error
        parents.unshift(currentNode.parent)
        // @ts-expect-error
        currentNode = currentNode.parent
      } else {
        break
      }
    }

    return parents
  }

  /**
   * Walks back the content to just before the discovered word.
   */
  sliceLine (contentBeforeOffset: string, foundRange: Range) {
    return contentBeforeOffset.slice(0, foundRange.start.character)
  }

  /**
   * Provide a more contextual hover for a token
   */
  wordToHoverDocumentationForNode(
    node: AnyNode | null,
    word: ReturnType<typeof this.getWordAtCursor>,
    data?: unknown
  ): Hover | null {
    if (word == null) { return null }

    const contents = {
      contents: {
        kind: MarkupKind.PlainText,
        value: word.word,
      },
      range: word.range
    };

    if (!node) { return contents }

    const str = word.word

    // if (node.typename === "Tag" && definitions.tags[str]) {
    //   contents.contents.value += "Tag: " + definitions.tags[str].documentation as string
    //   return contents
    // }
    // contents.contents.value = node.typename + ": " + str + "\n\n"
    const debug = JSON.stringify(node, null, 2)
    contents.contents.value = `nodeType: ${node.typename}\n\n${debug}`

    if (node.typename === "Filter" && definitions.filters[str]) {
      const documentation = definitions.filters[str]?.documentation as string
      if (documentation) {
        contents.contents.value = documentation
        return contents
      }
    }

    // These are "top level" {{ thing }}
    if (node.typename === "Symbol") {
      // @ts-expect-error
      let value = data[node.value]

      contents.range = this.nodeToRange(node)
      contents.contents.value = `Value: ` + this.valueToText(value)
      return contents
    }

    // These are "nested" {{ data.thing }}
    if (node.typename === "LookupVal") {
      const keys = this.getKeysForLookupValNode(node)
      const val = this.dig(data, ...keys)

      contents.range = this.nodeToRange(node)
      contents.contents.value = `Value: ${this.valueToText(val)}\n`
    }

    if (node.typename === "Literal") {
      contents.range = this.nodeToRange(node)
      // Walk back to find closest LookupVal node.

    }

    // if (node.typename === "Global" && definitions.globalFunctions[str]) {
    //   contents.contents.value += "Global function: " + definitions.globalFunctions[str].documentation as string
    //   return contents
    // }

    return contents
  }

  nodeToRange (node: LookupVal | SymbolNode | Literal): Range {
    let value = ""
    if (node.typename === "Symbol" || node.typename === "Literal") {
      value = node.value
    }

    if (node.typename === "LookupVal") {
      value = node.val.value
    }

    return {
      start: {
        line: node.lineno,
        character: node.colno,
      },
      end: {
        line: node.lineno,
        character: node.colno + value.length
      }

    }
  }

  // private wordToHoverDocumentation(word: ReturnType<typeof this.getWordAtCursor>): Hover | null {
  //   if (word == null) { return null }

  //   const contents = {
  //     contents: {
  //       kind: MarkupKind.Markdown,
  //       value: word.word,
  //     },
  //     range: word.range
  //   };

  //   const str = word.word

  //   if (definitions.tags[str]) {
  //     contents.contents.value = "Tag: " + definitions.tags[str].documentation as string
  //     return contents
  //   }

  //   if (definitions.filters[str]) {
  //     contents.contents.value = "Filter: " + definitions.filters[str].documentation as string
  //     return contents
  //   }

  //   if (definitions.globalFunctions[str]) {
  //     contents.contents.value = "Global function: " + definitions.globalFunctions[str].documentation as string
  //     return contents
  //   }

  //   return contents
  // }
}
