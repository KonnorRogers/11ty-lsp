import * as path from "node:path"
import * as fs from "node:fs"
import { getEleventyRuntime } from "./eleventy-runtime"
import { DataError, DataOrError } from "../constants"

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
  let rt;
  try { rt = await getEleventyRuntime(path.dirname(configPath)); }
  catch (e) { return new Error("Unable to find @11ty/eleventy: " + (e as Error).message); }

  for (const p of invalidate) {
    for (const ev of RESOURCE_MODIFIED_EVENTS) rt.eventBus.emit(ev, p);
  }

  const eleventy = new rt.Eleventy(undefined, output, {
    configPath, source: "cli",
    config: async (c: any) => { c.dataFilterSelectors.add("*"); },
  });
  try { return await eleventy.toJSON(); }
  catch (e) { return e as DataError; }
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

