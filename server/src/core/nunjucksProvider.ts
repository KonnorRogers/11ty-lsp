import { NunjucksParser } from "./nunjucksParser";
import { LookupVal } from "nunjucks/src/nodes.js";

export class NunjucksProvider {
  constructor(public parser: NunjucksParser) {}
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

  getKeysForLookupValNode (node: LookupVal) {
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

  dig(obj: unknown, ...args: any) {
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

  valueToText (value: unknown) {
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
}
