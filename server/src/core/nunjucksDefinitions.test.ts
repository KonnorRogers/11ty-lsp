import { test } from "node:test"
import assert from "node:assert"

import { completionSlotAt, createDefinitionCollector, snippetFor, splitParams, type NunjucksDefinition } from "./nunjucksDefinitions"

/** Stand-in for 11ty's UserConfig — only the methods the collector wraps. */
function fakeUserConfig() {
  const calls: Array<{ method: string; name: string }> = []
  const make = (method: string) => (name: string, _fn: unknown) => { calls.push({ method, name }) }
  return {
    calls,
    config: {
      addShortcode: make("addShortcode"),
      addNunjucksShortcode: make("addNunjucksShortcode"),
      addPairedShortcode: make("addPairedShortcode"),
      addAsyncShortcode: make("addAsyncShortcode"),
      addNunjucksTag: make("addNunjucksTag"),
      addFilter: make("addFilter"),
      addNunjucksFilter: make("addNunjucksFilter"),
    } as Record<string, unknown>,
  }
}

test("splitParams ignores commas nested in defaults", () => {
  assert.deepEqual(splitParams("src, alt, widths = [400, 800]"), ["src", " alt", " widths = [400, 800]"])
  assert.deepEqual(splitParams("a, b = { x: 1, y: 2 }"), ["a", " b = { x: 1, y: 2 }"])
  assert.deepEqual(splitParams('a, b = "x,y"'), ["a", ' b = "x,y"'])
})

test("captures registrations with their real parameter names", () => {
  const { config } = fakeUserConfig()
  const collector = createDefinitionCollector()
  collector.install(config)

  ;(config.addShortcode as Function)("image", function (src: unknown, alt: unknown, widths = [400, 800]) {})
  ;(config.addAsyncShortcode as Function)("remoteTitle", async function (url: unknown) {})
  ;(config.addNunjucksTag as Function)("banner", function (engine: unknown) {})

  const defs = collector.definitions()
  const image = defs.find((d) => d.name === "image")
  assert.deepEqual(image?.params, ["src", "alt", "widths"], "default values should be stripped")
  assert.equal(image?.kind, "shortcode")

  const remote = defs.find((d) => d.name === "remoteTitle")
  assert.equal(remote?.isAsync, true)

  // A raw tag's function receives the engine, not the tag's call arguments.
  assert.deepEqual(defs.find((d) => d.name === "banner")?.params, [])
})

test("a paired shortcode hides the content argument 11ty supplies", () => {
  const { config } = fakeUserConfig()
  const collector = createDefinitionCollector()
  collector.install(config)

  ;(config.addPairedShortcode as Function)("callout", function (content: unknown, level: unknown) {})

  const callout = collector.definitions().find((d) => d.name === "callout")
  assert.equal(callout?.kind, "pairedShortcode")
  assert.deepEqual(callout?.params, ["level"])
})

test("the mirrored registration doesn't clobber real parameter names", () => {
  const { config } = fakeUserConfig()
  const collector = createDefinitionCollector()
  collector.install(config)

  // This is what 11ty does internally: the universal registration carries the
  // author's function, the nunjucks-specific mirror carries a `(...args)` wrapper.
  ;(config.addFilter as Function)("titlecase", function (str: unknown) {})
  ;(config.addNunjucksFilter as Function)("titlecase", function (...args: unknown[]) {})

  const titlecase = collector.definitions().filter((d) => d.name === "titlecase")
  assert.equal(titlecase.length, 1, "should dedupe to a single definition")
  assert.deepEqual(titlecase[0].params, ["str"])
})

test("registrations still reach the underlying config", () => {
  const { config, calls } = fakeUserConfig()
  createDefinitionCollector().install(config)
  ;(config.addShortcode as Function)("shout", function (value: unknown) {})
  assert.deepEqual(calls, [{ method: "addShortcode", name: "shout" }])
})

test("builtin filters fill in without overwriting captured ones", () => {
  const { config } = fakeUserConfig()
  const collector = createDefinitionCollector()
  collector.install(config)
  ;(config.addFilter as Function)("slugify", function (str: unknown) {})

  collector.addBuiltinFilters(["upper", "slugify"])
  const defs = collector.definitions()
  assert.deepEqual(defs.find((d) => d.name === "slugify")?.params, ["str"], "captured params should win")
  assert.ok(defs.find((d) => d.name === "upper"), "builtin should be added")
})

test("completionSlotAt identifies tag and filter positions", () => {
  const tag = "<p>x</p>\n{% "
  assert.deepEqual(completionSlotAt(tag, tag.length), { slot: "tag", closed: false })

  const partial = "{% ca"
  assert.deepEqual(completionSlotAt(partial, partial.length), { slot: "tag", closed: false })

  const filter = "{{ foo | "
  assert.deepEqual(completionSlotAt(filter, filter.length), { slot: "filter", closed: false })

  const filterPartial = "{{ foo | titl"
  assert.deepEqual(completionSlotAt(filterPartial, filterPartial.length), { slot: "filter", closed: false })

  const closedTag = "{%  %}"
  assert.deepEqual(completionSlotAt(closedTag, 3), { slot: "tag", closed: true })
})

test("completionSlotAt stays quiet outside tags", () => {
  // Plain body text, after a closed tag, and in an expression's argument slot
  // are all positions where a shortcode/filter name would be wrong.
  const closed = "{{ foo }} "
  assert.equal(completionSlotAt(closed, closed.length), null)

  const body = "<p>hello</p>"
  assert.equal(completionSlotAt(body, body.length), null)

  const args = "{% image src, "
  assert.equal(completionSlotAt(args, args.length), null)
})

test("paired shortcodes complete to a whole block, unless already closed", () => {
  const callout: NunjucksDefinition = { name: "callout", kind: "pairedShortcode", params: ["level"], signature: "", isAsync: false }

  const open = snippetFor(callout, false)
  assert.ok(open.includes("{% endcallout"), `expected a closing tag in ${JSON.stringify(open)}`)

  // The author already typed `%}`, so appending another closer would break it.
  const closed = snippetFor(callout, true)
  assert.ok(!closed.includes("endcallout"), `unexpected closing tag in ${JSON.stringify(closed)}`)

  const shout: NunjucksDefinition = { name: "shout", kind: "shortcode", params: ["value"], signature: "", isAsync: false }
  assert.equal(snippetFor(shout, false), "shout ${1:value}")
})
