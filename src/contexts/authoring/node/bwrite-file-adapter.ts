// BWrite's own format: ubiquitous-language.bwrite.yaml, the canonical VocabularyDocument
// written as YAML in its documented field order. BWrite reads and writes it itself, keeps
// proposed and unplaced terms in it, and keeps the comments an author wrote on the parts of
// the file a change leaves alone.

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PlannedStep, VocabularyChange, VocabularyDocument } from "../application/vocabulary-document";
import { refuse } from "../application/problem";
import { checkDocument, ShapeError, termKeyOf, sameKey } from "../application/vocabulary-shape";
import type { LoadedFile, VocabularyFileAdapter } from "../application/vocabulary-file-adapter";
import { applyChange, changedFields, cloneDocument, describeKey, describeTerm } from "../application/change-set";
import { BWRITE_FILE, newBWriteFile, parseBWriteFile, type BWriteFileText } from "../formats/bwrite-file";
import { writeAtomically } from "../../../../server/shared/atomic-write";

function describeChange(document: VocabularyDocument, change: VocabularyChange): string {
  if (change.type === "remove-term") {
    const index = document.terms.findIndex((t) => sameKey(termKeyOf(t, document), change.term));
    const term = document.terms[index];
    const takes =
      term.kind === "bounded_context"
        ? ", with everything recorded in it, its questions, and the relations that name it"
        : term.kind === "aggregate"
          ? ", with its Entities"
          : "";
    return `Remove ${describeTerm(term, document)}${takes}.`;
  }
  const key = change.replaces ?? termKeyOf(change.term, document);
  const index = document.terms.findIndex((t) => sameKey(termKeyOf(t, document), key));
  if (index < 0) return `Add ${describeTerm(change.term, document)}.`;
  const before = document.terms[index];
  if (before.kind !== change.term.kind) {
    return `Replace ${describeTerm(before, document)} with ${describeTerm(change.term, document)}${before.kind === "bounded_context" ? ", removing everything recorded in it" : before.kind === "aggregate" ? ", removing its Entities" : ""}.`;
  }
  const fields = changedFields(before, { ...change.term, status: change.term.status === "accepted" ? undefined : change.term.status });
  if (fields.length === 0) return `Leave ${describeTerm(before, document)} unchanged.`;
  if (fields.includes("name") || fields.includes("context")) {
    return `Rename ${describeTerm(before, document)} to ${describeKey(termKeyOf(change.term, document))}, carrying references to it along${fields.length > 1 ? `; change ${fields.filter((f) => f !== "name" && f !== "context").join(", ") || "nothing else"}` : ""}.`;
  }
  return `Change the ${fields.join(", ")} of ${describeTerm(before, document)}.`;
}

export class BWriteFileAdapter implements VocabularyFileAdapter {
  readonly format = "bwrite" as const;
  readonly folder: string;
  readonly watchedFile: string;

  constructor(folder: string) {
    this.folder = folder;
    this.watchedFile = path.join(folder, BWRITE_FILE);
  }

  private source(found: boolean) {
    return { format: this.format, file: BWRITE_FILE, found, holdsProposals: true, holdsUnplacedTerms: true };
  }

  private async read(): Promise<BWriteFileText | null> {
    let text: string;
    try {
      text = await readFile(this.watchedFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    return parseBWriteFile(text);
  }

  async load(): Promise<LoadedFile> {
    const read = await this.read();
    return { source: this.source(read !== null), document: read?.document ?? null };
  }

  /** The document after the changes, refused when a change names no term or leaves the file invalid. */
  private simulate(document: VocabularyDocument, changes: readonly VocabularyChange[]): { next: VocabularyDocument; steps: PlannedStep[] } {
    const next = cloneDocument(document);
    const steps: PlannedStep[] = [];
    changes.forEach((change, i) => {
      if (change.type === "remove-term" || change.replaces) {
        const key = change.type === "remove-term" ? change.term : change.replaces!;
        if (!next.terms.some((t) => sameKey(termKeyOf(t, next), key))) {
          throw refuse("invalid-request", `changes[${i}]: there is no term ${describeKey(key)} in ${BWRITE_FILE}.`);
        }
      }
      steps.push({ description: describeChange(next, change) });
      applyChange(next, change);
    });
    try {
      checkDocument(next);
    } catch (error) {
      if (error instanceof ShapeError) throw refuse("invalid-request", `The changes would leave ${BWRITE_FILE} invalid: ${error.message}`);
      throw error;
    }
    steps.push({ description: `Write ${BWRITE_FILE}.` });
    return { next, steps };
  }

  private async existing(): Promise<BWriteFileText> {
    const read = await this.read();
    if (read === null) throw refuse("invalid-request", `${this.folder} has no ${BWRITE_FILE} yet; create it first.`);
    return read;
  }

  async plan(changes: readonly VocabularyChange[]): Promise<PlannedStep[]> {
    const { document } = await this.existing();
    return this.simulate(document, changes).steps;
  }

  async apply(changes: readonly VocabularyChange[]): Promise<LoadedFile> {
    const file = await this.existing();
    const { next } = this.simulate(file.document, changes);
    await writeAtomically(this.watchedFile, file.rewrite(next));
    return this.load();
  }

  async create(): Promise<LoadedFile> {
    const current = await this.load();
    if (current.source.found) return current;
    await writeAtomically(this.watchedFile, newBWriteFile(path.basename(this.folder)));
    return this.load();
  }

  async rules() {
    return [];
  }
}
