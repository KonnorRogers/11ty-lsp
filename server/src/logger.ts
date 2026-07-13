import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"

const home = os.homedir()
const debugFile = path.join(home, "debug.log")
const writeStream = fs.createWriteStream(debugFile)

export function serializeError(e: unknown) {
  if (e instanceof Error) return {
    name: e.name,
    message: e.message,
    stack: e.stack
  };
  return { value: e };
}

export class Logger {
  write (message: object | unknown) {
    if (typeof message === "object") {
      writeStream.write(JSON.stringify(message, null, 2))
    } else {
      writeStream.write(String(message))
    }
    writeStream.write("\n")
  }
}

export const logger = new Logger()

process.on("uncaughtException", (e) => logger.write({ label: "uncaughtException", error: serializeError(e) }));
process.on("unhandledRejection", (e) => logger.write({ label: "unhandledRejection", error: serializeError(e) }));
