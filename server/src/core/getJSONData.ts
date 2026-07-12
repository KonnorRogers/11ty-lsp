import * as path from "node:path"
import * as fs from "node:fs"

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

export async function getJSONData ({
  configPath,
  output,
}: {
  configPath: string
  output: string
  // packageName: string
}) {
  let Eleventy = null

  try {
    // @ts-expect-error
    Eleventy = (await import("@11ty/eleventy")).default
  } catch {
    console.error("Unable to find @11ty/eleventy")
    return
  }

  let baseConfig = {
    default: async (_eleventyConfig: any) => {},
    config: {
      dir: {
      	input: ".",
      	output: "_site",
      }
    }
  }

  const config = await import(configPath).catch(() => {
    console.error("Unable to import your eleventy config.")
  })

  if (config) {
    baseConfig = config
  }

  // const input = baseConfig?.config?.dir || "."
  const eleventy = new Eleventy(undefined, output, {
    configPath,
    source: "cli",              // makes `output` override the config's dir.output
    config: async function(eleventyConfig: any) {
      await baseConfig.default(eleventyConfig)

      // To grab all data.
      eleventyConfig.dataFilterSelectors.add("*");
    }
  });
  const json = await eleventy.toJSON()
  return json
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

