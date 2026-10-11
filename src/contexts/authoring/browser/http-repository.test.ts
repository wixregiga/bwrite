import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Project } from "../domain/project";
import { projectIdOf } from "../domain/project-id";
import { projectPathOf } from "../domain/project-path";
import { ROUTES, type ProjectProblemKind } from "../contracts/vocabulary-api";
import { type VocabularyChange } from "../application/vocabulary-document";
import { HttpUbiquitousLanguageRepository, problemMessage } from "./http-repository";
import { REPO_ROOT, arclintDocument } from "../../../../tests/support/unit/arclint-listing";
import { ARCLINT_FILE } from "../../../../tests/support/unit/language-builders";

/** What each problem means for the author; a Record over the union, so a new kind fails to compile here. */
const LEADS: Record<ProjectProblemKind, string> = {
  "outside-roots": "BWrite was not started with access to this folder.",
  "not-a-folder": "This path is not a folder.",
  "arclint-missing": "arclint is not installed where BWrite runs, and this folder's vocabulary is kept by arclint.",
  "arclint-failed": "arclint refused the change.",
  "file-invalid": "The vocabulary file cannot be read.",
  "format-cannot-hold": "The vocabulary file's format cannot keep this.",
  "invalid-request": "BWrite sent a request the server could not accept.",
  "server-failed": "BWrite's server could not finish the work.",
};

/** arclint's own words when it refuses: run in a folder it is not set up for. */
function arclintRefusal(): string {
  const folder = mkdtempSync(join(tmpdir(), "bwrite-unit-"));
  try {
    execFileSync("arclint", ["domain", "list", "--format", "json"], { cwd: folder, encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    return String((error as { stderr: string }).stderr);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  throw new Error("arclint did not refuse a folder without rules.arclint.yaml");
}
const ARCLINT_SAYS = arclintRefusal();

describe("problemMessage", () => {
  it("has arclint's real refusal to work with", () => {
    expect(ARCLINT_SAYS).toMatch(/^arclint: .*rules\.arclint\.yaml/u);
  });

  it.each(Object.entries(LEADS) as [ProjectProblemKind, string][])(
    "leads %s with what it means, then keeps the server's message verbatim",
    (kind, lead) => {
      const detail = ARCLINT_SAYS.trim();
      const message = problemMessage(kind, ARCLINT_SAYS);
      expect(message).toBe(`${lead} ${detail}`);
      expect(message.slice(lead.length + 1)).toBe(detail);
    },
  );

  it.each(Object.entries(LEADS) as [ProjectProblemKind, string][])("says only what %s means when the server adds nothing", (kind, lead) => {
    expect(problemMessage(kind, "")).toBe(lead);
    expect(problemMessage(kind, " \n")).toBe(lead);
    expect(problemMessage(kind, lead)).toBe(lead);
  });

  it("keeps a multi-line message, its quoting, and its punctuation as the server wrote them", () => {
    const detail = 'domain.arclint.yaml:12: contexts.authoring.aggregates["Order"]: identity "OrderId" is not a value object.\nRun `arclint domain show`.';
    expect(problemMessage("file-invalid", detail)).toBe(`${LEADS["file-invalid"]} ${detail}`);
  });
});

describe("HttpUbiquitousLanguageRepository over a real HTTP server", () => {
  const PROJECT_PATH = projectPathOf(REPO_ROOT);
  const project = new Project({ id: projectIdOf("project-http"), name: "BWrite", description: "", goals: [], path: PROJECT_PATH });
  const document = arclintDocument();
  const requests: { method: string; url: string; body: string }[] = [];
  let answer: (req: IncomingMessage, res: ServerResponse) => void = () => {};
  let server: Server;

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      req.on("end", () => {
        requests.push({ method: req.method!, url: req.url!, body });
        answer(req, res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const realFetch = globalThis.fetch;
    // The page fetches its own origin by path; here that origin is the test server.
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => realFetch(new URL(url, base), init));
  });
  afterEach(() => {
    requests.length = 0;
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("loads the file and its document, naming the project's folder in the query", async () => {
    answer = (_req, res) => json(res, 200, { ok: true, path: PROJECT_PATH, source: ARCLINT_FILE, document });
    const loaded = await new HttpUbiquitousLanguageRepository().load(project);
    expect(loaded).toEqual({ ok: true, value: { file: ARCLINT_FILE, document } });
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]!.url, "http://x");
    expect(url.pathname).toBe(ROUTES.vocabulary);
    expect(url.searchParams.get("path")).toBe(PROJECT_PATH);
  });

  it("posts the changes to save, and answers with the file as read back", async () => {
    const changes: VocabularyChange[] = [{ type: "put-term", term: document.terms[0]! }];
    answer = (_req, res) => json(res, 200, { ok: true, path: PROJECT_PATH, source: ARCLINT_FILE, document });
    const saved = await new HttpUbiquitousLanguageRepository().save(project, changes);
    expect(saved).toEqual({ ok: true, value: { file: ARCLINT_FILE, document } });
    expect(requests[0]).toMatchObject({ method: "POST", url: ROUTES.apply });
    expect(JSON.parse(requests[0]!.body)).toEqual({ path: PROJECT_PATH, changes });
  });

  it("reports the server's problem with its lead and arclint's own words", async () => {
    answer = (_req, res) => json(res, 422, { ok: false, problem: "arclint-failed", message: ARCLINT_SAYS });
    const loaded = await new HttpUbiquitousLanguageRepository().load(project);
    expect(loaded).toEqual({ ok: false, problem: "arclint-failed", message: `${LEADS["arclint-failed"]} ${ARCLINT_SAYS.trim()}` });
  });

  it("reports an answer that is not JSON as a server that did not answer", async () => {
    answer = (_req, res) => {
      res.writeHead(502, { "Content-Type": "text/html" });
      res.end("<html>Bad Gateway</html>");
    };
    expect(await new HttpUbiquitousLanguageRepository().load(project)).toEqual({
      ok: false,
      problem: "server-failed",
      message: "BWrite's server did not answer (502 Bad Gateway: the answer is not JSON). Start BWrite with its server, then reload.",
    });
  });

  const refusesUnknownKind = async (problem: string) => {
    answer = (_req, res) => json(res, 400, { ok: false, problem, message: "x" });
    expect(await new HttpUbiquitousLanguageRepository().load(project)).toEqual({
      ok: false,
      problem: "server-failed",
      message: "BWrite's server did not answer (400 Bad Request: the answer is not one BWrite knows). Start BWrite with its server, then reload.",
    });
  };

  it("refuses a problem of a kind the contract does not name", () => refusesUnknownKind("no-such-kind"));

  // Names inherited from Object.prototype are not problem kinds either.
  it.each(["constructor", "toString"])("refuses a problem named like an Object.prototype member: %s", refusesUnknownKind);
});
