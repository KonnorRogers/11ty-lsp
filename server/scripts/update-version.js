// scripts/update-version.js

import * as fs from "fs"
import * as path from "path"
import * as url from 'url';
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
const __filename = url.fileURLToPath(new URL(import.meta.url));

const filepath = path.relative(process.cwd(), __filename)

const version = process.env.npm_package_version
// console.log("VERSION: ", version)
if (!version) {
  console.error(`"${filepath}" must be run via NPM's runner. Use: "npm run update-version" for this to work properly.`)
  process.exit(1)
}

const data = `// This file is auto-generated. Do not manually edit this.
export const version = "${version}";`

// Must be .ts, not .js: server.ts does `import { version } from "./version"`,
// and TypeScript resolves that to a co-located version.ts before ever
// considering a version.js — writing .js here left this whole generator
// silently dead (the hand-authored version.ts always won instead).
fs.writeFileSync(path.resolve(__dirname, "../src/version.ts"), data)
