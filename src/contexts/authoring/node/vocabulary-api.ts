// BWrite's API: every route of the contract as one connect-style handler, mounted by the Vite
// dev and preview servers and by the `bwrite` command alike.
//
// It answers only on a localhost Host (so a page on another site cannot reach it through DNS
// rebinding), takes a POST only as application/json from BWrite's own origin (so another
// site cannot submit a form or a fetch into it), and caps the size of a request body.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { CreateRequest, ProjectProblem, Roots } from "../contracts/vocabulary-api";
import { MAX_BODY_BYTES, ROUTES } from "../contracts/vocabulary-api";
import { VocabularyEvents } from "./vocabulary-events";
import type { LoadedFile, VocabularyFileAdapter } from "../application/vocabulary-file-adapter";
import type { ArclintOptions } from "./arclint-file-adapter";
import { adapterFor } from "./vocabulary-file-detection";
import { ProblemError, refuse } from "../application/problem";
import { resolveProjectFolder } from "./roots";
import { readChanges, ShapeError } from "../application/vocabulary-shape";


const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

const STATUS: Record<ProblemError["problem"], number> = {
  "invalid-request": 400,
  "outside-roots": 403,
  "not-a-folder": 404,
  "file-invalid": 422,
  "format-cannot-hold": 422,
  "arclint-failed": 422,
  "arclint-missing": 503,
  "server-failed": 500,
};

export interface ApiOptions {
  roots: Roots;
  arclint?: ArclintOptions;
}

export type ConnectHandler = ((request: IncomingMessage, response: ServerResponse, next?: (error?: unknown) => void) => void) & {
  /** Ends every event stream and stops watching files. */
  close(): void;
  /** How many files event streams are watching now. */
  watching(): number;
};

/** The host part of a Host header when it names this machine's loopback interface, otherwise null. */
function localHost(host: string | undefined): string | null {
  if (!host) return null;
  const match = /^(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?$/i.exec(host.trim());
  if (!match || !LOCAL_HOSTNAMES.includes(match[1].toLowerCase())) return null;
  return host.trim().toLowerCase();
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(text);
}

function sendProblem(response: ServerResponse, problem: ProblemError, status = STATUS[problem.problem]): void {
  const answer: ProjectProblem = { ok: false, problem: problem.problem, message: problem.message };
  send(response, status, answer);
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const declared = Number(request.headers["content-length"]);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      reject(refuse("invalid-request", `The request body is larger than ${MAX_BODY_BYTES} bytes.`));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let refused = false;
    request.on("data", (chunk: Buffer) => {
      if (refused) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        refused = true;
        reject(refuse("invalid-request", `The request body is larger than ${MAX_BODY_BYTES} bytes.`));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (refused) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(refuse("invalid-request", "The request body is not JSON."));
      }
    });
    request.on("error", reject);
  });
}

function fields(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw refuse("invalid-request", "The request body must be a JSON object.");
  return body as Record<string, unknown>;
}

function answer(path: string, loaded: LoadedFile) {
  return { ok: true as const, path, source: loaded.source, document: loaded.document };
}

const GET_ROUTES: readonly string[] = [ROUTES.roots, ROUTES.vocabulary, ROUTES.rules, ROUTES.events];
const POST_ROUTES: readonly string[] = [ROUTES.create, ROUTES.plan, ROUTES.apply];

export function createVocabularyApi(options: ApiOptions): ConnectHandler {
  const events = new VocabularyEvents();
  /** Changes to one file run one at a time, in the order they arrived. */
  const queues = new Map<string, Promise<unknown>>();

  const serialized = <T>(file: string, work: () => Promise<T>): Promise<T> => {
    const previous = queues.get(file) ?? Promise.resolve();
    const run = previous.then(work, work);
    const tail = run.catch(() => undefined);
    queues.set(file, tail);
    void tail.then(() => {
      if (queues.get(file) === tail) queues.delete(file);
    });
    return run;
  };

  const open = async (requested: unknown): Promise<{ path: string; adapter: VocabularyFileAdapter }> => {
    const folder = await resolveProjectFolder(options.roots, requested);
    return { path: requested as string, adapter: await adapterFor(folder, options.arclint) };
  };

  const handle = async (request: IncomingMessage, response: ServerResponse, route: string, url: URL, host: string): Promise<void> => {
    const method = request.method ?? "GET";
    const origin = request.headers.origin;
    const ownOrigin = `http://${host}`;
    if (origin !== undefined && origin !== ownOrigin) {
      return sendProblem(response, refuse("invalid-request", `Requests from ${origin} are refused; BWrite answers only its own pages at ${ownOrigin}.`), 403);
    }

    if (GET_ROUTES.includes(route)) {
      if (method !== "GET") {
        response.setHeader("allow", "GET");
        return sendProblem(response, refuse("invalid-request", `${route} takes GET.`), 405);
      }
      if (route === ROUTES.roots) return send(response, 200, { ok: true, ...options.roots });
      const { path, adapter } = await open(url.searchParams.get("path") ?? undefined);
      if (route === ROUTES.vocabulary) return send(response, 200, answer(path, await adapter.load()));
      if (route === ROUTES.rules) return send(response, 200, { ok: true, path, rules: await adapter.rules() });
      return events.listen(adapter.watchedFile, path, response);
    }

    if (method !== "POST") {
      response.setHeader("allow", "POST");
      return sendProblem(response, refuse("invalid-request", `${route} takes POST.`), 405);
    }
    if (origin === undefined) return sendProblem(response, refuse("invalid-request", `A POST to ${route} must carry the Origin of BWrite's own page.`), 403);
    const type = (request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return sendProblem(response, refuse("invalid-request", "A POST must be sent as application/json."), 415);

    let body: Record<string, unknown>;
    try {
      body = fields(await readBody(request));
    } catch (error) {
      if (error instanceof ProblemError && error.message.includes("larger than")) return sendProblem(response, error, 413);
      throw error;
    }
    const { path, adapter } = await open(body.path);

    if (route === ROUTES.create) {
      const format = body.format as CreateRequest["format"];
      if (format !== "arclint" && format !== "bwrite") throw refuse("invalid-request", "format must be arclint or bwrite.");
      if (format !== adapter.format) {
        throw refuse(
          "invalid-request",
          adapter.format === "arclint"
            ? `${path} is set up for arclint, so its VocabularyFile is arclint's domain.arclint.yaml.`
            : `${path} is not set up for arclint: arclint finds no rules.arclint.yaml there. Run arclint init first, or use BWrite's own file.`,
        );
      }
      return send(response, 200, answer(path, await serialized(adapter.watchedFile, () => adapter.create())));
    }

    let changes;
    try {
      changes = readChanges(body.changes);
    } catch (error) {
      if (error instanceof ShapeError) throw refuse("invalid-request", error.message);
      throw error;
    }
    if (route === ROUTES.plan) return send(response, 200, { ok: true, path, steps: await adapter.plan(changes) });
    return send(response, 200, answer(path, await serialized(adapter.watchedFile, () => adapter.apply(changes))));
  };

  const handler = ((request: IncomingMessage, response: ServerResponse, next?: (error?: unknown) => void) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const route = url.pathname;
    if (!route.startsWith("/api/")) {
      if (next) next();
      else sendProblem(response, refuse("invalid-request", `Nothing is served at ${route}.`), 404);
      return;
    }
    const host = localHost(request.headers.host);
    if (host === null) {
      sendProblem(response, refuse("invalid-request", "BWrite answers only requests addressed to localhost, 127.0.0.1, or [::1]."), 403);
      return;
    }
    if (!GET_ROUTES.includes(route) && !POST_ROUTES.includes(route)) {
      sendProblem(response, refuse("invalid-request", `BWrite has no API route ${route}.`), 404);
      return;
    }
    handle(request, response, route, url, host).catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (error instanceof ProblemError) return sendProblem(response, error);
      const message = error instanceof Error ? error.message : String(error);
      send(response, 500, { ok: false, problem: "server-failed", message: `BWrite's server could not answer: ${message}` });
    });
  }) as ConnectHandler;
  handler.close = () => events.close();
  handler.watching = () => events.watchedFiles;
  return handler;
}
