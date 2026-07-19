import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

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
    name: "client",
    ...sharedOptions,
    entryPoints: ["client/src/vscode.ts"],
    outfile: "client/dist/vscode.js",
    // Provided by the VS Code extension host at runtime, not npm-installable.
    external: ["vscode"],
    plugins: [problemMatcherPlugin("client")],
  },
  {
    name: "server",
    ...sharedOptions,
    entryPoints: ["server/src/server.ts"],
    outfile: "server/dist/server.js",
    // typescript relies on locating its own lib.*.d.ts files on disk
    // relative to its package directory — bundling its code away from
    // there breaks that, so it stays a real, unbundled dependency.
    external: ["typescript"],
    plugins: [problemMatcherPlugin("server")],
  },
];

async function run() {
  const contexts = await Promise.all(builds.map(({ name, ...options }) => esbuild.context(options)));

  if (watch) {
    await Promise.all(contexts.map((ctx) => ctx.watch()));
  } else {
    await Promise.all(contexts.map((ctx) => ctx.rebuild()));
    await Promise.all(contexts.map((ctx) => ctx.dispose()));
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
