// The `bwrite` command: serves the built page and BWrite's API from where it is started,
// on localhost only, with Node's own http server.
//
//   bwrite [--root <folder>]... [--port <number>]
//
// Without --root, the roots come from BWRITE_ROOTS, and without that, the working directory.

import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isInside } from "../../src/contexts/authoring/node/roots";
import { composeApi } from "./vocabulary-server";

export const DEFAULT_PORT = 4373;
const HOST = "127.0.0.1";

const USAGE = `Usage: bwrite [--root <folder>]... [--port <number>]

Serves BWrite for the Projects in the given folders, on http://${HOST} only.
  --root <folder>  a folder BWrite may read; repeat for several. The first is where a new
                   Project's path starts. Default: BWRITE_ROOTS, or the working directory.
  --port <number>  the port to listen on; 0 picks a free one. Default: ${DEFAULT_PORT}.
  --help           print this help.`;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

export interface CliOptions {
  roots: string[];
  port: number;
  help: boolean;
}

export function parseArguments(argv: readonly string[]): CliOptions {
  const options: CliOptions = { roots: [], port: DEFAULT_PORT, help: false };
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    const [flag, inline] = argument.startsWith("--") && argument.includes("=") ? [argument.slice(0, argument.indexOf("=")), argument.slice(argument.indexOf("=") + 1)] : [argument, undefined];
    const take = (): string => {
      const value = inline ?? argv[++i];
      if (value === undefined || value.length === 0) throw new Error(`${flag} needs a value`);
      return value;
    };
    if (flag === "--help" || flag === "-h") options.help = true;
    else if (flag === "--root") options.roots.push(take());
    else if (flag === "--port") {
      const text = take();
      const port = Number(text);
      if (!/^\d+$/.test(text) || port > 65535) throw new Error(`--port takes a number from 0 to 65535, not ${text}`);
      options.port = port;
    } else throw new Error(`Unknown argument ${argument}`);
  }
  return options;
}

/** Serves files from `folder`, falling back to index.html for the page's own routes. */
function staticFiles(folder: string) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (pathname.includes("\0")) {
      response.writeHead(400).end();
      return;
    }
    let file = path.join(folder, path.normalize(pathname));
    let found = false;
    try {
      const real = await realpath(file);
      found = isInside(folder, real) && (await stat(real)).isFile();
      file = real;
    } catch {
      found = false;
    }
    if (!found) {
      if (path.extname(pathname) !== "") {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
        return;
      }
      file = path.join(folder, "index.html");
    }
    const headers: Record<string, string> = {
      "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
      "cache-control": file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
    };
    response.writeHead(200, headers);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(file)
      .on("error", () => response.destroy())
      .pipe(response);
  };
}

/** Starts the server and answers the URL it listens on. */
export async function startBwrite(options: CliOptions, cwd = process.cwd()) {
  const page = fileURLToPath(new URL("../dist/", import.meta.url));
  try {
    await stat(path.join(page, "index.html"));
  } catch {
    throw new Error(`BWrite's page is not built at ${page}; run npm run build first.`);
  }
  const { api, roots } = await composeApi({ roots: options.roots.length > 0 ? options.roots : undefined, cwd });
  const files = staticFiles(await realpath(page));
  const server = createServer((request, response) => {
    api(request, response, () => {
      files(request, response).catch(() => response.destroy());
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, HOST, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  const close = () =>
    new Promise<void>((resolve) => {
      api.close();
      server.close(() => resolve());
      server.closeAllConnections();
    });
  return { url: `http://${HOST}:${port}/`, roots, close };
}

export async function main(argv: readonly string[]): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArguments(argv);
  } catch (error) {
    console.error(`bwrite: ${(error as Error).message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }
  try {
    const running = await startBwrite(options);
    console.log(`BWrite is serving ${running.roots.roots.join(", ")} at ${running.url}`);
    const stop = () => {
      void running.close().then(() => process.exit(0));
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch (error) {
    console.error(`bwrite: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
