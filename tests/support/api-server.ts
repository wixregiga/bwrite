import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { request as httpRequest, createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";
import { composeApi, type ConnectHandler } from "../../server/app/vocabulary-server";

const run = promisify(execFile);

export const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

const made: string[] = [];

export async function tempFolder(prefix = "bwrite-test-"): Promise<string> {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  made.push(folder);
  return folder;
}

export async function removeTempFolders(): Promise<void> {
  await Promise.all(made.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
}

export function arclint(cwd: string, ...argv: string[]): Promise<{ stdout: string; stderr: string }> {
  return run("arclint", argv, { cwd });
}

/** A folder set up for arclint the way a new project is: a minimal rules file, then `arclint domain init`. */
export async function arclintRepo(): Promise<string> {
  const folder = await tempFolder("bwrite-arclint-");
  await writeFile(path.join(folder, "rules.arclint.yaml"), 'runtime: [ts]\nzones:\n  source: "src/**"\nrules: {}\n');
  await arclint(folder, "domain", "init");
  return folder;
}

/** domain.arclint.yaml as it is on disk, parsed. */
export async function domainOnDisk(folder: string): Promise<DomainYaml> {
  return parse(await readFile(path.join(folder, "domain.arclint.yaml"), "utf8")) as DomainYaml;
}

export interface DomainYaml {
  project: string;
  description?: string;
  contexts?: Record<string, ContextYaml>;
  relations?: { from: string; to: string; kind: string }[];
}
export interface ContextYaml {
  definition: string;
  aggregates?: Record<string, { definition: string; identity: string; aliases?: string[]; entities?: Record<string, { definition: string; identity?: string; aliases?: string[] }>; invariants?: Record<string, string>; assertions?: Record<string, { on: string; statement: string }>; repository?: string; factory?: string }>;
  value_objects?: Record<string, { definition: string; aliases?: string[]; invariants?: Record<string, string> }>;
  events?: Record<string, { definition: string; raised_by?: string }>;
  services?: Record<string, { definition: string; assertions?: Record<string, { on: string; statement: string }> }>;
  specifications?: Record<string, { definition: string }>;
  questions?: Record<string, string>;
}

export interface RunningApi {
  base: string;
  port: number;
  api: ConnectHandler;
  server: Server;
  close(): Promise<void>;
}

export async function startApi(roots: string[], arclintCommand?: string): Promise<RunningApi> {
  const { api } = await composeApi({ roots, cwd: process.cwd(), arclintCommand: arclintCommand || undefined });
  const server = createServer((req, res) => api(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    port,
    api,
    server,
    close: () =>
      new Promise<void>((resolve) => {
        api.close();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export interface RawAnswer {
  status: number;
  body: any;
}

/** A request with full control over the headers, Host included. */
export function rawRequest(port: number, method: string, target: string, headers: Record<string, string>, body?: string): Promise<RawAnswer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method, path: target, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** A POST the way BWrite's own page sends it. */
export function post(running: RunningApi, route: string, body: unknown): Promise<RawAnswer> {
  const text = JSON.stringify(body);
  return rawRequest(running.port, "POST", route, {
    host: `127.0.0.1:${running.port}`,
    origin: `http://127.0.0.1:${running.port}`,
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(text)),
  }, text);
}

export function get(running: RunningApi, route: string, query: Record<string, string> = {}): Promise<RawAnswer> {
  const search = new URLSearchParams(query).toString();
  return rawRequest(running.port, "GET", search ? `${route}?${search}` : route, { host: `127.0.0.1:${running.port}` });
}
