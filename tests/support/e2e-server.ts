// Starts BWrite for the acceptance tests over two real Project folders, as Playwright's
// webServer: a fresh git repository set up for arclint with copies of this repository's
// rules.arclint.yaml and domain.arclint.yaml (the launch root, listed first in BWRITE_ROOTS),
// and a folder with a small ubiquitous-language.bwrite.yaml. playwright.config.ts names the
// folders, so the suites find them in BWRITE_ROOTS; this process creates them before BWrite
// starts and removes them when Playwright stops it.
//
//   BWRITE_E2E_BASE=<folder> BWRITE_E2E_PORT=<port> BWRITE_ROOTS=<arclint>:<bwrite> node tests/support/e2e-server.ts

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

const BWRITE_FILE = `version: 1
project: bookshop
description: Selling second-hand books.
terms:
  - name: Selling
    kind: bounded_context
    definition: Listing books and taking orders for them.
  - name: Listing
    kind: aggregate
    context: Selling
    identity: ListingId
    definition: One copy of a book offered for sale.
    invariants:
      - key: has-a-price
        statement: A Listing always has a price.
  - name: ListingId
    kind: value_object
    context: Selling
    definition: Identifies a Listing.
`;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) throw new Error(`${name} is not set; playwright.config.ts passes it.`);
  return value;
}

const base = required("BWRITE_E2E_BASE");
const port = required("BWRITE_E2E_PORT");
const [arclintProject, bwriteProject] = required("BWRITE_ROOTS").split(path.delimiter) as [string, string];

rmSync(base, { recursive: true, force: true });
mkdirSync(arclintProject, { recursive: true });
mkdirSync(bwriteProject, { recursive: true });
execFileSync("git", ["init", "-q"], { cwd: arclintProject });
copyFileSync(path.join(REPO_ROOT, "rules.arclint.yaml"), path.join(arclintProject, "rules.arclint.yaml"));
copyFileSync(path.join(REPO_ROOT, "domain.arclint.yaml"), path.join(arclintProject, "domain.arclint.yaml"));
writeFileSync(path.join(bwriteProject, "ubiquitous-language.bwrite.yaml"), BWRITE_FILE);

const server = spawn("npx", ["vite", "--port", port, "--strictPort"], {
  cwd: REPO_ROOT,
  env: process.env,
  stdio: ["ignore", "inherit", "inherit"],
  detached: true,
});

const stop = () => {
  if (server.pid !== undefined && server.exitCode === null) process.kill(-server.pid, "SIGTERM");
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
server.once("exit", (code) => {
  rmSync(base, { recursive: true, force: true });
  process.exit(code ?? 0);
});
