import { TextDocument } from "vscode-languageserver-textdocument";
import { NunjucksParser } from "./nunjucksParser";
import { Hover, MarkupKind, Position, Range } from "vscode-css-languageservice";
import { NunjucksSettings } from "../settings/nunjucksSettings";
import { getContext } from "./getContext";
import * as definitions from "./definitions"
import { AnyNode, LookupVal } from "nunjucks/src/nodes.js";
import { logger } from "../logger";

function getKeysForLookupValNode (node: LookupVal) {
  let target = null
  const keys = []
  let currentNode = node
  while (true) {
    target = currentNode.target

    if (target == null) {
      break
    }

    if ("value" in target) {
      keys.unshift(target.value)
    }

    if ("val" in target) {
      keys.unshift(target.val.value)
    }

    // @ts-expect-error
    currentNode = target
  }

  const key = node.val.value
  keys.push(key)
  return keys
}

function dig(obj: unknown, ...args: any) {
  let current: unknown = obj;
  for (const key of args) {
    if (current == null) return current;
    try {
      // @ts-expect-error
      current = current[key];
    } catch (_e) {
      current = undefined
      break;
    }
  }
  return current;
}

function valueToText (value: unknown) {
  if (typeof value === "object") {
    const name = value?.constructor?.name
    value = JSON.stringify(value, null, 2)

    if (name) {
      value = name + " " + value
    }
  } else {
    if (typeof value === "string") {
      value = "\"" + value + "\""
    } else {
      value = String(value)
    }
  }

  return value
}

export class NunjucksHoverProvider {
  constructor(public parser: NunjucksParser) {}

  provideHover(
    document: TextDocument,
    position: Position,
    settings: NunjucksSettings,
    data: unknown
  ): Hover | null {
    const {
      previousContent,
      currentLineContent,
      // contentBeforeOffset,
    } = getContext(document, position.line, position.character);

    const word = this.getWordAtCursor(currentLineContent, position.character, position.line);

    if (!word) { return null }

    // Parse the whole line so we can get a better AST representation, then we'll walk back to the AST to the position.character.
    let content = previousContent + "\n" + currentLineContent

    // do we need to parse??
    let result = this.parser.parseContent(content)
    let currentNode = this.parser.findNodeInRange(result.ast, {
      start: {
        // these ranges are off by 1 from Nunjucks parsing yayyy...
        line: word.range.start.line + 1,
        character: word.range.start.character,
      },
      end: {
        line: word.range.end.line + 1,
        character: word.range.end.character,
      }
    })

    if (!currentNode) {
      // Walk back more. Go to start / end of line.
      result = this.parser.parseDocument(document)
      currentNode = this.parser.findNodeInRange(result.ast, {
        start: {
          line: position.line + 1,
          character: 0,
        },
        end: {
          line: position.line + 1,
          character: currentLineContent.length - 1,
        }
      })

      if (!currentNode) {
        logger.write({
          char: position.character,
          line: position.line,
          currentLineContent,
          parser: this.parser.parseDocument(document)
        })
      }
    }


    const hover = this.wordToHoverDocumentationForNode(currentNode, word, data);

    // Find what's at the current position
    return hover;
  }

  /**
   * Walks back the content to just before the discovered word.
   */
  sliceLine (contentBeforeOffset: string, foundRange: Range) {
    return contentBeforeOffset.slice(0, foundRange.start.character)
  }

  getWordAtCursor (lineContent: string, offset: number, lineNumber: number) {
    const charAtCursor = lineContent[offset]

    // TODO: If we encounter ".", we need to use the parser to get "context"
    const isNotSpaceRegex = /\S/

    if (!charAtCursor.match(isNotSpaceRegex)) {
      return null
    }

    // Start at the end of the string and work backwards until we hit empty space
    let word = [charAtCursor]

    let startOffset = offset
    let endOffset = offset

    for (let i = offset - 1; i > 0; i--) {
      const currentLetter = lineContent[i]
      if (!currentLetter.match(isNotSpaceRegex)) {
        break
      }

      startOffset -= 1
      word.unshift(currentLetter)
    }

    for (let i = offset + 1; i < lineContent.length; i++) {
      const currentLetter = lineContent[i]
      if (!currentLetter.match(isNotSpaceRegex)) {
        break
      }

      endOffset += 1
      word.push(currentLetter)
    }

    return {
      word: word.join(""),
      range: {
        start: { line: lineNumber, character: startOffset },
        end: { line: lineNumber, character: endOffset + 1 },
      }
    }
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

      contents.contents.value = `Value: ` + valueToText(value)
      return contents
    }

    // These are "nested" {{ data.thing }}
    if (node.typename === "LookupVal") {
      const keys = getKeysForLookupValNode(node)
      const val = dig(data, ...keys)

      contents.contents.value = `Value: ${valueToText(val)}\n`
    }

    // if (node.typename === "Global" && definitions.globalFunctions[str]) {
    //   contents.contents.value += "Global function: " + definitions.globalFunctions[str].documentation as string
    //   return contents
    // }

    return contents
  }

  private wordToHoverDocumentation(word: ReturnType<typeof this.getWordAtCursor>): Hover | null {
    if (word == null) { return null }

    const contents = {
      contents: {
        kind: MarkupKind.Markdown,
        value: word.word,
      },
      range: word.range
    };

    const str = word.word

    if (definitions.tags[str]) {
      contents.contents.value = "Tag: " + definitions.tags[str].documentation as string
      return contents
    }

    if (definitions.filters[str]) {
      contents.contents.value = "Filter: " + definitions.filters[str].documentation as string
      return contents
    }

    if (definitions.globalFunctions[str]) {
      contents.contents.value = "Global function: " + definitions.globalFunctions[str].documentation as string
      return contents
    }

    return contents
  }
}
