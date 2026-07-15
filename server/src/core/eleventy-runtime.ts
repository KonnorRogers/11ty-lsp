// eleventyRuntime.ts
import {logger} from "../logger"
import * as path from "node:path";
import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { patchEleventyStarSelector } from "./patch-eleventy-runtime";
import { ELEVENTY_OR_BUILDAWESOME_PACKAGES } from "../constants";

type Runtime = { Eleventy: any; eventBus: any };
const cache = new Map<string, Promise<Runtime>>();

function pkgDirFor(projectDir: string): string {
  const req = createRequire(pathToFileURL(path.join(projectDir, "package.json")));
  let dir = path.dirname(req.resolve("@11ty/eleventy"));

  if (!dir) {
    // Just in case, check for build awesome.
    dir = path.dirname(req.resolve("@awesome.me/buildawesome"));
  }

  logger.write({dir})

  // Search upwards to find the package.json
  while (dir !== path.dirname(dir)) {
    const pj = path.join(dir, "package.json");
    if (fs.existsSync(pj)) {
      const name = JSON.parse(fs.readFileSync(pj, "utf8")).name
      if (ELEVENTY_OR_BUILDAWESOME_PACKAGES.includes(name)) {
        return dir;
      }
    }
    dir = path.dirname(dir);
  }
  throw new Error("Could not locate \"@11ty/eleventy\" or \"@awesome.me/buildawesome\" from " + projectDir);
}

export function getEleventyRuntime(projectDir: string): Promise<Runtime> {
  let rt = cache.get(projectDir);
  if (!rt) {
    rt = (async () => {
      const dir = pkgDirFor(projectDir);
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      const esm = path.join(dir, pkg.exports?.["."]?.import ?? pkg.module ?? pkg.main);
      const isV3 = pkg.version.startsWith("3.")
      const eleventyPath = pathToFileURL(esm).href
      const Eleventy = (await import(eleventyPath)).default;
      // logger.write({version: pkg.version})
      if (isV3) {
        await patchEleventyStarSelector(eleventyPath)
      }

      // same singleton bus eleventy uses internally — import the file directly (bypasses "exports")
      const eventBus = (await import(pathToFileURL(path.join(dir, "src/EventBus.js")).href)).default;
      return { Eleventy, eventBus };
    })();
    cache.set(projectDir, rt);
  }
  return rt;
}

