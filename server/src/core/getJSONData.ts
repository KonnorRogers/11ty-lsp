import * as path from "node:path"
import * as fs from "node:fs"
import { getEleventyRuntime } from "./eleventy-runtime"
import { DataError, DataOrError } from "../constants"
import { logger } from "../logger"
import type { NunjucksExtension } from "./nunjucksParser"
import { createDefinitionCollector, type NunjucksDefinition } from "./nunjucksDefinitions"

function decycle(value: any, ancestors = new WeakSet()): any {
  if (value === null || typeof value !== "object") return value
  if (typeof value.toJSON === "function") return value // Date etc. serialize themselves
  if (ancestors.has(value)) return "[Circular]"
  ancestors.add(value)
  const out = Array.isArray(value)
    ? value.map((v) => decycle(v, ancestors))
    : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decycle(v, ancestors)]))
  ancestors.delete(value)
  return out
}

const RESOURCE_MODIFIED_EVENTS = [
  "buildawesome.resourcemodified", // 11ty 4.x (canary)
  "eleventy.resourceModified",     // 11ty 3.x
];

// 11ty emits its *actual* configured nunjucks Environment (with every
// custom tag/shortcode/filter registered via eleventyConfig already
// applied) under one of these event names, depending on version — same
// dual-name pattern as RESOURCE_MODIFIED_EVENTS above.
const NUNJUCKS_ENGINE_READY_EVENTS = [
  "buildawesome.engine.njk", // 11ty 4.x (canary) / @awesome.me/buildawesome
  "eleventy.engine.njk",     // 11ty 3.x
];

const extensionsByConfigPath = new Map<string, NunjucksExtension[]>()
const definitionsByConfigPath = new Map<string, NunjucksDefinition[]>()

/**
 * The custom nunjucks tags/shortcodes registered for a given 11ty config,
 * captured the last time `getJSONData` ran a build for it — see
 * `NUNJUCKS_ENGINE_READY_EVENTS` above. `undefined` if a build for this
 * config hasn't completed yet (or never touched a nunjucks template).
 */
export function getNunjucksExtensionsForConfig(configPath: string): NunjucksExtension[] | undefined {
  return extensionsByConfigPath.get(configPath)
}

/**
 * The project's own shortcodes/tags/filters — names *and* argument lists —
 * captured during the last build for this config. See `nunjucksDefinitions.ts`
 * for why this has to happen at registration time.
 */
export function getNunjucksDefinitionsForConfig(configPath: string): NunjucksDefinition[] | undefined {
  return definitionsByConfigPath.get(configPath)
}

/**
 * A project's own config can set a *relative* `dir.input` (11ty's own
 * default is even "./"), and 11ty always resolves that against
 * `process.cwd()` — there's no way to override this from the Eleventy
 * constructor's own `input` argument, since `ProjectDirectories.setViaConfigObject`
 * unconditionally re-resolves `dir.input` from the loaded config over
 * whatever we passed in. Since this server is *one* long-lived process
 * serving every 11ty project a client has open, `process.cwd()` is fixed
 * for the server's whole lifetime, so without this, one project's relative
 * `dir.input` could resolve into (and build/fail on) a completely
 * different project's directory. Queuing every build through a real
 * `process.chdir()` — one at a time, restored in a `finally` — is the only
 * way to make each build see the correct cwd, however 11ty ends up
 * resolving it internally.
 */
let buildQueue: Promise<unknown> = Promise.resolve()

function runInDirectory<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const result = buildQueue.then(async () => {
    const previousCwd = process.cwd()
    process.chdir(dir)
    try {
      return await run()
    } finally {
      process.chdir(previousCwd)
    }
  })
  // Keep the queue moving even if this build failed — `result` itself still
  // carries the rejection for its own caller.
  buildQueue = result.then(() => undefined, () => undefined)
  return result
}

export async function getJSONData({ configPath, output, invalidate = [] }:
  { configPath: string; output: string; invalidate?: string[] }): Promise<DataOrError> {
  let eleventyRuntime;
  try {
    eleventyRuntime = await getEleventyRuntime(path.dirname(configPath));
  }
  catch (e) {
    return new Error("Unable to find @11ty/eleventy or @awesome.me/buildawesome: " + (e as Error).message);
  }

  // This relies on some serious 11ty internals to invalidate its cache.
  for (const p of invalidate) {
    for (const ev of RESOURCE_MODIFIED_EVENTS) {
      eleventyRuntime.eventBus.emit(ev, p);
    }
  }

  const options = {
    source: "cli",
    // This is the crux of everything and gives us the data for every input file.
    config: async (c: any) => {
      c.dataFilterSelectors.add("*");

      // Must be installed before the project's own config function runs, so
      // its registrations pass through our wrappers.
      const collector = createDefinitionCollector()
      collector.install(c)

      const captureNunjucksEnvironment = ({ environment }: { environment: { extensionsList?: NunjucksExtension[]; filters?: Record<string, unknown> } }) => {
        extensionsByConfigPath.set(configPath, environment.extensionsList ?? [])
        // Nunjucks' own filters (`upper`, `join`, ...) are never registered
        // through eleventyConfig, so they only show up on the environment.
        collector.addBuiltinFilters(Object.keys(environment.filters ?? {}))
        definitionsByConfigPath.set(configPath, collector.definitions())
      }
      for (const ev of NUNJUCKS_ENGINE_READY_EVENTS) {
        c.on(ev, captureNunjucksEnvironment)
      }
    },
    configPath
  }

  let eleventy = null

  if (!configPath) {
    // Without this fallback config, 11ty fails to start.
    const baseConfigPath = path.resolve(__dirname, "base-eleventy-config.js")
    options.configPath = baseConfigPath
  }

  // Deliberately `undefined`, not an explicit input dir: 11ty normalizes an
  // *absolute* input path via `path.relative(".", absoluteInput)` — once
  // runInDirectory below has already chdir'd into this exact directory,
  // that collapses to "" (a path relative to itself) and 11ty's own
  // existence check then rejects the empty string outright. Leaving this
  // undefined lets 11ty fall back to its own relative default ("./"),
  // which now correctly resolves against the chdir'd cwd instead.
  const projectDir = path.dirname(options.configPath)
  eleventy = new eleventyRuntime.Eleventy(undefined, output, options);

  try {
    return await runInDirectory(projectDir, () => eleventy.toJSON());
  } catch (e) {
    return e as DataError;
  }
}

export async function writeJSONData ({
  configPath,
  output,
}: {
  configPath: string
  output: string
  // packageName: string
}) {
  const json = await getJSONData({
    output,
    configPath
  })

  fs.writeFileSync(output, JSON.stringify(decycle(json), null, 2), {encoding: "utf-8"})
};



// ;(async () => {
//   const data = await getJSONData({
//     output: path.join(process.cwd(), "test-files", "output.json"),
//     configPath: path.join(process.cwd(), "test-files", "eleventy.config.js")
//   })
//   console.log({ data })
// })()

