import {test} from "node:test"
import assert from 'node:assert';

import { NunjucksParser } from "./nunjucksParser"
import { NunjucksValidator } from "./nunjucksValidator";

test("Should properly validate the AST", () => {
  const parser = new NunjucksParser({})
  const validatorProvider = new NunjucksValidator(parser)
  const content = `
    <div>
      {{ foo }
    </div>
  `

  const diagnostics = validatorProvider.validateContent(content, {})

  assert.equal(diagnostics.length, 1)


  assert.match(diagnostics[0].message, /expected variable end/)

  assert.deepEqual({
    start: { line: 2, character: 13 },
    end: { line: 2, character: 14 }
  }, diagnostics[0].range)
})

