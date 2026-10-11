import { describe, expect, it } from "vitest";
import { Project } from "../domain/project";
import { projectIdOf } from "../domain/project-id";
import { Feature } from "../domain/feature";
import { featureIdOf } from "../domain/feature-id";
import { termIdFor } from "../domain/term-id";
import { projectPathOf } from "../domain/project-path";
import { searchWorkspace } from "./search";
import { createSeedWorkspace, SEED_IDS } from "./seed";
import type { Workspace } from "./workspace";
import type { VocabularyDocument } from "./vocabulary-document";
import { REPO_ROOT, arclintDocument } from "../../../../tests/support/unit/arclint-listing";
import { ARCLINT_FILE, BWRITE_FILE } from "../../../../tests/support/unit/language-builders";
import { withVocabulary } from "../../../../tests/support/unit/workspace-builders";

const A = projectIdOf("a");
const B = projectIdOf("b");
const INVOICE = termIdFor(undefined, "Invoice");

/** Project a's language, as BWrite's own file holds it. */
const A_DOCUMENT: VocabularyDocument = {
  version: 1,
  project: "domain-authoring",
  terms: [
    {
      name: "Invoice",
      kind: "aggregate",
      definition: "A billing record",
      assertions: [{ key: "records-payment", statement: "Payment requires an invoice", on: "RecordPayment" }],
    },
    {
      name: "Draft Invoice",
      definition: "Unsent invoice with a customer",
      status: "proposed",
      proposal: { feature: "Invoice recording", featureId: "a-title", text: "draft invoice", proposedAt: "2026-10-09T10:00:00.000Z" },
    },
  ],
};

function workspace(): Workspace {
  const a = new Project({ id: A, name: "Domain authoring", description: "Track releases", goals: ["Keep shared language consistent"], path: projectPathOf("/srv/domain-authoring") });
  const b = new Project({ id: B, name: "Billing", description: "Customer accounts", goals: ["Avoid duplicated invoices"], path: projectPathOf("/srv/billing") });
  const ws: Workspace = { projects: [a, b], activeProjectId: a.id, openFeatureIds: {}, localProposals: {}, vocabularies: {}, features: [
    new Feature({ id: featureIdOf("a-title"), projectId: a.id, title: "Invoice recording", body: "Other text", references: [] }),
    new Feature({ id: featureIdOf("b-title"), projectId: b.id, title: "Invoice submission", body: "Other text", references: [] }),
    new Feature({ id: featureIdOf("a-inner"), projectId: a.id, title: "Submit invoice", body: "Other text", references: [] }),
    new Feature({ id: featureIdOf("a-body"), projectId: a.id, title: "Record charges", body: "Invoice needs a customer", references: [] }),
    new Feature({ id: featureIdOf("b-body"), projectId: b.id, title: "Cash operations", body: "Header\nGiven an invoice\nThen the   account\t is reconciled\nAnd C++ [x].* costs $5", references: [] }),
  ] };
  return withVocabulary(
    withVocabulary(ws, A, BWRITE_FILE, A_DOCUMENT),
    B,
    BWRITE_FILE,
    { version: 1, project: "billing", terms: [{ name: "Account", definition: "The customer owes the invoice amount" }] },
  );
}
const group = (ws: Workspace, query: string, category: string) => searchWorkspace(ws, query).find((g) => g.category === category)!;

describe("workspace search", () => {
  it.each(["", " ", "\n\t"])("handles an empty query without arbitrary suggestions: %j", (query) => {
    expect(searchWorkspace(workspace(), query).every((g) => g.results.length === 0 && g.more === 0)).toBe(true);
  });
  it("searches all projects, accepted and proposed terms, and placed rules", () => {
    const groups = searchWorkspace(workspace(), "invoice");
    expect(groups.find((g) => g.category === "features")!.results).toHaveLength(5);
    const terms = groups.find((g) => g.category === "terms")!.results;
    expect(terms.map((t) => t.label)).toEqual(["Invoice", "Draft Invoice", "Account"]);
    expect(terms.find((t) => t.label === "Draft Invoice")).toMatchObject({ proposed: true });
    expect(new Set(terms.map((t) => t.projectId)).size).toBe(2);
    expect(groups.find((g) => g.category === "rules")!.results[0]).toMatchObject({ termId: INVOICE, ruleKey: "records-payment" });
  });
  it("ranks title before body, prefix before inner, then active project", () => {
    expect(group(workspace(), "invoice", "features").results.map((r) => r.label)).toEqual([
      "Invoice recording", "Invoice submission", "Submit invoice", "Record charges", "Cash operations",
    ]);
    const ws = { ...workspace(), activeProjectId: projectIdOf("b") };
    expect(group(ws, "invoice", "features").results[0].label).toBe("Invoice submission");
  });
  it("searches project description and individual goals", () => {
    expect(group(workspace(), "shared LANGUAGE", "projects").results[0].label).toBe("Domain authoring");
    expect(group(workspace(), "customer", "projects").results[0].label).toBe("Billing");
    expect(group(workspace(), "duplicated", "projects").results[0].label).toBe("Billing");
  });
  it("ranks rule statement and operation matches by prefix without treating either as a name", () => {
    const ws = withVocabulary(workspace(), A, BWRITE_FILE, {
      version: 1,
      project: "domain-authoring",
      terms: [{ name: "Root", kind: "aggregate", definition: "The root.", assertions: [{ key: "record", statement: "Record an invoice", on: "AuthorizeRecord" }] }],
    });
    const result = group(ws, "record", "rules").results[0];
    expect(result.snippet).toBe("Record an invoice");
    expect(result).toMatchObject({ primary: false, prefix: true });
  });
  it("searches rule operations and carries the owning term", () => {
    expect(group(workspace(), "recordpayment", "rules").results[0]).toMatchObject({ termId: INVOICE, projectId: "a" });
  });
  it("normalizes whitespace and casing while retaining exact feature cursor offsets", () => {
    const ws = workspace();
    const result = group(ws, "ACCOUNT   IS", "features").results[0];
    expect(result.category).toBe("features");
    if (result.category !== "features") throw new Error("Expected a feature");
    const body = ws.features.find((f) => f.id === result.featureId)!.body;
    expect(body.slice(result.from, result.to)).toBe("account\t is");
    expect(result.snippet.slice(result.highlight.from, result.highlight.to)).toBe("account\t is");
    expect(group(ws, "invoice then", "features").results[0]).toMatchObject({ field: "body" });
  });
  it.each(["C++", "[x].*", "$5"])("matches punctuation literally: %s", (query) => {
    const result = group(workspace(), query, "features").results[0];
    expect(result.label).toBe("Cash operations");
    expect(result.snippet.slice(result.highlight.from, result.highlight.to)).toBe(query);
  });
  it("caps every category with an accurate remaining count", () => {
    const ws = workspace();
    const result = searchWorkspace(ws, "invoice", 2);
    expect(result.find((g) => g.category === "features")).toMatchObject({ more: 3 });
    expect(result.find((g) => g.category === "terms")).toMatchObject({ more: 1 });
    expect(result.every((g) => g.results.length <= 2)).toBe(true);
    expect(() => searchWorkspace(ws, "x", 0)).toThrow(RangeError);
  });
  it("searches the application's real authoring workspace, with this repository's recorded domain", () => {
    const ws = withVocabulary(createSeedWorkspace(projectPathOf(REPO_ROOT)), SEED_IDS.project, ARCLINT_FILE, arclintDocument());
    const terms = searchWorkspace(ws, "DomainTerm").find((g) => g.category === "terms")!.results;
    expect(terms[0]).toMatchObject({ label: "DomainTerm", termId: termIdFor("authoring", "DomainTerm"), primary: true, proposed: false });
    const groups = searchWorkspace(ws, "Domain Term");
    expect(groups.find((g) => g.category === "features")!.results[0]).toMatchObject({ field: "body", featureId: SEED_IDS.feature });
    expect(searchWorkspace(ws, "never ties the same piece").find((g) => g.category === "rules")!.results[0]).toMatchObject({
      termId: termIdFor("authoring", "Feature"),
      ruleKey: "references-never-overlap",
    });
  });
  it("uses a body occurrence as the cursor destination even when the title ranks first", () => {
    const ws = workspace();
    const feature = ws.features[0];
    const edited = feature.edit("Given an invoice is recorded", []);
    if (!edited.ok) throw edited.error;
    const result = group({ ...ws, features: [edited.value] }, "invoice", "features").results[0];
    expect(result).toMatchObject({ field: "title", from: 9, to: 16 });
  });
  it("retains Unicode and long-snippet match offsets", () => {
    const ws = workspace();
    const source = ws.features[0];
    const text = "😀 ".repeat(100) + "客户 İNVOICE " + "more ".repeat(100);
    const edited = source.edit(text, []);
    if (!edited.ok) throw edited.error;
    const result = group({ ...ws, features: [edited.value] }, "客户 i̇nvoice", "features").results[0];
    expect(result).toMatchObject({ field: "body", from: 300, to: 310 });
    expect(result.snippet.slice(result.highlight.from, result.highlight.to)).toBe("客户 İNVOICE");
  });
  it("matches Greek sigma independently of contextual lowercase spelling", () => {
    const ws = workspace();
    const edited = ws.features[0].edit("ΟΣ", []);
    if (!edited.ok) throw edited.error;
    const result = group({ ...ws, features: [edited.value] }, "οσ", "features").results[0];
    expect(result.snippet.slice(result.highlight.from, result.highlight.to)).toBe("ΟΣ");
  });
  it("returns no results for unmatched text", () => {
    expect(searchWorkspace(workspace(), "xyz").every((g) => !g.results.length)).toBe(true);
  });
});
