import * as path from "path";
import { workspace, ExtensionContext } from "vscode";

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient;

export function activate(context: ExtensionContext) {
  // The server is bundled alongside the client (see esbuild.mjs) — it's
  // *not* the sibling `server/` workspace at dev time, since the packaged
  // extension only ships this directory's own tree.
  const serverModule = context.asAbsolutePath(
    path.join("dist", "server.js")
  );

  // `typescript` is left external by esbuild (see esbuild.mjs) and vendored
  // into dist/vendor/typescript instead of node_modules — vsce's packaging
  // mode for this monorepo layout excludes any real node_modules dir
  // outright. NODE_PATH makes plain `require("typescript")` still resolve
  // there at runtime.
  const vendorPath = context.asAbsolutePath(path.join("dist", "vendor"));
  const serverEnv = { ...process.env, NODE_PATH: vendorPath };

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc, options: { env: serverEnv } },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      // Opens an inspector port on the forked server process so the
      // "Attach to Server" launch config can attach a debugger to it.
      options: { execArgv: ["--nolazy", "--inspect=6009"], env: serverEnv },
    },
  };

  const clientOptions: LanguageClientOptions = {
    // Register the server for all documents by default. We *could* scope this down to like .njk / .json / etc etc, but theres so many possible files its probably better just to activate it on all :shrug:
    documentSelector: [{ scheme: "file", language: "*" }],
    synchronize: {
      // Notify the server about file changes to '.clientrc files contained in the workspace
      // We should maybe expose this better?
      fileEvents: workspace.createFileSystemWatcher("**/*(.eleventyrc|eleventyrc)"),
    },
  };

  // Create the language client and start the client.
  const id = crypto.randomUUID().slice(0, 8)
  client = new LanguageClient(
    id,
    "11ty-lsp",
    serverOptions,
    clientOptions
  );

  // Start the client. This will also launch the server
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
