import {test} from "node:test"
import assert from 'node:assert';

import { NunjucksParser } from "./nunjucksParser"
import { NunjucksHoverProvider } from "./nunjucksHover";
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

  assert.deepEqual({
    message: 'expected variable end',
    range: {
      start: { line: 3, character: 14 },
      end: { line: 3, character: 14 }
    }
  }, diagnostics[0])
})

