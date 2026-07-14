// eleventyRuntime.ts
import * as path from "node:path";
import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

type Runtime = { Eleventy: any; eventBus: any };
const cache = new Map<string, Promise<Runtime>>();

function pkgDirFor(projectDir: string): string {
  const req = createRequire(pathToFileURL(path.join(projectDir, "package.json")));
  let dir = path.dirname(req.resolve("@11ty/eleventy"));
  while (dir !== path.dirname(dir)) {
    const pj = path.join(dir, "package.json");
    if (fs.existsSync(pj) && JSON.parse(fs.readFileSync(pj, "utf8")).name === "@11ty/eleventy") return dir;
    dir = path.dirname(dir);
  }
  throw new Error("Could not locate @11ty/eleventy from " + projectDir);
}

export function getEleventyRuntime(projectDir: string): Promise<Runtime> {
  let rt = cache.get(projectDir);
  if (!rt) {
    rt = (async () => {
      const dir = pkgDirFor(projectDir);
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      const esm = path.join(dir, pkg.exports?.["."]?.import ?? pkg.module ?? pkg.main);
      const Eleventy = (await import(pathToFileURL(esm).href)).default;
      // same singleton bus eleventy uses internally — import the file directly (bypasses "exports")
      const eventBus = (await import(pathToFileURL(path.join(dir, "src/EventBus.js")).href)).default;
      return { Eleventy, eventBus };
    })();
    cache.set(projectDir, rt);
  }
  return rt;
}
