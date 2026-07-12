import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"

const home = os.homedir()
const debugFile = path.join(home, "debug.log")
const writeStream = fs.createWriteStream(debugFile)

export const logger = {
  write: (message: object | unknown) => {
    if (typeof message === "object") {
      writeStream.write(JSON.stringify(message, null, 2))
    } else {
      writeStream.write(String(message))
    }
    writeStream.write("\n")
  }
}

