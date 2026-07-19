#!/usr/bin/env node
import { ELEVENTY_OR_BUILDAWESOME_PACKAGES } from "./constants";

import * as path from "node:path"
import * as os from "node:os"
import * as fs from "node:fs"
import * as crypto from "node:crypto"
import { fileURLToPath } from "node:url";

import {
  createConnection,
  createServer,
  createTypeScriptProject,
} from "@volar/language-server/node";
import * as ts from "typescript";
import { create as createHtmlServicePlugin } from "volar-service-html";
import { create as createCssServicePlugin } from "volar-service-css";
import { create as createTsServicePlugins } from "volar-service-typescript";

import {
  DidChangeConfigurationNotification,
  DidChangeWatchedFilesNotification,
  ExecuteCommandParams,
} from "vscode-languageserver/node";

import { NunjucksSettings } from "./settings/nunjucksSettings";
import { createNunjucksLanguagePlugin } from "./core/nunjucksVirtualCode";
import { createNunjucksServicePlugin } from "./core/nunjucksServicePlugin";
import { getJSONData, getNunjucksExtensionsForConfig } from "./core/getJSONData";
import { DataOrError } from "./constants";
import { version } from "./version";

const dataByConfig = new Map<string, DataOrError>();

const RESTART_COMMAND = '11ty-lsp.restart';
const name = "11ty-lsp"


/**
 * per-file data, this compares input keys from 11ty
 */
function getDataForFile(documentUri: string): DataOrError | undefined | null {
  const data = getData(documentUri)

  let filePath: string;
  try {
    filePath = fileURLToPath(documentUri);
  } catch {
    return null; // not a `file:` URI (e.g. a Volar embedded-content URI)
  }

  const rootDir = findRootDir(filePath)

  let relativePath = ""

  let finalData: DataOrError | null = null
  if (rootDir && !(data instanceof Error)) {
    relativePath = path.relative(rootDir, filePath)
    // Normalizes it to the same key as 11ty
    const key = "./" + relativePath.split(path.sep).join("/")
    if (Array.isArray(data)) {
      finalData = data?.find?.((obj) => {
        return obj.inputPath === key
      })?.data || {}
    }
  }

  return finalData
}

function getData(documentUri: string): DataOrError | undefined {
  const config = findConfigForDocument(documentUri);

  if (config) {
    return dataByConfig.get(config)
  }

  return undefined;
}

/**
 * `getDataForFile` only ever returns real per-file data on success — when
 * the 11ty build itself failed, its `!(data instanceof Error)` guard means
 * it always returns `null`, silently swallowing the Error. Diagnostics
 * need the raw Error itself (from `getData`) to surface an "Error
 * compiling 11ty" banner instead of just showing no data quietly.
 */
function getDataOrErrorForFile(documentUri: string): DataOrError | undefined | null {
  const data = getDataForFile(documentUri);
  return data == null ? getData(documentUri) : data;
}

/**
 * The project's real registered nunjucks tags/shortcodes (from the same
 * 11ty build that produced `dataByConfig`), so our own parser recognizes
 * custom tags like `eleventyConfig.addNunjucksTag`/`addShortcode` instead
 * of throwing "unknown block tag" on them.
 */
function getExtensionsForFile(documentUri: string) {
  const config = findConfigForDocument(documentUri);
  return config ? getNunjucksExtensionsForConfig(config) : undefined;
}

function tmpDirFor(configPath: string) {
  const hash = crypto.createHash("sha1").update(configPath).digest("hex").slice(0, 12);
  return path.join(os.tmpdir(), "11ty-lsp-" + hash);
}

const rebuildTimers = new Map<string, NodeJS.Timeout>();

async function rebuildConfig(configPath: string, invalidate: string[] = []) {
  const data = await getJSONData({ configPath, output: tmpDirFor(configPath), invalidate })

  if (Array.isArray(data)) {
    // logger.write(data[0].data.eleventy)
  }

  dataByConfig.set(configPath, data);

  // The freshly-rebuilt data is now in the cache, but virtual code/type
  // synthesis (see nunjucksVirtualCode.ts) is only regenerated when Volar
  // thinks a *document's own text* changed — a pure 11ty data change
  // doesn't trip that. Reloading the project forces every virtual code to
  // be regenerated against the fresh data, and requesting a refresh makes
  // pull-model diagnostics recompute too.
  server.project.reload();
  await server.languageFeatures.requestRefresh(false);
}

function scheduleRebuild(documentUri: string, delay = 300) {
  clearTimeout(rebuildTimers.get(documentUri));
  rebuildTimers.set(documentUri, setTimeout(() => {
    rebuildTimers.delete(documentUri);
    rebuildAndReport(documentUri);
  }, delay));
}

async function rebuildAndReport(documentUri: string) {
  const found = findConfigForDocument(documentUri);
  if (found) {
    // rebuildConfig refreshes diagnostics once the cache is updated.
    await rebuildConfig(found, [fileURLToPath(documentUri)]);
  } else {
    // No 11ty config: nothing to rebuild, but the document's own validation may
    // have changed, so still ask the client to re-pull.
    await server.languageFeatures.requestRefresh(false);
  }
}

const ROOT_MARKERS = [
  "eleventy.config.js", "eleventy.config.mjs", "eleventy.config.cjs",
  ".eleventy.js", "package.json"
];

/** Closest ancestor of `startDir` containing any marker, or null. */
function findRootDir(startDir: string, markers = ROOT_MARKERS) {
  const configFile = findRootConfigFile(startDir, markers)
  if (configFile) {
    return path.dirname(configFile)
  }

  return null
}

function findRootConfigFile(startDir: string, markers = ROOT_MARKERS): string | null {
  let dir = path.resolve(startDir);
  const { root } = path.parse(dir); // "/" or "C:\\"

  while (true) {
    const marker = markers.find((m) => {
      const filePath = path.join(dir, m)
      if (m === "package.json") {
        // We need to check if the package.json contains 11ty.
        if (fs.existsSync(filePath)) {
          const pkgData = JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }))
          const dependencies = Object.keys(pkgData.dependencies || {})
                                  .concat(Object.keys(pkgData.devDependencies || {}))

          return dependencies.some((dep: string) => {
            return ELEVENTY_OR_BUILDAWESOME_PACKAGES.includes(dep)
          })
        }

        return false
      }

      return fs.existsSync(filePath)
    });

    if (marker) {
      return path.join(dir, marker); // full path, not just the filename
    }

    if (dir === root) return null; // hit the fs root, give up
    dir = path.dirname(dir);
  }
}

/** Full path to the closest 11ty config above `documentUri`, or null. */
function findConfigForDocument(documentUri: string): string | null {
  let filePath: string;
  try {
    filePath = fileURLToPath(documentUri);
  } catch {
    return null; // untitled / non-file document
  }
  return findRootConfigFile(path.dirname(filePath));
}

// Create a connection for the server, using Node's IPC as a transport, and
// wrap it in a Volar server: `server.initialize()` below handles routing
// hover/completion/diagnostics across all the registered language service
// plugins (and across root/embedded virtual documents) for us.
const connection = createConnection();
const server = createServer(connection);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

// Default settings
const defaultSettings: NunjucksSettings = {
  maxNumberOfProblems: 1000,
  enabledFeatures: {
    completion: true,
    diagnostics: true,
    hover: true
  }
};

let globalSettings: NunjucksSettings = defaultSettings;

async function getDocumentSettings(resource: string): Promise<NunjucksSettings> {
  if (!hasConfigurationCapability) {
    return globalSettings;
  }
  const settings = await server.configurations.get<NunjucksSettings>('11ty-lsp', resource);
  return settings ?? defaultSettings;
}

async function restartServer() {
  try {
    connection.console.log(`Restarting ${name} server...`);

    dataByConfig.clear();
    server.project.reload();
    await server.languageFeatures.requestRefresh(true);

    connection.console.log(`${name} server restarted successfully`);
    connection.window.showInformationMessage(`${name} server has been restarted`);
  } catch (error) {
    connection.console.error(`Error during server restart: ${error}`);
    connection.window.showErrorMessage(`Failed to restart ${name} server: ${error}`);
  }
}

connection.onInitialize((params) => {
  const result = server.initialize(
    params,
    createTypeScriptProject(ts, undefined, () => ({
      languagePlugins: [
        createNunjucksLanguagePlugin(
          (uri) => getDataForFile(uri.toString()),
          (uri) => getExtensionsForFile(uri.toString()),
        ),
      ],
    })),
    [
      ...createTsServicePlugins(ts),
      createHtmlServicePlugin(),
      createCssServicePlugin(),
      createNunjucksServicePlugin({
        getSettings: (uri) => getDocumentSettings(uri),
        // The diagnostics path specifically needs the raw Error (if any)
        // to surface the "Error compiling 11ty" banner — see
        // getDataOrErrorForFile's doc comment.
        getData: (uri) => getDataOrErrorForFile(uri),
        getExtensions: (uri) => getExtensionsForFile(uri),
      }),
    ],
  );

  result.capabilities.executeCommandProvider = {
    commands: [RESTART_COMMAND],
  };

  const capabilities = params.capabilities;
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );

  result.serverInfo = {
    name: name,
    version: version,
  };

  return result;
});

connection.onInitialized(() => {
  server.initialized();

  const startupMessage = `11ty-lsp server started (pid ${process.pid}) at ${new Date().toISOString()}`;
  connection.console.log(startupMessage);
  connection.window.showInformationMessage(startupMessage);

  if (hasConfigurationCapability) {
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders(_event => {
      connection.console.log('Workspace folder change event received.');
    });
  }
  connection.client.register(DidChangeWatchedFilesNotification.type, {
    watchers: [
      { globPattern: `**/**/*.*` },
    ],
  })
});

connection.onDidChangeConfiguration(async (change) => {
  if (!hasConfigurationCapability) {
    globalSettings = <NunjucksSettings>(
      (change.settings["11ty-lsp"] || defaultSettings)
    );
  }

  await restartServer()
});

connection.onExecuteCommand(async (params: ExecuteCommandParams) => {
  if (params.command === RESTART_COMMAND) {
    await restartServer()
  }
})

// 11ty data is rebuilt whenever a template is opened, edited, or saved —
// this is unrelated to (and runs alongside) Volar's own document/virtual
// code tracking.
server.documents.onDidOpen(change => scheduleRebuild(change.document.uri));
server.documents.onDidChangeContent(change => scheduleRebuild(change.document.uri));
server.documents.onDidSave(change => scheduleRebuild(change.document.uri));

// Watch for file changes that might require restart
connection.onDidChangeWatchedFiles(async (params) => {
  let needsRestart = false;

  // Check if any template files were added/removed (might need restart)
  for (const change of params.changes) {
    if (ROOT_MARKERS.some((configFile) => change.uri.endsWith(configFile))) {
      // File type: 1 = Created, 3 = Deleted
      if (change.type === 1 || change.type === 3) {
        needsRestart = true;
        break;
      }
    }
  }

  if (needsRestart) {
    await restartServer();
  }
});

connection.listen();
