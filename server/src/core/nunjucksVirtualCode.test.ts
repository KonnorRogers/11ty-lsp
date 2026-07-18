import { test } from "node:test"
import assert from "node:assert"

import type { NunjucksExtension } from "./nunjucksParser"
import { buildNunjucksTypeScriptSource } from "./nunjucksVirtualCode"

function textAt(generated: string, offset: number, length: number) {
  return generated.slice(offset, offset + length)
}

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

test("emits a typed `declare const data` header", () => {
  const { text } = buildNunjucksTypeScriptSource("{{ foo }}", { foo: "bar" })
  assert.match(text, /^declare const data: \{\s*\n\s*foo: "bar";\s*\n\s*\};\n/)
})

test("transcribes a top-level symbol as a member access on `data`", () => {
  const { text, mappings } = buildNunjucksTypeScriptSource("{{ foo }}", { foo: "bar" })
  assert.match(text, /\(data\.foo\);\n$/)

  assert.equal(mappings.length, 1)
  const [mapping] = mappings
  assert.equal(mapping.sourceOffsets[0], "{{ ".length)
  assert.equal(mapping.lengths[0], "foo".length)
  assert.equal(textAt(text, mapping.generatedOffsets[0], mapping.generatedLengths![0]), "foo")
})

test("maps each segment of a dotted chain independently", () => {
  const source = "{{ obj.a.b.c.d }}"
  const { text, mappings } = buildNunjucksTypeScriptSource(source, { obj: { a: { b: { c: { d: 1 } } } } })

  // One segment for the base `obj` symbol, plus one per `.a`/`.b`/`.c`/`.d`.
  assert.equal(mappings.length, 5)

  for (const mapping of mappings) {
    const sourceText = source.slice(mapping.sourceOffsets[0], mapping.sourceOffsets[0] + mapping.lengths[0])
    const generatedText = textAt(text, mapping.generatedOffsets[0], mapping.generatedLengths![0])
    // Segment source text (`.a`, `.b`, ...) should match the corresponding
    // piece of the generated member-access chain exactly.
    assert.equal(generatedText, sourceText)
  }
})

test("quotes non-identifier keys with bracket notation and still maps the whole key span", () => {
  const source = '{{ obj["weird key"] }}'
  const { text, mappings } = buildNunjucksTypeScriptSource(source, { obj: { "weird key": 1 } })

  assert.match(text, /data\.obj\["weird key"\]/)
  assert.equal(mappings.length, 2)
})

test("types the iterable side of a for-loop but not the bound variable", () => {
  const source = "{% for item in items %}{{ item }}{% endfor %}"
  const { text } = buildNunjucksTypeScriptSource(source, { items: ["a", "b"] })

  assert.match(text, /\(data\.items\);/)
  // `item` is loop-scoped, not a `data` property — it must not be transcribed.
  assert.doesNotMatch(text, /data\.item\b/)
})

test("skips computed member access (non-static keys)", () => {
  const source = "{{ obj[key] }}"
  const { text, mappings } = buildNunjucksTypeScriptSource(source, { obj: {}, key: "a" })

  // `obj` itself is still a valid top-level symbol reference.
  assert.match(text, /\(data\.obj\);/)
  // `key` is also a standalone top-level symbol.
  assert.match(text, /\(data\.key\);/)
  assert.equal(mappings.length, 2)
})

test("descends into filter targets", () => {
  const source = "{{ foo | first }}"
  const { text } = buildNunjucksTypeScriptSource(source, { foo: [1, 2] })
  assert.match(text, /\(data\.foo\);/)
})

test("recovers a dangling member-access dot (mid-typing `{{ page. }}`)", () => {
  const source = "{{ page. }}"
  const { text, mappings } = buildNunjucksTypeScriptSource(source, { page: { url: "/foo" } })

  // Without patching, nunjucks fails to parse this at all and nothing gets
  // transcribed — `page` must still show up as a member access on `data`.
  assert.match(text, /\(data\.page\.\w+\);/)
  assert.equal(mappings.length, 2)

  const dotMapping = mappings[1]
  // Covers the dot itself plus the whitespace before the closing `}}` —
  // same source span the old dig()-based completion's SENTINEL hack used.
  assert.equal(dotMapping.sourceOffsets[0], source.indexOf("."))
  assert.equal(dotMapping.lengths[0], 2)
})

test("without the real project extensions, a custom tag breaks parsing entirely", () => {
  const source = '{% image "src.jpg", page.url %}\n{{ bar }}'
  const { text } = buildNunjucksTypeScriptSource(source, { page: { url: "/foo" }, bar: "baz" })

  // Nunjucks doesn't recognize `image` as a tag, fails immediately, and
  // (per safeParseAsRoot) drops everything parsed after it too — so `bar`,
  // on the next line, never gets transcribed either.
  assert.doesNotMatch(text, /data\.page/)
  assert.doesNotMatch(text, /data\.bar/)
})

test("recognizes a custom tag/shortcode when the project's real nunjucks extensions are passed through", () => {
  const source = '{% image "src.jpg", page.url %}\n{{ bar }}'
  const { text } = buildNunjucksTypeScriptSource(
    source,
    { page: { url: "/foo" }, bar: "baz" },
    [fakeShortcodeExtension("image")]
  )

  // The shortcode's own arguments are still walked for data references...
  assert.match(text, /\(data\.page\.url\);/)
  // ...and parsing succeeds past the tag, so later expressions aren't lost.
  assert.match(text, /\(data\.bar\);/)
})

test("dangling dot doesn't lose expressions later in the document", () => {
  // A hard nunjucks parse error normally discards everything parsed after
  // it (see safeParseAsRoot) — confirm the patch prevents that fallout.
  const source = "{{ page. }}\n{{ bar }}"
  const { text } = buildNunjucksTypeScriptSource(source, { page: {}, bar: "baz" })
  assert.match(text, /\(data\.bar\);/)
})
