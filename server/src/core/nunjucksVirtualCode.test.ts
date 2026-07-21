import { test } from "node:test"
import assert from "node:assert"

import type { NunjucksExtension } from "./nunjucksParser"
import { buildNunjucksTypeScriptSource, patchDanglingMemberAccess, SENTINEL } from "./nunjucksVirtualCode"

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

// test("emits a typed `declare const data` header", () => {
//   const { text } = buildNunjucksTypeScriptSource("{{ foo }}", { foo: "bar" })
//   assert.match(text, /^declare const data: \{\s*\n\s*foo: "bar";\s*\n\s*\};\n/)
// })

// test("transcribes a top-level symbol as a member access on `data`", () => {
//   const { text, mappings } = buildNunjucksTypeScriptSource("{{ foo }}", { foo: "bar" })
//   assert.match(text, /\(data\.foo\);\nexport \{\};\n$/)

//   assert.equal(mappings.length, 1)
//   const [mapping] = mappings
//   assert.equal(mapping.sourceOffsets[0], "{{ ".length)
//   assert.equal(mapping.lengths[0], "foo".length)
//   assert.equal(textAt(text, mapping.generatedOffsets[0], mapping.generatedLengths![0]), "foo")
// })

// test("maps each segment of a dotted chain independently", () => {
//   const source = "{{ obj.a.b.c.d }}"
//   const { text, mappings } = buildNunjucksTypeScriptSource(source, { obj: { a: { b: { c: { d: 1 } } } } })

//   // One segment for the base `obj` symbol, plus one per `.a`/`.b`/`.c`/`.d`.
//   assert.equal(mappings.length, 5)

//   for (const mapping of mappings) {
//     const sourceText = source.slice(mapping.sourceOffsets[0], mapping.sourceOffsets[0] + mapping.lengths[0])
//     const generatedText = textAt(text, mapping.generatedOffsets[0], mapping.generatedLengths![0])
//     // Segment source text (`.a`, `.b`, ...) should match the corresponding
//     // piece of the generated member-access chain exactly.
//     assert.equal(generatedText, sourceText)
//   }
// })

// test("quotes non-identifier keys with bracket notation and still maps the whole key span", () => {
//   const source = '{{ obj["weird key"] }}'
//   const { text, mappings } = buildNunjucksTypeScriptSource(source, { obj: { "weird key": 1 } })

//   assert.match(text, /data\.obj\["weird key"\]/)
//   assert.equal(mappings.length, 2)
// })

// test("types the iterable side of a for-loop but not the bound variable", () => {
//   const source = "{% for item in items %}{{ item }}{% endfor %}"
//   const { text } = buildNunjucksTypeScriptSource(source, { items: ["a", "b"] })

//   assert.match(text, /\(data\.items\);/)
//   // `item` is loop-scoped, not a `data` property — it must not be transcribed.
//   assert.doesNotMatch(text, /data\.item\b/)
// })

// test("skips computed member access (non-static keys)", () => {
//   const source = "{{ obj[key] }}"
//   const { text, mappings } = buildNunjucksTypeScriptSource(source, { obj: {}, key: "a" })

//   // `obj` itself is still a valid top-level symbol reference.
//   assert.match(text, /\(data\.obj\);/)
//   // `key` is also a standalone top-level symbol.
//   assert.match(text, /\(data\.key\);/)
//   assert.equal(mappings.length, 2)
// })

// test("descends into filter targets", () => {
//   const source = "{{ foo | first }}"
//   const { text } = buildNunjucksTypeScriptSource(source, { foo: [1, 2] })
//   assert.match(text, /\(data\.foo\);/)
// })

// test("recovers a dangling member-access dot (mid-typing `{{ page. }}`)", () => {
//   const source = "{{ page. }}"
//   const { text, mappings } = buildNunjucksTypeScriptSource(source, { page: { url: "/foo" } })

//   // Without patching, nunjucks fails to parse this at all and nothing gets
//   // transcribed — `page` must still show up as a member access on `data`.
//   assert.match(text, /\(data\.page\.\w+\);/)
//   assert.equal(mappings.length, 2)

//   const dotMapping = mappings[1]
//   // Covers the dot itself plus the whitespace before the closing `}}` —
//   // same source span the old dig()-based completion's SENTINEL hack used.
//   assert.equal(dotMapping.sourceOffsets[0], source.indexOf("."))
//   assert.equal(dotMapping.lengths[0], 2)
// })

// test("recovers a tag with no closing delimiter at all (mid-typing `{{ page`)", () => {
//   const source = "{{ page"
//   const { text } = buildNunjucksTypeScriptSource(source, { page: { url: "/foo" } })

//   // No dangling dot here, just an unclosed `{{` — nunjucks would otherwise
//   // consume the rest of the document looking for `}}` and never finish
//   // parsing; `page` should still show up as a plain member access on `data`.
//   assert.match(text, /\(data\.page\);/)
// })

// test("an unclosed tag doesn't lose expressions on later lines", () => {
//   const source = "{% if page\n{{ bar }}"
//   const { text } = buildNunjucksTypeScriptSource(source, { page: {}, bar: "baz" })

//   assert.match(text, /\(data\.bar\);/)
// })

// test("multiple dangling dots on the same line each map to their own correct source span", () => {
//   const source = "{{ a. }} {{ b.name }}"
//   const { mappings } = buildNunjucksTypeScriptSource(source, { a: { x: 1 }, b: { name: "n" } })

//   // `a`'s dangling dot gets patched with a sentinel that isn't length
//   // preserving — `b.name`, later on the same line, must still map to its
//   // own real, unshifted source range rather than something corrupted by
//   // the earlier insertion.
//   const bNameMapping = mappings.find((m) => source.slice(m.sourceOffsets[0], m.sourceOffsets[0] + m.lengths[0]) === ".name")
//   assert.ok(bNameMapping, "expected a mapping covering the literal `.name` text")
//   assert.equal(bNameMapping!.sourceOffsets[0], source.indexOf(".name"))
// })

// test("without the real project extensions, a custom tag breaks parsing entirely", () => {
//   const source = '{% image "src.jpg", page.url %}\n{{ bar }}'
//   const { text } = buildNunjucksTypeScriptSource(source, { page: { url: "/foo" }, bar: "baz" })

//   // Nunjucks doesn't recognize `image` as a tag, fails immediately, and
//   // (per safeParseAsRoot) drops everything parsed after it too — so `bar`,
//   // on the next line, never gets transcribed either.
//   assert.doesNotMatch(text, /data\.page/)
//   assert.doesNotMatch(text, /data\.bar/)
// })

// test("recognizes a custom tag/shortcode when the project's real nunjucks extensions are passed through", () => {
//   const source = '{% image "src.jpg", page.url %}\n{{ bar }}'
//   const { text } = buildNunjucksTypeScriptSource(
//     source,
//     { page: { url: "/foo" }, bar: "baz" },
//     [fakeShortcodeExtension("image")]
//   )

//   // The shortcode's own arguments are still walked for data references...
//   assert.match(text, /\(data\.page\.url\);/)
//   // ...and parsing succeeds past the tag, so later expressions aren't lost.
//   assert.match(text, /\(data\.bar\);/)
// })

// test("dangling dot doesn't lose expressions later in the document", () => {
//   // A hard nunjucks parse error normally discards everything parsed after
//   // it (see safeParseAsRoot) — confirm the patch prevents that fallout.
//   const source = "{{ page. }}\n{{ bar }}"
//   const { text } = buildNunjucksTypeScriptSource(source, { page: {}, bar: "baz" })
//   assert.match(text, /\(data\.bar\);/)
// })

test("dangling dot doesn't lose expressions later in the document", {only: true}, () => {
  // A hard nunjucks parse error normally discards everything parsed after
  // it (see safeParseAsRoot) — confirm the patch prevents that fallout.
  const source = "{{ page. }}\n{{ bar }}"
  const { text } = patchDanglingMemberAccess(source)
  console.log({ text })

  // make sure it doesn't leak
  assert.match(text, new RegExp(`{{ page.${SENTINEL} }}`))
  assert.match(text, new RegExp(`{{ bar }}`))
})

test("sentinel gets inserted", {only: true}, () => {
  // A hard nunjucks parse error normally discards everything parsed after
  // it (see safeParseAsRoot) — confirm the patch prevents that fallout.
  const source = "{{ page."
  const { text } = patchDanglingMemberAccess(source)

  assert.match(text, new RegExp(SENTINEL))
})

test("Should properly insert when multiple on same line", () => {
  // A hard nunjucks parse error normally discards everything parsed after
  // it (see safeParseAsRoot) — confirm the patch prevents that fallout.
  const source = "{{ page. }} {{ bar }}"
  const { text } = patchDanglingMemberAccess(source)
  console.log({ text })

  assert.match(text, new RegExp(`{{ page.${SENTINEL} }} {{ bar }}`))
})

test("Should properly insert when only {{ is provided with no whitespace", {only: true}, () => {
  const source = "{{"
  const { text } = patchDanglingMemberAccess(source)
  console.log({ text })

  assert.match(text, new RegExp(`{{ ${SENTINEL} }}`))
})

test("Should properly insert when {{ is provided with whitespace", () => {
  const source = "{{ "
  const { text } = patchDanglingMemberAccess(source)
  console.log({ text })

  assert.match(text, new RegExp(`{{ ${SENTINEL} }}`))
})

// The sentinel is *inserted*, so it shifts every offset after it. These guard
// that mappings stay expressed in original-document coordinates rather than
// leaking the patched ones.
test("sentinel insertions don't leak into source mapping offsets", () => {
  for (const source of ["{{ eleventy.", "{{ eleventy. }}", "{{ a }}\n{{ eleventy.\n", "{{", "{{ "]) {
    const { mappings } = buildNunjucksTypeScriptSource(source, { eleventy: { version: "3.0" }, a: 1 })
    for (const m of mappings) {
      const start = m.sourceOffsets[0]
      const end = start + m.lengths[0]
      assert.ok(
        end <= source.length,
        `${JSON.stringify(source)}: mapping [${start},${end}) runs past the ${source.length}-char document`
      )
      assert.ok(
        !source.slice(start, end).includes(SENTINEL),
        `${JSON.stringify(source)}: sentinel text leaked into a source range`
      )
    }
  }
})

test("dangling dot maps the caret onto the real member access", () => {
  const source = "{{ eleventy."
  const { text, mappings } = buildNunjucksTypeScriptSource(source, { eleventy: { version: "3.0" } })

  // The segment covering the dot spans exactly the one `.` the user typed,
  // while the generated side carries the full `.__COMPLETION__`.
  const dot = mappings.find((m) => m.sourceOffsets[0] === source.indexOf("."))
  assert.ok(dot, "expected a mapping anchored at the dangling dot")
  assert.equal(dot.lengths[0], 1)
  assert.equal(textAt(text, dot.generatedOffsets[0], dot.generatedLengths![0]), `.${SENTINEL}`)

  // Caret sits one char into that segment, which puts it directly after the
  // `.` in `data.eleventy.` — where TS lists members of `eleventy`.
  const caret = dot.generatedOffsets[0] + 1
  assert.ok(text.slice(0, caret).endsWith("data.eleventy."))
})

// Recovery shapes that have to keep the *rest* of the document parseable —
// a synthetic closer placed at EOF instead of the tag's own line end used to
// swallow the trailing HTML and drop every completion in the file.
test("patching keeps the document parseable around incomplete tags", () => {
  const cases: Array<[string, string]> = [
    ["{{ eleventy.\n</body>", "dangling dot, unclosed"],
    ["{{ eleventy.\n{{ obj.a }}\n", "dangling dot above another tag"],
    ["{{ \n</body>", "empty unclosed tag"],
    ["{{  }}\n", "empty closed tag"],
    ["{% if eleventy. %}\n{% endif %}\n", "dangling dot in a block tag"],
  ]
  for (const [source, label] of cases) {
    const { text } = patchDanglingMemberAccess(source)
    assert.ok(text.includes(SENTINEL), `${label}: expected a sentinel in ${JSON.stringify(text)}`)
    // The synthetic closer must land on the incomplete tag's own line.
    const sentinelLine = text.slice(0, text.indexOf(SENTINEL)).split("\n").length
    const closerLine = text.slice(0, text.indexOf("}", text.indexOf(SENTINEL))).split("\n").length
    assert.equal(closerLine, sentinelLine, `${label}: closer escaped its line in ${JSON.stringify(text)}`)
  }
})

test("a dangling dot doesn't consume the following tag's closer", () => {
  const { text } = patchDanglingMemberAccess("{{ eleventy.\n{{ obj.a }}\n")
  // Both tags stay independent; the second is untouched.
  assert.ok(text.includes(`{{ eleventy.${SENTINEL} }}`), text)
  assert.ok(text.includes("{{ obj.a }}"), text)
})

test("empty tags map the caret anywhere in the gap onto the sentinel", () => {
  for (const source of ["{{  }}", "{{ "]) {
    const { mappings } = buildNunjucksTypeScriptSource(source, { foo: 1 })
    const synthetic = mappings.find((m) => m.lengths.every((l) => l === 0))
    assert.ok(synthetic, `${JSON.stringify(source)}: expected a zero-length synthetic mapping`)
    // The caret sits right after "{{ " — that offset must be covered.
    assert.ok(
      synthetic.sourceOffsets.includes(3),
      `${JSON.stringify(source)}: caret offset 3 not in ${JSON.stringify(synthetic.sourceOffsets)}`
    )
  }
})

// —— typed filters ——
// A filter is transcribed into a call on the synthesized `__filters` object,
// so TypeScript can type it and propagate its return type.
function statementFor(source: string, data: unknown) {
  const { text } = buildNunjucksTypeScriptSource(source, data)
  return text.split("\n").find((l) => l.startsWith("(") && !l.startsWith("(undefined")) ?? ""
}

test("a filter becomes a call on __filters with the piped value first", () => {
  assert.equal(statementFor("{{ foo | upper }}", { foo: "x" }), "(__filters.upper(data.foo));")
  assert.equal(statementFor("{{ nums | sum }}", { nums: [1] }), "(__filters.sum(data.nums));")
})

test("filter arguments are transcribed after the input", () => {
  assert.equal(statementFor("{{ foo | replace('a', 'b') }}", { foo: "x" }), '(__filters.replace(data.foo, "a", "b"));')
})

test("chained filters nest, innermost pipe first", () => {
  assert.equal(
    statementFor("{{ items | first | upper }}", { items: ["x"] }),
    "(__filters.upper(__filters.first(data.items)));"
  )
})

test("member access on a filtered value transcribes for return-type propagation", () => {
  assert.equal(
    statementFor("{{ (items | first).name }}", { items: [{ name: "x" }] }),
    "(__filters.first(data.items).name);"
  )
})

test("an unknown (custom) filter still transcribes, typed loosely via the index signature", () => {
  assert.equal(statementFor("{{ foo | titlecase }}", { foo: "x" }), "(__filters.titlecase(data.foo));")
})

test("the __filters declaration is emitted and self-consistent", () => {
  const { text } = buildNunjucksTypeScriptSource("{{ foo | upper }}", { foo: "x" })
  assert.match(text, /declare const __filters: \{/)
  assert.match(text, /first<T>\(input: readonly T\[\]\): T;/)
  assert.match(text, /\[filter: string\]: \(input: any, \.\.\.args: any\[\]\) => any;/)
})

test("the filter name maps for hover but opts out of completion", () => {
  const source = "{{ foo | upper }}"
  const { text, mappings } = buildNunjucksTypeScriptSource(source, { foo: "x" })
  const nameStart = source.indexOf("upper")
  const nameMapping = mappings.find((m) => m.sourceOffsets[0] === nameStart)
  assert.ok(nameMapping, "expected a mapping over the filter name")
  assert.equal(nameMapping.data.completion, false, "filter-name completion belongs to the service plugin")
  assert.equal(nameMapping.data.navigation, true)
  // …and it points at the __filters member, not a data property.
  assert.equal(textAt(text, nameMapping.generatedOffsets[0], nameMapping.generatedLengths![0]), "upper")
})

// —— {% set %} and array literals ——
test("an array literal transcribes so filters get an element type", () => {
  assert.equal(statementFor('{{ ["a", "b"] | first }}', {}), '(__filters.first(["a", "b"]));')
})

test("{% set %} declares a typed local, not a data property", () => {
  const { text } = buildNunjucksTypeScriptSource('{% set l = ["bar", "baz"] | first %}', {})
  assert.match(text, /const __njk_l = __filters\.first\(\["bar", "baz"\]\);/)
  // The value flows through, so `l` is `string`, never `data.l`.
  assert.doesNotMatch(text, /data\.l\b/)
})

test("a reference to a set variable resolves to the local", () => {
  const { text } = buildNunjucksTypeScriptSource("{% set x = 5 %}{{ x }}", {})
  assert.match(text, /const __njk_x = 5;/)
  assert.match(text, /\(__njk_x\);/)
  assert.doesNotMatch(text, /data\.x\b/)
})

test("member access on a set variable works", () => {
  const { text } = buildNunjucksTypeScriptSource("{% set d = obj.d %}{{ d.e }}", { obj: { d: { e: 1 } } })
  assert.match(text, /const __njk_d = data\.obj\.d;/)
  assert.match(text, /\(__njk_d\.e\);/)
})

test("the set target maps back to the source variable name", () => {
  const source = '{% set l = ["bar"] | first %}'
  const { text, mappings } = buildNunjucksTypeScriptSource(source, {})
  const varOffset = source.indexOf("set ") + 4
  const mapping = mappings.find((m) => m.sourceOffsets[0] === varOffset)
  assert.ok(mapping, "expected a mapping over the set variable name")
  assert.equal(textAt(text, mapping.generatedOffsets[0], mapping.generatedLengths![0]), "__njk_l")
})
