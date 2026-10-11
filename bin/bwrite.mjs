#!/usr/bin/env node
// The `bwrite` command. Its code is built with the page by `npm run build`, into dist-server.

let cli;
try {
  cli = await import("../dist-server/cli.js");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND" || !String(error.message).includes("dist-server")) throw error;
  console.error("bwrite: BWrite is not built; run npm run build first.");
  process.exit(1);
}
await cli.main(process.argv.slice(2));
