// BWrite's own format: ubiquitous-language.bwrite.yaml, the canonical VocabularyDocument
// written as YAML in its documented field order. Parsing keeps the file's YAML nodes, so a
// rewrite keeps the comments an author wrote on the parts of the file a change leaves alone.

import { Document, isMap, isSeq, parseDocument, Scalar, YAMLMap, YAMLSeq, type Node } from "yaml";
import type { VocabularyDocument, VocabularyTerm } from "../application/vocabulary-document";
import { refuse } from "../application/problem";
import { readDocument, ShapeError, termKeyOf, sameKey } from "../application/vocabulary-shape";

export const BWRITE_FILE = "ubiquitous-language.bwrite.yaml";

const DOCUMENT_ORDER = ["version", "project", "description", "terms", "questions", "relations"] as const;
const TERM_ORDER = ["name", "kind", "status", "context", "aggregate", "identity", "raisedBy", "aliases", "definition", "invariants", "assertions", "proposal"] as const;
/** Fields written on one line, as the documented layout shows them. */
const FLOW_FIELDS: readonly string[] = ["aliases", "proposal"];

const STRINGIFY = { lineWidth: 0, indentSeq: true } as const;

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function nodeValue(node: unknown): unknown {
  return node && typeof node === "object" && "toJSON" in node ? (node as { toJSON(): unknown }).toJSON() : node;
}

function sortPairs(map: YAMLMap, order: readonly string[]): void {
  const rank = (pair: { key: unknown }) => {
    const key = pair.key instanceof Scalar ? pair.key.value : pair.key;
    const at = order.indexOf(String(key));
    return at < 0 ? order.length : at;
  };
  map.items.sort((a, b) => rank(a) - rank(b));
}

/** Writes `value` into `map` under `key`, keeping the node, and its comments, when unchanged. */
function setField(doc: Document, map: YAMLMap, key: string, value: unknown): void {
  if (value === undefined) {
    map.delete(key);
    return;
  }
  if (map.has(key) && same(nodeValue(map.get(key, true)), value)) return;
  const node = doc.createNode(value) as Node;
  if (FLOW_FIELDS.includes(key) && (isSeq(node) || isMap(node))) node.flow = true;
  map.set(key, node);
}

function termNode(doc: Document, term: VocabularyTerm, existing: YAMLMap | undefined): YAMLMap {
  const map = existing ?? new YAMLMap();
  for (const field of TERM_ORDER) setField(doc, map, field, term[field]);
  for (const pair of [...map.items]) {
    const key = pair.key instanceof Scalar ? String(pair.key.value) : String(pair.key);
    if (!(TERM_ORDER as readonly string[]).includes(key)) map.delete(key);
  }
  sortPairs(map, TERM_ORDER);
  return map;
}

/** Updates the parsed file to hold `next`, reusing the nodes of terms that keep their key. */
function updateDocument(doc: Document, previous: VocabularyDocument, next: VocabularyDocument): void {
  if (!isMap(doc.contents)) doc.contents = new YAMLMap() as typeof doc.contents;
  const root = doc.contents as YAMLMap;
  setField(doc, root, "version", next.version);
  setField(doc, root, "project", next.project);
  setField(doc, root, "description", next.description);

  const oldTerms = root.get("terms", true);
  const oldNodes = isSeq(oldTerms) ? (oldTerms.items as unknown[]) : [];
  const terms = isSeq(oldTerms) ? oldTerms : new YAMLSeq();
  terms.items = next.terms.map((term) => {
    const key = termKeyOf(term, next);
    const was = previous.terms.findIndex((old) => sameKey(termKeyOf(old, previous), key) && old.kind === term.kind);
    const node = was >= 0 ? oldNodes[was] : undefined;
    return termNode(doc, term, isMap(node) ? node : undefined);
  });
  root.set("terms", terms);

  setField(doc, root, "questions", next.questions && next.questions.length > 0 ? next.questions : undefined);
  setField(doc, root, "relations", next.relations && next.relations.length > 0 ? next.relations : undefined);
  sortPairs(root, DOCUMENT_ORDER);
}

/** One read of BWrite's file: its document, and the text that writes a changed document over it. */
export interface BWriteFileText {
  readonly document: VocabularyDocument;
  /** The file's text holding `next`, keeping the nodes, and comments, of what `next` leaves alone. */
  rewrite(next: VocabularyDocument): string;
}

/** Reads BWrite's file text; refuses text that is not YAML or not a valid VocabularyDocument. */
export function parseBWriteFile(text: string): BWriteFileText {
  const doc = parseDocument(text, { uniqueKeys: true, prettyErrors: true });
  if (doc.errors.length > 0) throw refuse("file-invalid", `${BWRITE_FILE}: ${doc.errors[0].message}`);
  let document: VocabularyDocument;
  try {
    document = readDocument(doc.toJS());
  } catch (error) {
    if (error instanceof ShapeError) throw refuse("file-invalid", `${BWRITE_FILE}: ${error.message}`);
    throw error;
  }
  return {
    document,
    rewrite(next) {
      updateDocument(doc, document, next);
      return doc.toString(STRINGIFY);
    },
  };
}

/** The text of a new BWrite file holding a language with no terms, named `project`. */
export function newBWriteFile(project: string): string {
  const empty: VocabularyDocument = { version: 1, project, terms: [] };
  const doc = new Document();
  updateDocument(doc, empty, empty);
  return doc.toString(STRINGIFY);
}
