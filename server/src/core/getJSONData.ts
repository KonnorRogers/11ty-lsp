import * as path from "node:path"
import * as fs from "node:fs"
import { getEleventyRuntime } from "./eleventy-runtime"
import { DataError, DataOrError } from "../constants"
import { logger } from "../logger"

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
    config: async (c: any) => { c.dataFilterSelectors.add("*"); },
    configPath
  }

  let eleventy = null

  if (!configPath) {
    // Without this fallback config, 11ty fails to start.
    const baseConfigPath = path.resolve(__dirname, "base-eleventy-config.js")
    options.configPath = baseConfigPath
  }

  eleventy = new eleventyRuntime.Eleventy(undefined, output, options);

  try {
    return await eleventy.toJSON();
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

