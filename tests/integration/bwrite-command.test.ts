// The `bwrite` command as a user runs it after `npm run build`: a separate Node process that
// serves the built page and the API from the folder it is started in.

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUTES } from "../../src/contexts/authoring/contracts/vocabulary-api";
import { arclintRepo, REPO_ROOT, removeTempFolders, tempFolder } from "../support/api-server";

const run = promisify(execFile);
const BIN = path.join(REPO_ROOT, "bin", "bwrite.mjs");
const started: ChildProcess[] = [];

async function built(): Promise<boolean> {
  try {
    await access(path.join(REPO_ROOT, "dist-server", "cli.js"));
    await access(path.join(REPO_ROOT, "dist", "index.html"));
    return true;
  } catch {
    return false;
  }
}

/** Starts `bwrite` and answers the URL it prints. */
function startBwrite(args: string[], cwd: string): Promise<{ url: string; child: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, BWRITE_ROOTS: "" }, stdio: ["ignore", "pipe", "pipe"] });
    started.push(child);
    let output = "";
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const match = /at (http:\/\/127\.0\.0\.1:\d+\/)/.exec(output);
      if (match) resolve({ url: match[1], child });
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.on("exit", (code) => reject(new Error(`bwrite exited with ${code}: ${output}`)));
  });
}

beforeAll(async () => {
  if (!(await built())) await run("npm", ["run", "build"], { cwd: REPO_ROOT, timeout: 300_000 });
}, 320_000);

afterAll(async () => {
  for (const child of started) child.kill("SIGTERM");
  await removeTempFolders();
});

describe("the bwrite command", () => {
  it("serves the built page and the API for the given roots, on 127.0.0.1", async () => {
    const project = await tempFolder("bwrite-cli-");
    const arclintProject = await arclintRepo();
    await writeFile(path.join(project, "ubiquitous-language.bwrite.yaml"), "version: 1\nproject: shop\nterms: []\n");
    const { url } = await startBwrite(["--root", project, "--root", arclintProject, "--port", "0"], REPO_ROOT);

    const page = await fetch(url);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<div id="root"></div>');
    const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)![1];
    const asset = await fetch(new URL(script, url));
    expect(asset.headers.get("content-type")).toMatch(/^text\/javascript/);
    expect((await fetch(new URL("/features/some-deep-link", url))).headers.get("content-type")).toMatch(/^text\/html/);
    expect((await fetch(new URL("/assets/missing.js", url))).status).toBe(404);

    expect(await (await fetch(new URL(ROUTES.roots, url))).json()).toEqual({ ok: true, launchRoot: project, roots: [project, arclintProject] });
    const bwrite = await (await fetch(new URL(`${ROUTES.vocabulary}?path=${encodeURIComponent(project)}`, url))).json();
    expect(bwrite).toMatchObject({ ok: true, source: { format: "bwrite", found: true }, document: { project: "shop" } });
    const arclint = await (await fetch(new URL(`${ROUTES.vocabulary}?path=${encodeURIComponent(arclintProject)}`, url))).json();
    expect(arclint).toMatchObject({ ok: true, source: { format: "arclint", found: true } });
  });

  it("serves the folder it is started in when given no root, and stops on SIGTERM", async () => {
    const project = await tempFolder("bwrite-cli-cwd-");
    const { url, child } = await startBwrite(["--port", "0"], project);
    expect(await (await fetch(new URL(ROUTES.roots, url))).json()).toEqual({ ok: true, launchRoot: project, roots: [project] });
    child.removeAllListeners("exit");
    const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
    child.kill("SIGTERM");
    expect(await exited).toBe(0);
  });

  it("refuses unknown arguments with its usage", async () => {
    const failure = await run(process.execPath, [BIN, "--rooot", "/"]).catch((error: { code: number; stderr: string }) => error);
    expect((failure as { code: number }).code).toBe(2);
    expect((failure as { stderr: string }).stderr).toContain("Usage: bwrite");
  });
});
