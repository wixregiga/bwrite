// BWrite's API over real HTTP, on real temporary folders: format detection, the roots and
// path checks, the request guards, and the change event after an edit made outside BWrite.

import { mkdir, rename, symlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, ROUTES, VOCABULARY_CHANGED } from "../../src/contexts/authoring/contracts/vocabulary-api";
import { arclint, arclintRepo, get, post, rawRequest, removeTempFolders, startApi, tempFolder, type RunningApi } from "../support/api-server";

const BWRITE_YAML = "version: 1\nproject: shop\nterms:\n  - name: Sales\n    kind: bounded_context\n    definition: Taking orders.\n";

let arclintFolder: string;
let bwriteFolder: string;
let outsideFolder: string;
let running: RunningApi;

beforeAll(async () => {
  arclintFolder = await arclintRepo();
  bwriteFolder = await tempFolder("bwrite-api-");
  outsideFolder = await tempFolder("bwrite-outside-");
  await writeFile(path.join(bwriteFolder, "ubiquitous-language.bwrite.yaml"), BWRITE_YAML);
  await mkdir(path.join(arclintFolder, "src", "orders"), { recursive: true });
  await symlink(outsideFolder, path.join(bwriteFolder, "escape"));
  running = await startApi([arclintFolder, bwriteFolder]);
});

afterAll(async () => {
  await running.close();
  await removeTempFolders();
});

describe("roots and paths", () => {
  it("answers the roots, the launch root first", async () => {
    const { status, body } = await get(running, ROUTES.roots);
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, launchRoot: arclintFolder, roots: [arclintFolder, bwriteFolder] });
  });

  it("refuses a path outside the roots, and a symbolic link that escapes them", async () => {
    for (const target of [outsideFolder, path.join(bwriteFolder, "escape"), path.join(bwriteFolder, "..")]) {
      const { status, body } = await get(running, ROUTES.vocabulary, { path: target });
      expect(status).toBe(403);
      expect(body.problem).toBe("outside-roots");
    }
  });

  it("refuses a relative path, a missing folder, and a file", async () => {
    expect((await get(running, ROUTES.vocabulary, { path: "relative/folder" })).body.problem).toBe("invalid-request");
    expect((await get(running, ROUTES.vocabulary, { path: path.join(bwriteFolder, "missing") })).body.problem).toBe("not-a-folder");
    expect((await get(running, ROUTES.vocabulary, { path: path.join(bwriteFolder, "ubiquitous-language.bwrite.yaml") })).body.problem).toBe("not-a-folder");
  });
});

describe("format detection", () => {
  it("uses arclint's file where arclint finds a rules.arclint.yaml, also from a subfolder", async () => {
    const { body } = await get(running, ROUTES.vocabulary, { path: arclintFolder });
    expect(body).toMatchObject({ ok: true, path: arclintFolder, source: { format: "arclint", file: "domain.arclint.yaml", found: true } });
    const nested = await get(running, ROUTES.vocabulary, { path: path.join(arclintFolder, "src", "orders") });
    expect(nested.body.source).toMatchObject({ format: "arclint", file: path.join("..", "..", "domain.arclint.yaml") });
    const listed = JSON.parse((await arclint(arclintFolder, "rules", "--format", "json")).stdout);
    expect((await get(running, ROUTES.rules, { path: arclintFolder })).body).toEqual({ ok: true, path: arclintFolder, rules: listed });
  });

  it("uses BWrite's own file anywhere else, with no rules", async () => {
    const { body } = await get(running, ROUTES.vocabulary, { path: bwriteFolder });
    expect(body).toMatchObject({ ok: true, source: { format: "bwrite", found: true }, document: { project: "shop" } });
    expect((await get(running, ROUTES.rules, { path: bwriteFolder })).body).toEqual({ ok: true, path: bwriteFolder, rules: [] });
  });

  it("without arclint installed, uses BWrite's file unless the folder has a rules.arclint.yaml", async () => {
    const noArclint = await startApi([arclintFolder, bwriteFolder], "arclint-not-installed-anywhere");
    try {
      expect((await get(noArclint, ROUTES.vocabulary, { path: bwriteFolder })).body.source.format).toBe("bwrite");
      const { status, body } = await get(noArclint, ROUTES.vocabulary, { path: arclintFolder });
      expect(status).toBe(503);
      expect(body.problem).toBe("arclint-missing");
    } finally {
      await noArclint.close();
    }
  });

  it("creates the file of the folder's own format, and refuses the other", async () => {
    const empty = path.join(bwriteFolder, "new-project");
    await mkdir(empty);
    expect((await post(running, ROUTES.create, { path: empty, format: "arclint" })).body.problem).toBe("invalid-request");
    const { body } = await post(running, ROUTES.create, { path: empty, format: "bwrite" });
    expect(body).toMatchObject({ ok: true, source: { format: "bwrite", found: true }, document: { version: 1, project: "new-project", terms: [] } });
  });
});

describe("changes through the API", () => {
  it("plans and applies to arclint's file, then reads it back", async () => {
    const changes = [{ type: "put-term", term: { name: "sales", kind: "bounded_context", definition: "Selling." } }];
    const plan = await post(running, ROUTES.plan, { path: arclintFolder, changes });
    expect(plan.body).toEqual({ ok: true, path: arclintFolder, steps: [{ description: "Record Bounded Context sales.", command: ["domain", "define", "bounded_context", "sales", "--definition", "Selling."] }] });
    const applied = await post(running, ROUTES.apply, { path: arclintFolder, changes });
    expect(applied.body.document.terms).toEqual([{ name: "sales", kind: "bounded_context", definition: "Selling." }]);
  });

  it("refuses flag injection in every value", async () => {
    const { status, body } = await post(running, ROUTES.apply, {
      path: arclintFolder,
      changes: [{ type: "put-term", term: { name: "Money", kind: "value_object", context: "sales", definition: "x", aliases: ["--clear-aliases"] } }],
    });
    expect(status).toBe(400);
    expect(body.problem).toBe("invalid-request");
  });

  it("refuses a malformed change set with the path of the bad field", async () => {
    const { body } = await post(running, ROUTES.plan, { path: bwriteFolder, changes: [{ type: "put-term", term: { name: "X", kind: "thing", definition: "" } }] });
    expect(body).toMatchObject({ ok: false, problem: "invalid-request" });
    expect(body.message).toContain("changes[0].term.kind");
  });
});

describe("request guards", () => {
  const body = JSON.stringify({ path: "/", changes: [] });

  it("refuses a Host other than localhost, 127.0.0.1, or [::1]", async () => {
    const { status } = await rawRequest(running.port, "GET", ROUTES.roots, { host: "attacker.example" });
    expect(status).toBe(403);
    for (const host of [`localhost:${running.port}`, `127.0.0.1:${running.port}`, `[::1]:${running.port}`]) {
      expect((await rawRequest(running.port, "GET", ROUTES.roots, { host })).status).toBe(200);
    }
  });

  it("refuses a cross-origin POST, and a POST without an Origin", async () => {
    const headers = { host: `127.0.0.1:${running.port}`, "content-type": "application/json" };
    const cross = await rawRequest(running.port, "POST", ROUTES.plan, { ...headers, origin: "http://attacker.example" }, body);
    expect(cross.status).toBe(403);
    expect(cross.body.problem).toBe("invalid-request");
    expect((await rawRequest(running.port, "POST", ROUTES.plan, { ...headers, origin: `http://localhost:${running.port}` }, body)).status).toBe(403);
    expect((await rawRequest(running.port, "POST", ROUTES.plan, headers, body)).status).toBe(403);
  });

  it("refuses a POST that is not application/json", async () => {
    const { status } = await rawRequest(running.port, "POST", ROUTES.plan, { host: `127.0.0.1:${running.port}`, origin: `http://127.0.0.1:${running.port}`, "content-type": "text/plain" }, body);
    expect(status).toBe(415);
  });

  it("caps the body size", async () => {
    const huge = JSON.stringify({ path: bwriteFolder, changes: [], padding: "x".repeat(MAX_BODY_BYTES) });
    const { status, body: answer } = await rawRequest(running.port, "POST", ROUTES.plan, { host: `127.0.0.1:${running.port}`, origin: `http://127.0.0.1:${running.port}`, "content-type": "application/json" }, huge);
    expect(status).toBe(413);
    expect(answer.problem).toBe("invalid-request");
  });

  it("answers wrong methods and unknown routes", async () => {
    expect((await rawRequest(running.port, "POST", ROUTES.roots, { host: `127.0.0.1:${running.port}`, origin: `http://127.0.0.1:${running.port}` })).status).toBe(405);
    expect((await get(running, "/api/nothing")).status).toBe(404);
  });
});

/** Opens the event stream and collects the events it sends. */
function listen(path_: string): Promise<{ events: string[]; close(): void; opened: Promise<void> }> {
  return new Promise((resolve, reject) => {
    const events: string[] = [];
    let opened!: () => void;
    const openedPromise = new Promise<void>((r) => (opened = r));
    const req = httpRequest(
      { host: "127.0.0.1", port: running.port, path: `${ROUTES.events}?${new URLSearchParams({ path: path_ })}`, headers: { host: `127.0.0.1:${running.port}`, accept: "text/event-stream" } },
      (res) => {
        expect(res.headers["content-type"]).toMatch(/^text\/event-stream/);
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          if (chunk.includes("retry:")) opened();
          for (const match of chunk.matchAll(/event: (.+)\ndata: (.+)\n\n/g)) events.push(`${match[1]} ${match[2]}`);
        });
      },
    );
    req.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") reject(error);
    });
    req.end();
    resolve({ events, close: () => req.destroy(), opened: openedPromise });
  });
}

async function eventually(check: () => boolean, ms = 5000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("change events", () => {
  it("sends one debounced event after an outside edit saved by rename, and stops watching on disconnect", async () => {
    const stream = await listen(bwriteFolder);
    await stream.opened;
    const file = path.join(bwriteFolder, "ubiquitous-language.bwrite.yaml");
    const temporary = path.join(bwriteFolder, ".editor-save.tmp");
    await writeFile(temporary, `${BWRITE_YAML}description: Edited elsewhere.\n`);
    await rename(temporary, file);
    await writeFile(file, `${BWRITE_YAML}description: Edited again.\n`);
    await eventually(() => stream.events.length > 0);
    await new Promise((r) => setTimeout(r, 400));
    expect(stream.events).toEqual([`${VOCABULARY_CHANGED} ${JSON.stringify({ path: bwriteFolder })}`]);

    await writeFile(file, BWRITE_YAML);
    await eventually(() => stream.events.length === 2);
    expect(running.api.watching()).toBe(1);
    stream.close();
    await eventually(() => running.api.watching() === 0);
  });

  it("sends an event when arclint changes domain.arclint.yaml", async () => {
    const stream = await listen(arclintFolder);
    await stream.opened;
    await post(running, ROUTES.apply, { path: arclintFolder, changes: [{ type: "put-term", term: { name: "billing", kind: "bounded_context", definition: "Invoicing." } }] });
    await eventually(() => stream.events.length > 0);
    expect(stream.events[0]).toBe(`${VOCABULARY_CHANGED} ${JSON.stringify({ path: arclintFolder })}`);
    stream.close();
  });
});
