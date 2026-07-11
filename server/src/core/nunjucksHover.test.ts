import {test} from "node:test"
import assert from 'node:assert';

import { NunjucksParser } from "./nunjucksParser"
import { NunjucksHoverProvider } from "./nunjucksHover";

// test("Should properly get a word at cursor", () => {
//   const parser = new NunjucksParser({})
//   const hoverProvider = new NunjucksHoverProvider(parser)
//   const content = `{{ iAmVariable }}`
//   //       offset: 1234

//   const result = hoverProvider.getWordAtCursor(content, 4, 0)

//   assert.equal(result!.word, "iAmVariable")
// })

// test("Should include quotes", () => {
//   const parser = new NunjucksParser({})
//   const hoverProvider = new NunjucksHoverProvider(parser)
//   const content = `{% include "foo" %}`
//   const cursor = content.match(/foo/)?.index as number

//   const result = hoverProvider.getWordAtCursor(content, cursor, 0)

//   assert.equal(result!.word, "\"foo\"")
// })

// test("Should include quotes", () => {
//   const parser = new NunjucksParser({})
//   const hoverProvider = new NunjucksHoverProvider(parser)
//   const content = `<div>
//     {{ foo }}
//   </div>`
//   const lineNumber = 1
//   const colNumber = 7 // First "f" in "foo"
//   const result = hoverProvider.getWordAtCursor(content, colNumber, lineNumber)

//   assert.equal(result!.word, "\"foo\"")
// })
