/**
 * End-to-end completion tests: spawns the real language server over stdio and
 * drives it with LSP requests.
 *
 * These exist because the incomplete-tag recovery in `nunjucksVirtualCode.ts`
 * has failure modes that unit tests structurally cannot see. A patched
 * document can produce perfectly well-formed `CodeMapping`s and still yield
 * zero completions — because the synthetic closer landed somewhere that made
 * nunjucks fail to parse the rest of the file, or because the caret sits one
 * offset outside the range the mapping covers. Only a real request through
 * the real server catches that.
 */
import { test, before, after } from "node:test"
import assert from "node:assert"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const ROOT = path.resolve(__dirname, "../../..")
const SERVER = path.join(ROOT, "server/src/server.ts")
const FIXTURE = path.join(ROOT, "test-files/eleventy-4/test.njk")
const FIXTURE_URI = pathToFileURL(FIXTURE).toString()

/** 11ty has to boot and resolve the project's data before anything resolves. */
const SETTLE_MS = 1500
const RETRIES = 8

class LspClient {
  private child: ChildProcessWithoutNullStreams
  private buffer = Buffer.alloc(0)
  private pending = new Map<number, (msg: any) => void>()
  private nextId = 1

  constructor() {
    this.child = spawn(process.execPath, ["--import", "tsx", SERVER, "--stdio"], {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    })
    this.child.stdout.on("data", (chunk: Buffer) => this.onData(chunk))
    // Server logs are noise unless something goes wrong; surface only crashes.
    this.child.stderr.on("data", () => {})
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n")
      if (headerEnd < 0) return
      const match = /Content-Length: (\d+)/i.exec(this.buffer.subarray(0, headerEnd).toString())
      if (!match) return
      const start = headerEnd + 4
      const length = parseInt(match[1], 10)
      if (this.buffer.length < start + length) return
      const msg = JSON.parse(this.buffer.subarray(start, start + length).toString())
      this.buffer = this.buffer.subarray(start + length)

      const resolve = msg.id !== undefined ? this.pending.get(msg.id) : undefined
      if (resolve) {
        this.pending.delete(msg.id)
        resolve(msg)
      } else if (msg.id !== undefined) {
        // Server-initiated request (configuration, registration): answer so it
        // doesn't stall waiting on us.
        this.send({ jsonrpc: "2.0", id: msg.id, result: null })
      }
    }
  }

  private send(msg: unknown) {
    const body = JSON.stringify(msg)
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  }

  request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.send({ jsonrpc: "2.0", id, method, params })
    })
  }

  notify(method: string, params: unknown) {
    this.send({ jsonrpc: "2.0", method, params })
  }

  dispose() {
    this.child.kill()
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let client: LspClient
let fixture: string
let version = 1

before(async () => {
  fixture = readFileSync(FIXTURE, "utf8")
  client = new LspClient()
  const workspace = pathToFileURL(ROOT).toString()
  await client.request("initialize", {
    processId: process.pid,
    rootUri: workspace,
    workspaceFolders: [{ uri: workspace, name: "root" }],
    capabilities: {
      textDocument: { completion: { completionItem: { snippetSupport: true } } },
      workspace: { configuration: true, workspaceFolders: true },
    },
  })
  client.notify("initialized", {})
})

after(() => client?.dispose())

/**
 * Splices `insert` into the fixture just before `</body>`, puts the caret
 * `caretBack` characters from the end of the inserted text, and asks for
 * completions there.
 */
async function completionsFor(insert: string, caretBack = 0): Promise<string[]> {
  const marker = "  </body>"
  const at = fixture.indexOf(marker)
  const text = fixture.slice(0, at) + insert + "\n" + fixture.slice(at)
  const caret = at + insert.length - caretBack

  const before = text.slice(0, caret)
  const line = (before.match(/\n/g) ?? []).length
  const character = caret - (before.lastIndexOf("\n") + 1)

  client.notify("textDocument/didOpen", {
    textDocument: { uri: FIXTURE_URI, languageId: "nunjucks", version: version++, text },
  })

  try {
    // The first request after didOpen can land before 11ty's data is ready;
    // retry rather than bake in a worst-case sleep on every case.
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      await sleep(attempt === 0 ? SETTLE_MS : 500)
      const res = await client.request("textDocument/completion", {
        textDocument: { uri: FIXTURE_URI },
        position: { line, character },
      })
      const items = res.result?.items ?? res.result ?? []
      if (items.length > 0) return items.map((i: { label: string }) => i.label)
    }
    return []
  } finally {
    client.notify("textDocument/didClose", { textDocument: { uri: FIXTURE_URI } })
    await sleep(200)
  }
}

const CASES: Array<{ name: string; insert: string; caretBack?: number; expect: string[] }> = [
  // Incomplete tags — each of these returned nothing before the recovery fixes.
  { name: "dangling dot, tag never closed", insert: "\n    {{ eleventy.", expect: ["version", "env"] },
  { name: "dangling dot, tag closed", insert: "\n    {{ eleventy. }}", caretBack: 3, expect: ["version", "env"] },
  { name: "empty closed tag", insert: "\n    {{  }}", caretBack: 3, expect: ["foo", "obj", "page"] },
  { name: "empty unclosed tag", insert: "\n    {{ ", expect: ["foo", "obj", "page"] },
  { name: "dangling dot in a block tag", insert: "\n    {% if eleventy. %}\n    {% endif %}", caretBack: 19, expect: ["version"] },
  {
    // The lexer reports the *next* tag's `}}` as this tag's closer, which used
    // to nest `{{` inside an expression and break the whole document.
    name: "dangling dot directly above another tag",
    insert: "\n    {{ eleventy.\n    {{ obj.a }}",
    caretBack: 16,
    expect: ["version"],
  },
  // Nested and non-eleventy data.
  { name: "dangling dot on front-matter data", insert: "\n    {{ obj.d.", expect: ["e"] },
  { name: "dangling dot on page", insert: "\n    {{ page.", expect: ["url", "inputPath"] },
  // Project vocabulary read out of the user's eleventy config — see
  // test-files/eleventy-4/eleventy.config.js for the registrations.
  { name: "block tag slot offers shortcodes", insert: "\n    {% ", expect: ["shout", "image", "callout", "banner"] },
  { name: "partial tag name still offers shortcodes", insert: "\n    {% ca", expect: ["callout"] },
  { name: "filter slot offers custom filters", insert: "\n    {{ foo | ", expect: ["titlecase", "slugify", "upper"] },
  { name: "partial filter name offers filters, not data", insert: "\n    {{ foo | title", expect: ["titlecase"] },
  // Well-formed input must keep working.
  { name: "complete member access", insert: "\n    {{ eleventy.ver }}", caretBack: 3, expect: ["version"] },
  { name: "top-level symbol", insert: "\n    {{ foo }}", caretBack: 5, expect: ["foo", "bar", "items"] },
]

for (const c of CASES) {
  test(`completions: ${c.name}`, { timeout: 60_000 }, async () => {
    const labels = await completionsFor(c.insert, c.caretBack)
    assert.ok(labels.length > 0, `expected completions, got none`)
    for (const expected of c.expect) {
      assert.ok(
        labels.includes(expected),
        `expected "${expected}" in completions, got: ${labels.join(", ")}`
      )
    }
  })
}
