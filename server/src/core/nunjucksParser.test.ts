import {test} from "node:test"
import assert from 'node:assert';

import * as nodes from "nunjucks/src/nodes.js"
import { NunjucksExtension, NunjucksParser } from "./nunjucksParser"
import { NEW_LINE } from "../constants";

test("Should properly find a symbol", () => {
  const parser = new NunjucksParser({})
  const result = parser.parseContent(`{{ iAmVariable }}`)

  if (!result.ast) { throw result.error }

  const symbols = result.ast.findAll(nodes.Symbol)
  symbols[0]
  assert.equal(symbols[0].value, "iAmVariable")
})

test("Should properly find a lookup target", () => {
  const parser = new NunjucksParser({})
  const { ast } = parser.parseContent(`{{ iAmVariable.foo }}`)
  const symbols = ast.findAll(nodes.Symbol)
  assert.equal(symbols[0].value, "iAmVariable")
})

function fakeShortcodeExtension(tagName: string): NunjucksExtension {
  return {
    tags: [tagName],
    parse(parserArg: any, nodesModule: any) {
      const tok = parserArg.nextToken()
      const args = parserArg.parseSignature(true, true)
      parserArg.advanceAfterBlockEnd(tok.value)
      return new nodesModule.CallExtension({ __name: tagName }, "run", args, [])
    },
  }
}

test("fails to parse a custom tag without its extension registered", () => {
  const parser = new NunjucksParser({})
  const { error } = parser.parseContent(`{% mytag foo %}`)
  assert.match(error?.message ?? "", /unknown block tag/)
})

test("parses a custom tag when its extension is passed through", () => {
  const parser = new NunjucksParser({})
  const { error, ast } = parser.parseContent(`{% mytag foo, bar.baz %}`, [fakeShortcodeExtension("mytag")])

  assert.equal(error, null)
  // The custom tag's arguments are still real Symbol/LookupVal nodes,
  // walkable the same as any other expression.
  const symbols = ast.findAll(nodes.Symbol)
  assert.deepEqual(symbols.map((s) => s.value), ["foo", "bar"])
})

// test("Should properly find a target a lineno + colno", () => {
//   const parser = new NunjucksParser({})
//   const content = `<div>
//     {{ data | first }}
//   </div>`
//   const { ast } = parser.parseContent(content)

//   const line = 2 // lines are 1-indexed apparently.
//   const rangeForFirst = content.split(NEW_LINE)[line - 1]
//   const characterStart = rangeForFirst.search("first")
//   const characterEnd = characterStart + "first".length

//   // Nunjucks is 1-indexed for line nos / colnos
//   const foundNode = parser.findNodeInRange(ast, {
//     start: {
//       line: line,
//       character: characterStart // r in first
//     },
//     end: {
//       line: line,
//       character: characterEnd - 1
//     }
//   })

//   assert.equal(foundNode?.typename, "Filter")
// })
