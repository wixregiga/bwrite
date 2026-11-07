import { describe, expect, it } from "vitest";
import { EditorState, type Transaction, type TransactionSpec } from "@codemirror/state";
import { history, redo, undo } from "@codemirror/commands";
import { insertTermTransaction, termInsertionMatch } from "./term-insertion";
import { domainReferences, referencesOf } from "./domain-references";
import { termIdFor } from "../domain/term-id";
import { projectPathOf } from "../domain/project-path";
import { SEED_IDS, createSeedWorkspace } from "../application/seed";
import { languageOf } from "../application/workspace";
import { REPO_ROOT, arclintDocument } from "../../../../tests/support/unit/arclint-listing";
import { ARCLINT_FILE, accepted, language, proposed } from "../../../../tests/support/unit/language-builders";
import { withVocabulary } from "../../../../tests/support/unit/workspace-builders";

const terms = language(
  accepted("domain-term", "Domain Term"), accepted("domain-service", "Domain Service"),
  proposed("domain-term-status", "Domain Term Status"), accepted("domain-terms", "Domain Terms"),
  accepted("term", "Term"), accepted("unicode", "客户"), accepted("punctuation", "C++ Policy"),
).terms;

function atEnd(text: string) { return termInsertionMatch(text, text.length, terms); }

describe("left-of-cursor domain term matching", () => {
  it.each(["", "\n", "Given ", "Domain Term\n  "])("lists the whole language after whitespace: %j", (text) => {
    const match = atEnd(text);
    expect(match.from).toBe(text.length);
    expect(match.query).toBe("");
    expect(match.terms).toHaveLength(terms.length);
    expect(match.terms.at(-1)?.status).toBe("proposed");
  });
  it.each([
    ["Domain Te", "Domain Te", 0], ["Given Dom", "Dom", 6], ["Given DOMAIN   te", "DOMAIN   te", 6],
    ["Domain\nTe", "Te", 7], ["(Domain Te", "Domain Te", 1], ["x,Dom", "Dom", 2],
    ["客户", "客户", 0], ["Given C++ Po", "C++ Po", 6], ["😀Dom", "Dom", 2],
  ])("finds a same-line word boundary in %j", (text, query, from) => {
    expect(atEnd(text)).toMatchObject({ query, from, to: text.length });
    expect(atEnd(text).terms.length).toBeGreaterThan(0);
  });
  it("matches Greek sigma consistently when its typed prefix ends a word", () => {
    const terms = language(accepted("greek", "ΟΣΟ"), accepted("exact", "ΟΣ")).terms;
    const match = termInsertionMatch("Given ΟΣ", 8, terms);
    expect(match.terms.map((t) => t.name)).toEqual(["ΟΣ", "ΟΣΟ"]);
  });
  it("uses the longest matching run instead of the last word", () => {
    const match = atEnd("Given Domain Te");
    expect(match.query).toBe("Domain Te");
    expect(match.terms.map((t) => t.name)).toEqual(["Domain Term", "Domain Terms", "Domain Term Status"]);
  });
  it.each(["Given xyz", "Given myDom", "xyz\nxyz"])("reports the actual unmatched word: %j", (text) => {
    const match = atEnd(text);
    expect(match.terms).toEqual([]);
    expect(match.query).toBe(text.match(/\w+$/)![0]);
  });
  it("lists terms at punctuation with no word immediately left", () => {
    expect(atEnd("Given (").terms).toHaveLength(terms.length);
  });
  it("reads only text to the left of the cursor", () => {
    const text = "Given Dom suffix";
    expect(termInsertionMatch(text, 9, terms)).toMatchObject({ from: 6, to: 9, query: "Dom" });
  });
  it("ranks exact names before longer prefixes, accepted before proposed, then alphabetically", () => {
    const candidates = language(proposed("exact", "Domain"), accepted("z", "Domain Z"), accepted("a", "Domain A")).terms;
    expect(termInsertionMatch("domain", 6, candidates).terms.map((t) => t.name)).toEqual(["Domain", "Domain A", "Domain Z"]);
  });
  it("matches this repository's recorded domain, as the seed project reads it", () => {
    const ws = withVocabulary(createSeedWorkspace(projectPathOf(REPO_ROOT)), SEED_IDS.project, ARCLINT_FILE, arclintDocument());
    const recorded = languageOf(ws, SEED_IDS.project).terms;
    const match = termInsertionMatch("Given DomainTe", 14, recorded);
    expect(match).toMatchObject({ from: 6, query: "DomainTe" });
    expect(match.terms.map((t) => t.id)).toEqual([termIdFor("authoring", "DomainTerm")]);
    expect(termInsertionMatch("Given Project", 13, recorded).terms.map((t) => t.name)).toEqual(["Project", "ProjectId", "ProjectPath"]);
  });
});

describe("inserting a domain term", () => {
  it.each(["", "Given Domain Te", "Given domain   te"])("creates text and a names reference as one undo step: %j", (doc) => {
    const term = terms.find((t) => t.name === "Domain Term")!;
    let state = EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [
      history(), domainReferences({ references: [], targets: new Map(terms.map((t) => [t.id, new Set<string>()])), ruleRefusal: () => null }),
    ] });
    const harness = { get state() { return state; }, dispatch(spec: TransactionSpec | Transaction) {
      state = ("startState" in spec ? spec : state.update(spec)).state;
    } };
    // Typing is a separate step, exactly as in the real editor.
    harness.dispatch({ changes: { from: doc.length, insert: "m" }, selection: { anchor: doc.length + 1 }, userEvent: "input.type" });
    const before = state.doc.toString();
    const match = termInsertionMatch(before, before.length, terms);
    harness.dispatch(insertTermTransaction(state, match, term));
    expect(state.doc.toString()).toBe(before.slice(0, match.from) + "Domain Term");
    expect(referencesOf(state)).toEqual([{ from: match.from, to: match.from + 11, termId: term.id, reading: { kind: "names" } }]);
    expect(state.selection.main.empty).toBe(true);
    expect(undo(harness)).toBe(true);
    expect(state.doc.toString()).toBe(before);
    expect(referencesOf(state)).toEqual([]);
    expect(redo(harness)).toBe(true);
    expect(referencesOf(state)[0]?.termId).toBe(term.id);
  });
  it("creates a names reference for a proposed term too", () => {
    const term = terms.find((t) => t.status === "proposed")!;
    const state = EditorState.create({ extensions: [domainReferences({
      references: [], targets: new Map([[term.id, new Set<string>()]]), ruleRefusal: () => null,
    })] });
    const next = state.update(insertTermTransaction(state, atEnd(""), term)).state;
    expect(referencesOf(next)[0]).toMatchObject({ termId: term.id, reading: { kind: "names" } });
  });
});
