// Which VocabularyFile a folder uses. A folder arclint is set up for, where arclint finds a
// rules.arclint.yaml in the folder or one of its parents, uses arclint's domain.arclint.yaml
// beside that rules file; any other folder uses BWrite's own file. Detection reads the file
// system only, so a folder set up for arclint where arclint is not installed is still
// recognized, and its operations answer arclint-missing.

import { stat } from "node:fs/promises";
import path from "node:path";
import type { VocabularyFileAdapter } from "../application/vocabulary-file-adapter";
import { ARCLINT_RULES_FILE, ArclintFileAdapter, type ArclintOptions } from "./arclint-file-adapter";
import { BWriteFileAdapter } from "./bwrite-file-adapter";

/** The folder holding the rules.arclint.yaml arclint resolves for `folder`, searching upward as arclint does. */
export async function findRulesFolder(folder: string): Promise<string | null> {
  let current = path.resolve(folder);
  for (;;) {
    try {
      if ((await stat(path.join(current, ARCLINT_RULES_FILE))).isFile()) return current;
    } catch {
      // Not here; look in the parent.
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function adapterFor(folder: string, options: ArclintOptions = {}): Promise<VocabularyFileAdapter> {
  const rulesFolder = await findRulesFolder(folder);
  return rulesFolder === null ? new BWriteFileAdapter(folder) : new ArclintFileAdapter(folder, rulesFolder, options);
}
