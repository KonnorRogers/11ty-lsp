import { test } from "node:test"
import assert from "node:assert"

import { jsonValueToTsType, jsonValueToTsTypeDeclaration } from "./jsonToTsType"

test("literal-types top-level/object-property primitives", () => {
  assert.equal(jsonValueToTsType("hello"), '"hello"')
  assert.equal(jsonValueToTsType(42), "42")
  assert.equal(jsonValueToTsType(true), "true")
  assert.equal(jsonValueToTsType(null), "null")
  assert.equal(jsonValueToTsType(undefined), "undefined")
})

test("produces a structural type literal for objects, with literal property values", () => {
  const result = jsonValueToTsType({ foo: "bar", obj: { a: "A" } })
  assert.match(result, /foo: "bar";/)
  assert.match(result, /obj: \{\s*a: "A";\s*\};/)
})

test("quotes non-identifier property keys", () => {
  const result = jsonValueToTsType({ "data-id": 1, "valid_key": 2 })
  assert.match(result, /"data-id": 1;/)
  assert.match(result, /valid_key: 2;/)
})

test("widens (not literal-unions) homogeneous array elements", () => {
  assert.equal(jsonValueToTsType(["Apples", "Bananas"]), "string[]")
})

test("unions widened element types for heterogeneous arrays", () => {
  const result = jsonValueToTsType([1, "two"])
  assert.equal(result, "(number | string)[]")
})

test("keeps properties of array elements widened, not literal", () => {
  // Once inside an array, every descendant is non-representative of a
  // single fixed value (other posts have different titles) — even though
  // `title` is reached via plain property access, it must stay `string`.
  const result = jsonValueToTsType([{ title: "Hello world" }])
  assert.match(result, /title: string;/)
  assert.match(result, /\[\]$/)
  // Widened array-element properties shouldn't get a value-preview doc
  // comment either (it would misleadingly imply every element matches it).
  assert.doesNotMatch(result, /\/\*\*/)
})

test("falls back to unknown[]/Record<string, unknown> for empty collections", () => {
  assert.equal(jsonValueToTsType([]), "unknown[]")
  assert.equal(jsonValueToTsType({}), "Record<string, unknown>")
})

test("treats Date instances as the Date type", () => {
  assert.equal(jsonValueToTsType(new Date()), "Date")
})

test("guards against circular references", () => {
  const obj: Record<string, unknown> = { foo: "bar" }
  obj.self = obj
  const result = jsonValueToTsType(obj)
  assert.match(result, /foo: "bar";/)
  assert.match(result, /self: unknown;/)
})

test("jsonValueToTsTypeDeclaration wraps the type in a named declaration", () => {
  const result = jsonValueToTsTypeDeclaration({ foo: "bar" }, "PageData")
  assert.match(result, /^type PageData = \{/)
  assert.match(result, /foo: "bar";/)
})

test("attaches a JSON preview as JSDoc documentation for object/array-valued properties", () => {
  const result = jsonValueToTsType({ items: ["Apples", "Bananas"], obj: { a: "A" } })
  assert.match(result, /\/\*\* \["Apples","Bananas"\] \*\/\s*\n\s*items: string\[\];/)
  assert.match(result, /\/\*\* \{"a":"A"\} \*\/\s*\n\s*obj: /)
})
