import { copyFileSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "./arclint-listing";

// Folders a unit test writes into, under the system's temporary directory. A suite
// registers `afterAll(removeTemporaryFolders)` to remove every folder it made.

const made: string[] = [];

export interface TemporaryFolderOptions {
  /** The start of the folder's name, so a leftover folder names the suite that made it. */
  prefix?: string;
  /** Copies this repository's rules.arclint.yaml and domain.arclint.yaml in, for arclint to change without touching the repository. */
  withRepositoryDomain?: boolean;
}

/** A new folder, empty or holding a copy of this repository's arclint files, by its resolved real path. */
export function temporaryFolder({ prefix = "bwrite-unit-", withRepositoryDomain = false }: TemporaryFolderOptions = {}): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(folder);
  if (withRepositoryDomain) {
    for (const file of ["rules.arclint.yaml", "domain.arclint.yaml"]) copyFileSync(join(REPO_ROOT, file), join(folder, file));
  }
  return folder;
}

/** Removes every folder `temporaryFolder` made in this suite. */
export function removeTemporaryFolders(): void {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
}
