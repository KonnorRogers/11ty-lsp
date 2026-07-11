import {test} from "node:test"
import assert from 'node:assert';

import * as nodes from "nunjucks/src/nodes.js"
import { NunjucksParser } from "./nunjucksParser"

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

test("Should properly find a target a lineno + colno", () => {
  const parser = new NunjucksParser({})
  const content = `<div>
    {{ data | first }}
  </div>`
  const { ast } = parser.parseContent(content)

  const line = 2 // lines are 1-indexed apparently.
  const rangeForFirst = content.split("\n")[line - 1]
  const characterStart = rangeForFirst.search("first")
  const characterEnd = characterStart + "first".length

  // Nunjucks is 1-indexed for line nos / colnos
  const foundNode = parser.findNodeInRange(ast, {
    start: {
      line: line,
      character: characterStart // r in first
    },
    end: {
      line: line,
      character: characterEnd - 1
    }
  })

  assert.equal(foundNode?.typename, "Filter")
})
