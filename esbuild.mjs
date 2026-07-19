import * as esbuild from "esbuild";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * `typescript` stays external in the vscode-server bundle (see below), but
 * `vsce` packages the extension from *within* vscode/ — npm workspaces
 * hoists `typescript` to the monorepo root, which won't ship with the
 * packaged extension at all. Copy the real package in so `require("typescript")`
 * resolves once installed for real, regardless of where npm hoisted it
 * during development.
 *
 * Deliberately *not* named `node_modules`: vsce's `--no-dependencies` mode
 * (required so it doesn't also try to walk the whole monorepo — see
 * vscode/package.json's package/publish scripts) unconditionally excludes
 * any directory literally named `node_modules`, .vscodeignore negation or
 * not. vscode/src/vscode.ts points `NODE_PATH` at this directory so plain
 * `require("typescript")` still resolves here at runtime.
 */
function vendorTypescript() {
  const typescriptDir = path.dirname(require.resolve("typescript/package.json"));
  const dest = path.resolve("vscode/dist/vendor/typescript");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(typescriptDir, dest, { recursive: true });
}

/** @param {string} name */
function problemMatcherPlugin(name) {
  return {
    name: "problem-matcher",
    setup(build) {
      build.onStart(() => {
        console.log(`[watch:${name}] build started`);
      });
      build.onEnd((result) => {
        for (const { text, location } of result.errors) {
          console.error(`✘ [ERROR] ${text}`);
          if (location) {
            console.error(`    ${location.file}:${location.line}:${location.column}:`);
          }
        }
        console.log(`[watch:${name}] build finished`);
      });
    },
  };
}

const sharedOptions = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  logLevel: "warning",
  // vscode-html/css-languageservice ship a UMD build as "main"; esbuild
  // doesn't always fully statically-resolve UMD's internal requires,
  // leaving some as broken runtime requires post-bundle. Preferring their
  // ESM build sidesteps that — real import/export is always statically
  // analyzable.
  mainFields: ["module", "main"],
};

const builds = [
  {
    name: "vscode-client",
    ...sharedOptions,
    entryPoints: ["vscode/src/vscode.ts"],
    outfile: "vscode/dist/vscode.js",
    // Provided by the VS Code extension host at runtime, not npm-installable.
    external: ["vscode"],
    plugins: [problemMatcherPlugin("vscode-client")],
  },
  {
    name: "vscode-server",
    ...sharedOptions,
    entryPoints: ["server/src/server.ts"],
    // Bundled *into* vscode/dist (not server/dist): vsce packages the
    // extension from within vscode/, so anything it needs at runtime has to
    // live inside that directory's own tree, not a sibling workspace. The
    // standalone npm package (server/package.json, published as "11ty-lsp")
    // ships the plain unbundled `server/out` build instead — see its `bin`.
    outfile: "vscode/dist/server.js",
    // typescript relies on locating its own lib.*.d.ts files on disk
    // relative to its package directory — bundling its code away from
    // there breaks that, so it stays a real, unbundled dependency.
    external: ["typescript"],
    plugins: [problemMatcherPlugin("vscode-server")],
  },
];

async function run() {
  const contexts = await Promise.all(builds.map(({ name, ...options }) => esbuild.context(options)));

  if (watch) {
    vendorTypescript();
    await Promise.all(contexts.map((ctx) => ctx.watch()));
  } else {
    await Promise.all(contexts.map((ctx) => ctx.rebuild()));
    await Promise.all(contexts.map((ctx) => ctx.dispose()));
    vendorTypescript();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
