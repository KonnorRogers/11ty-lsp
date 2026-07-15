import { pathToFileURL } from "node:url";
import { logger } from "../logger"
import path from "node:path";

const PATCHED = Symbol.for("@11ty/eleventy/star-selector-patch");

/**
 * Backports the 4.x `"*"` dataFilterSelector to Eleventy 3.x at runtime.
 * Call once at LSP startup, before any Eleventy build / toJSON().
 * https://github.com/11ty/buildawesome/pull/3904
 */
export async function patchEleventyStarSelector(eleventyPath: string) {
  // "." is exported, so this resolves; Template.js is its sibling in src/.
  const url = path.join(path.dirname(eleventyPath), "Template.js");
  logger.write({ url })

  const Template = (await import(url)).default;
  logger.write({ template: JSON.stringify(Template, null, 2) })
  const proto = Template?.prototype;
  const original = proto?.retrieveDataForJsonOutput;

  if (typeof original !== "function") {
    // Version drift — method moved/renamed. Don't crash the server.
    return { patched: false, reason: "retrieveDataForJsonOutput not found" };
  }
  if (proto[PATCHED]) return { patched: true, alreadyApplied: true };

  proto.retrieveDataForJsonOutput = function (data: unknown, selectors: Set<string>) {
    // dataFilterSelectors is a Set in 3.x -> use .has, not .includes
    if (selectors?.has?.("*")) return data;
    return original.call(this, data, selectors);
  };
  proto[PATCHED] = true;

  return { patched: true };
}
