import { logger, serializeError } from "./logger";
import * as lexer from "nunjucks/src/lexer.js"

import * as path from "node:path"
import * as os from "node:os"
import * as fs from "node:fs"
import * as crypto from "node:crypto"
import { fileURLToPath } from "node:url";
import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  CompletionItem,
  // CompletionItemKind,
  DocumentDiagnosticReportKind,
  DocumentDiagnosticReport,
  DidChangeConfigurationNotification,
  TextDocumentPositionParams,
  TextDocumentIdentifier,
  DidChangeWatchedFilesNotification,
  ExecuteCommandParams,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import {
  Hover,
  LanguageModes,
  getLanguageModes
} from "./languageModes";

import { NunjucksSettings } from "./settings/nunjucksSettings";
import { NunjucksParser } from "./core/nunjucksParser";
import { NunjucksCompletionProvider } from "./core/nunjucksCompletion";
import { NunjucksValidator } from "./core/nunjucksValidator";
import { NunjucksHoverProvider } from "./core/nunjucksHover";
import { getJSONData } from "./core/getJSONData";
import { DiagnosticSeverity } from "vscode-css-languageservice";
import { DataOrError } from "./constants";

const dataByConfig = new Map<string, DataOrError>();

const RESTART_COMMAND = '11ty-lsp.restart';
const name = "11ty-lsp"

const packageData = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "..", "package.json"), { encoding: "utf-8" }))
const packageName = packageData.name
const packageVersion = packageData.version

logger.write({ packageName, packageVersion })
/**
 * per-file data, this compares input keys from 11ty
 */
function getDataForFile(documentUri: string): DataOrError | undefined | null {
  const data = getData(documentUri)
  const filePath = fileURLToPath(documentUri);
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

  for (const doc of documents.all()) {
    const config = findConfigForDocument(doc.uri)
    if (config === configPath) {
      await sendDiagnostics(doc);
    }
  }
}

function scheduleRebuild(document: TextDocument, delay = 300) {
  clearTimeout(rebuildTimers.get(document.uri));
  rebuildTimers.set(document.uri, setTimeout(() => {
    rebuildTimers.delete(document.uri);
    rebuildAndReport(document);
  }, delay));
}

async function rebuildAndReport(document: TextDocument) {
  const found = findConfigForDocument(document.uri);
  if (found) {
    await rebuildConfig(found, [fileURLToPath(document.uri)]);
  }
  await sendDiagnostics(document);
}

const ROOT_MARKERS = [
  "eleventy.config.js", "eleventy.config.mjs", "eleventy.config.cjs",
  ".eleventy.js"
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
    const marker = markers.find((m) => fs.existsSync(path.join(dir, m)));
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

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let languageModes: LanguageModes;

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;


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

// Initialize analyzers
let parser = new NunjucksParser(defaultSettings);
let nunjucksCompletionProvider = new NunjucksCompletionProvider(parser);
let nunjucksValidator = new NunjucksValidator(parser);
let nunjucksHoverProvider = new NunjucksHoverProvider(parser)

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<NunjucksSettings>> = new Map();

async function restartServer () {
  try {
    connection.console.log(`Restarting ${name} server...`);

    // Clear document settings cache
    documentSettings.clear();

    // Reinitialize language modes
    if (languageModes) {
      languageModes.dispose();
    }
    languageModes = getLanguageModes();

    // Reinitialize analyzers with current settings
    parser = new NunjucksParser(globalSettings);
    nunjucksCompletionProvider = new NunjucksCompletionProvider(parser);
    nunjucksValidator = new NunjucksValidator(parser);
    nunjucksHoverProvider = new NunjucksHoverProvider(parser);

    // Revalidate all open documents
    const allDocs = documents.all();
    for (const doc of allDocs) {
      await sendDiagnostics(doc);
    }

    connection.console.log(`${name} server restarted successfully`);

    // Show info message to user
    connection.window.showInformationMessage(`${name} server has been restarted`);
  } catch (error) {
    connection.console.error(`Error during server restart: ${error}`);
    connection.window.showErrorMessage(`Failed to restart ${name} server: ${error}`);
  }
}

connection.onInitialize((params: InitializeParams) => {
  languageModes = getLanguageModes();

  documents.onDidClose(e => {
    languageModes.onDocumentRemoved(e.document);
    documentSettings.delete(e.document.uri);
  });
  connection.onShutdown(() => {
    languageModes.dispose();
  });
  const capabilities = params.capabilities;

  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: [
          '.', '|', '{%', '(', '{{'
        ]
      },
      hoverProvider: true,
      diagnosticProvider: {
        interFileDependencies: true,
        workspaceDiagnostics: false
      },
      // Add execute command provider for restart functionality
      executeCommandProvider: {
        commands: [RESTART_COMMAND]
      }
    },
    serverInfo: {
      name: packageName,
      version: packageVersion
    }
  };

  return result;
});

connection.onInitialized(() => {
  const startupMessage = `11ty-lsp server started (pid ${process.pid}) at ${new Date().toISOString()}`;
  connection.console.log(startupMessage);
  connection.window.showInformationMessage(startupMessage);

  if (hasConfigurationCapability) {
    // Register for all configuration changes
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
      // { globPattern: `**/**/*.njk` },
    ],
  })
});

connection.onDidChangeConfiguration(async (change) => {
  if (hasConfigurationCapability) {
    // Reset all cached document settings
    documentSettings.clear();
  } else {
    globalSettings = <NunjucksSettings>(
      (change.settings["11ty-lsp"] || defaultSettings)
    );
  }

  // Revalidate all open text documents
  // documents.all().forEach(sendDiagnostics);
  await restartServer()
});

connection.onExecuteCommand(async (params: ExecuteCommandParams) => {
  if (params.command === RESTART_COMMAND) {
    await restartServer()
  }
})

// The content of a text document has changed
documents.onDidChangeContent(change => {
  scheduleRebuild(change.document);
});

documents.onDidSave(change => {
  scheduleRebuild(change.document);
});

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
  } else {
    // if (configPath) {
    //   data = updateJSONData({
    //     configPath,
    //     output: tmpFile
    //   })
    // }
  }
});

async function getTextDocumentDiagnostics (textDocument: TextDocumentIdentifier) {
  const document = documents.get(textDocument.uri);
  if (document !== undefined) {
    const settings = await getDocumentSettings(document.uri);

    if (!settings.enabledFeatures.diagnostics) {
      return {
        kind: DocumentDiagnosticReportKind.Full,
        items: []
      } satisfies DocumentDiagnosticReport;
    }

    const diagnostics = nunjucksValidator.validate(document, settings);

    let data = getDataForFile(document.uri)

    if (data == null) {
      // no data found, check fallback to `getData()` and see if we have an error.
      data = getData(document.uri)
    }

    if (data instanceof Error) {
      // @ts-expect-error 11ty bakes it on "originalError"
      const err = data.originalError;
      const hasPos = ("lineno" in err && "colno" in err);

      let range = {
        start: { line: 1, character: 0 },
        end: document.positionAt(document.getText().length),
      }

      if (hasPos) {
        // 11ty reports kind of useless numbers.
        // const colno = (Number(err.colno) ?? 0)
        // const lineno = (Number(err.lineno) ?? 0)
        // range = {
        //   start: { line: lineno, character: colno },
        //   end:   { line: lineno, character: colno + 1 },
        // }
      }
      diagnostics.push({
        range,
        message: `Error compiling 11ty: ` + JSON.stringify(serializeError(data), null, 2),
        source: "[11ty-lsp]: 11ty CLI",
        severity: DiagnosticSeverity.Error,
      });
    }

    return {
      kind: DocumentDiagnosticReportKind.Full,
      items: diagnostics
    } satisfies DocumentDiagnosticReport;
  } else {
    return {
      kind: DocumentDiagnosticReportKind.Full,
      items: []
    } satisfies DocumentDiagnosticReport;
  }
}

async function sendDiagnostics(textDocument: TextDocument): Promise<void> {
  try {
    const diagnostics = await getTextDocumentDiagnostics(textDocument)
    // Send the computed diagnostics to VSCode
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: diagnostics.items });
  } catch (error) {
    connection.console.error(`Error validating document ${textDocument.uri}: ${error}`);
    // Send empty diagnostics on error to clear any existing ones
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
  }
}


// Hover provider
connection.onHover(async (params): Promise<Hover | null> => {
  try {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return null;
    }

    const settings = await getDocumentSettings(document.uri);

    if (!settings.enabledFeatures?.hover) {
      return null;
    }


    let hoverData = getDataForFile(document.uri)

    if (hoverData instanceof Error) {
      hoverData = {}
    }

    return nunjucksHoverProvider.provideHover(document, params.position, settings, hoverData);
  } catch (error) {
    connection.console.error(`Error in hover provider: ${error}`);
    return null;
  }

})


function getDocumentSettings(resource: string): Thenable<NunjucksSettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(globalSettings);
  }
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: '11ty-lsp'
    });
    documentSettings.set(resource, result);
  }
  return result;
}

// Completion provider
connection.onCompletion(async (textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
  const document = documents.get(textDocumentPosition.textDocument.uri);
  if (!document) {
    return [];
  }

  const settings = await getDocumentSettings(document.uri);

  if (!settings.enabledFeatures.completion) {
    return [];
  }

  return nunjucksCompletionProvider.provideCompletions(document, textDocumentPosition.position, settings);
});

// Completion resolve provider
// This handler resolves additional information for the item selected in
// the completion list.
// Required by VSCode.
// Completion resolve provider
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  return nunjucksCompletionProvider.resolveCompletion(item);
});

// Diagnostic provider
connection.languages.diagnostics.on(async (params) => {
  const diagnostics = await getTextDocumentDiagnostics(params.textDocument)
  return diagnostics
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
