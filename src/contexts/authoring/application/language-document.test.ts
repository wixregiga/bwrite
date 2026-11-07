import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { classificationOf, relationOf } from "../domain/classification";
import { type TermKind } from "../domain/term-kind";
import { termIdFor, type TermId } from "../domain/term-id";
import { termProposalOf } from "../domain/term-proposal";
import type { FeatureId } from "../domain/feature-id";
import { RefusalError } from "../domain/refusal";
import { findTermMatches } from "../domain/terms";
import { SEED_GHERKIN, SEED_IDS, createSeedWorkspace } from "./seed";
import type { VocabularyDocument, VocabularyTerm } from "./vocabulary-document";
import { buildLanguage, languageEdit, type BuiltLanguage } from "./language-document";
import { REPO_ROOT, arclintDocument, arclintDomainList, runArclint } from "../../../../tests/support/unit/arclint-listing";
import { refusalOf, unwrap } from "../../../../tests/support/unit/command-results";
import { ARCLINT_FILE, BWRITE_FILE, PROJECT, invariant } from "../../../../tests/support/unit/language-builders";
import { removeTemporaryFolders, temporaryFolder } from "../../../../tests/support/unit/temporary-folders";

/** This repository's own recorded domain, read through arclint. */
const REAL = arclintDocument();
const SEED = createSeedWorkspace(REPO_ROOT as never);
const title = (featureId: FeatureId) => SEED.features.find((f) => f.id === featureId)?.title ?? null;
const SEED_TITLE = "Inspect domain vocabulary while authoring";
const AT = new Date("2026-10-10T12:00:00.000Z");

afterAll(removeTemporaryFolders);
const arclintCopy = () => temporaryFolder({ withRepositoryDomain: true });
const arclint = runArclint;

const built = (document: VocabularyDocument | null = REAL, localProposals: readonly VocabularyTerm[] = []): BuiltLanguage =>
  buildLanguage(PROJECT, { file: ARCLINT_FILE, document, localProposals });

/** The document with `terms` added, as a file holding them would be read. */
const withTerms = (document: VocabularyDocument, ...terms: VocabularyTerm[]): VocabularyDocument => ({
  ...document,
  terms: [...document.terms, ...terms],
});

const AUTHORING = termIdFor(undefined, "authoring");
const DOMAIN_TERM = termIdFor("authoring", "DomainTerm");

describe("building this repository's recorded domain", () => {
  const list = arclintDomainList();
  const language = built().language;

  it("gives every term arclint lists the kind of the collection arclint lists it in, all accepted", () => {
    const expected: [string, TermKind][] = (list.contexts ?? []).flatMap((c) => [
      [c.name, "bounded_context"] as [string, TermKind],
      ...(c.aggregates ?? []).flatMap((a) => [
        [a.name, "aggregate"] as [string, TermKind],
        ...(a.entities ?? []).map((e): [string, TermKind] => [e.name, "entity"]),
      ]),
      ...(c.valueObjects ?? []).map((v): [string, TermKind] => [v.name, "value_object"]),
      ...(c.events ?? []).map((e): [string, TermKind] => [e.name, "domain_event"]),
      ...(c.services ?? []).map((s): [string, TermKind] => [s.name, "domain_service"]),
      ...(c.specifications ?? []).map((s): [string, TermKind] => [s.name, "specification"]),
    ]);
    expect(expected.length).toBeGreaterThan(10);
    const actual = language.terms.map((t): [string, TermKind | undefined] => [t.name, t.classification?.kind]);
    const byName = (a: [string, unknown], b: [string, unknown]) => a[0].localeCompare(b[0]);
    expect([...actual].sort(byName)).toEqual([...expected].sort(byName));
    expect(language.terms.every((t) => t.status === "accepted" && t.proposal === null)).toBe(true);
    expect(language.acceptedTerms()).toHaveLength(expected.length);
  });

  it("places every term in its bounded context, so every relation arclint records is tied to a term", () => {
    for (const term of language.terms) {
      const c = term.classification!;
      if (c.kind === "bounded_context") continue;
      expect(language.contextOf(c)?.id, term.name).toBe(AUTHORING);
      expect(term.id, term.name).toBe(termIdFor("authoring", term.name));
    }
  });

  it("makes DomainTerm an Entity of the UbiquitousLanguage Aggregate in authoring, with its aliases", () => {
    const term = language.term(DOMAIN_TERM)!;
    expect(DOMAIN_TERM).toBe("term:authoring/domainterm");
    expect(term.name).toBe("DomainTerm");
    expect(term.aliases).toEqual(["Domain Term", "Term"]);
    expect(term.classification?.kind).toBe("entity");
    expect(language.related(term.classification!, "aggregate")?.name).toBe("UbiquitousLanguage");
    expect(language.related(term.classification!, "identity")?.name).toBe("TermId");
    expect(language.contextOf(term.classification)?.name).toBe("authoring");
    expect(language.qualifiedName(DOMAIN_TERM).text).toBe("authoring.UbiquitousLanguage.DomainTerm");
  });

  it("resolves each Aggregate's identity to the recorded Value Object", () => {
    const identity = (name: string) => {
      const c = language.term(termIdFor("authoring", name))!.classification!;
      return language.related(c, "identity")?.name;
    };
    expect(identity("Feature")).toBe("FeatureId");
    expect(identity("Project")).toBe("ProjectId");
    expect(identity("UbiquitousLanguage")).toBe("ProjectId");
    const identityTerm = language.term(termIdFor("authoring", "FeatureId"))!;
    expect(identityTerm.classification?.kind).toBe("value_object");
  });

  it("keeps arclint's invariants and assertions as the terms' PlacedRules", () => {
    const ul = language.term(termIdFor("authoring", "UbiquitousLanguage"))!;
    const recorded = list.contexts![0]!.aggregates!.find((a) => a.name === "UbiquitousLanguage")!;
    expect(ul.rules.filter((r) => r.kind === "invariant").map((r) => r.key)).toEqual(recorded.invariants!.map((r) => r.key));
    expect(ul.rules.filter((r) => r.kind === "assertion").map((r) => [r.key, r.operation])).toEqual(
      recorded.assertions!.map((r) => [r.key, r.on]),
    );
  });

  it("recognizes the seed feature's “Domain Term” as DomainTerm, through its alias", () => {
    const matches = findTermMatches(SEED_GHERKIN, language.acceptedTerms());
    const domainTerm = matches.filter((m) => SEED_GHERKIN.slice(m.from, m.to) === "Domain Term");
    expect(domainTerm).toHaveLength(3);
    expect(domainTerm.every((m) => m.termId === DOMAIN_TERM)).toBe(true);
    const feature = matches.find((m) => SEED_GHERKIN.slice(m.from, m.to) === "Feature");
    expect(feature?.termId).toBe(termIdFor("authoring", "Feature"));
  });

  it("leaves a phrase two bounded contexts both name unrecognized, recognizing the rest", () => {
    const ambiguous = withTerms(
      REAL,
      { name: "publishing", kind: "bounded_context", definition: "Sharing finished Features." },
      { name: "Glossary Entry", kind: "value_object", context: "publishing", aliases: ["Domain Term"], definition: "A published term." },
    );
    const language = built(ambiguous).language;
    const matches = findTermMatches(SEED_GHERKIN, language.acceptedTerms());
    expect(matches.filter((m) => SEED_GHERKIN.slice(m.from, m.to) === "Domain Term")).toEqual([]);
    expect(matches.some((m) => m.termId === termIdFor("authoring", "Feature"))).toBe(true);
  });

  it("keeps names unique per bounded context: the same name in two contexts builds, twice in one is refused", () => {
    const twoContexts = withTerms(
      REAL,
      { name: "publishing", kind: "bounded_context", definition: "Sharing finished Features." },
      { name: "Feature", kind: "value_object", context: "publishing", definition: "A Feature as published." },
    );
    const language = built(twoContexts).language;
    expect(language.term(termIdFor("authoring", "Feature"))?.classification?.kind).toBe("aggregate");
    expect(language.term(termIdFor("publishing", "Feature"))?.classification?.kind).toBe("value_object");

    const twiceInOne = withTerms(REAL, { name: " feature ", kind: "value_object", context: "authoring", definition: "Again." });
    expect(() => built(twiceInOne)).toThrow(RefusalError);
    expect(() => built(twiceInOne)).toThrow("“Feature” and “ feature ” differ only in letter case or spacing.");
  });
});

describe("building every kind arclint records", () => {
  // The contract's example shop, recorded the way arclint records it, and read back through arclint.
  const folder = temporaryFolder();
  copyFileSync(join(REPO_ROOT, "rules.arclint.yaml"), join(folder, "rules.arclint.yaml"));
  writeFileSync(
    join(folder, "domain.arclint.yaml"),
    stringify({
      version: 1,
      project: "shop",
      contexts: {
        sales: {
          definition: "Taking and fulfilling orders.",
          aggregates: {
            Order: {
              definition: "A customer's request to buy products.",
              identity: "OrderId",
              aliases: ["Purchase Order"],
              invariants: { "has-lines": "An Order has at least one line." },
              assertions: { "place-requires-lines": { on: "Place", statement: "Placing an Order needs a line." } },
              entities: { OrderLine: { definition: "One product in an Order.", identity: "LineNumber" } },
            },
          },
          value_objects: { OrderId: { definition: "The identity of one Order." }, LineNumber: { definition: "A line's position." } },
          events: { OrderPlaced: { definition: "An Order was placed.", raised_by: "Order" } },
          services: {
            Pricing: {
              definition: "Prices an Order.",
              assertions: { "price-is-positive": { on: "Price", statement: "A price is never negative." } },
            },
          },
          specifications: { LargeOrder: { definition: "An Order over a hundred lines." } },
          questions: { "who-pays-shipping": "Who pays shipping on a return?" },
        },
        billing: { definition: "Getting paid." },
      },
      relations: [{ from: "sales", to: "billing", kind: "customer_supplier", description: "Orders become invoices." }],
    }),
  );
  const document = arclintDocument(folder);
  const language = built(document).language;
  const sales = (name: string) => language.term(termIdFor("sales", name))!;

  it("maps arclint's answer to the contract's document", () => {
    expect(document.project).toBe("shop");
    expect(document.questions).toEqual([{ context: "sales", key: "who-pays-shipping", text: "Who pays shipping on a return?" }]);
    expect(document.relations).toEqual([{ from: "sales", to: "billing", kind: "customer_supplier", description: "Orders become invoices." }]);
    expect(document.terms.find((t) => t.name === "OrderLine")).toEqual({
      name: "OrderLine",
      definition: "One product in an Order.",
      kind: "entity",
      aggregate: "Order",
      identity: "LineNumber",
    });
  });

  it("builds each kind with its relations tied to the terms arclint names", () => {
    expect(sales("Order").classification).toEqual(
      classificationOf("aggregate", { context: termIdFor(undefined, "sales"), identity: termIdFor("sales", "OrderId") }),
    );
    expect(sales("Order").aliases).toEqual(["Purchase Order"]);
    expect(sales("OrderLine").classification).toEqual(
      classificationOf("entity", { aggregate: termIdFor("sales", "Order"), identity: termIdFor("sales", "LineNumber") }),
    );
    expect(relationOf(sales("OrderPlaced").classification!, "raisedBy")).toBe(termIdFor("sales", "Order"));
    expect(sales("Pricing").classification?.kind).toBe("domain_service");
    expect(sales("Pricing").rules).toEqual([{ kind: "assertion", key: "price-is-positive", statement: "A price is never negative.", operation: "Price" }]);
    expect(sales("LargeOrder").classification?.kind).toBe("specification");
    expect(language.term(termIdFor(undefined, "billing"))?.classification?.kind).toBe("bounded_context");
  });

  it("states nothing to change for the language as read", () => {
    expect(languageEdit(built(document), built(document).language, title)).toEqual({ changes: [], localProposals: [], retargets: [] });
  });
});

describe("translating changes for arclint's file", () => {
  const proposal = termProposalOf(SEED_IDS.feature, "reading", AT);
  const READING = termIdFor(undefined, "Reading");
  const draft = { name: "Reading", definition: "How one occurrence of text is read.", classification: null };
  const proposedReading: VocabularyTerm = {
    name: "Reading",
    definition: "How one occurrence of text is read.",
    status: "proposed",
    proposal: { feature: SEED_TITLE, featureId: SEED_IDS.feature, text: "reading", proposedAt: AT.toISOString() },
  };

  it("states nothing to change for the language as read, relations included", () => {
    const b = built();
    expect(languageEdit(b, b.language, title)).toEqual({ changes: [], localProposals: [], retargets: [] });
  });

  it("keeps a proposal out of the file, as one of BWrite's own proposed terms", () => {
    const b = built();
    const after = unwrap(b.language.propose(draft, READING, proposal));
    expect(languageEdit(b, after, title)).toEqual({ changes: [], localProposals: [proposedReading], retargets: [] });
  });

  it("records a local proposal as one put-term, applied by arclint and read back at the retargeted id", () => {
    const b = built(REAL, [proposedReading]);
    expect(b.language.term(READING)?.status).toBe("proposed");
    const after = unwrap(b.language.record(READING, classificationOf("value_object", { context: AUTHORING })));
    const edit = languageEdit(b, after, title);
    expect(edit.changes).toEqual([
      {
        type: "put-term",
        term: { name: "Reading", definition: "How one occurrence of text is read.", kind: "value_object", context: "authoring" },
      },
    ]);
    expect(edit.localProposals).toEqual([]);
    expect(edit.retargets).toEqual([[READING, termIdFor("authoring", "Reading")]]);

    const folder = arclintCopy();
    arclint(folder, "domain", "define", "value_object", "Reading", "--context", "authoring", "--definition", "How one occurrence of text is read.");
    const readBack = buildLanguage(PROJECT, { file: ARCLINT_FILE, document: arclintDocument(folder), localProposals: edit.localProposals });
    const recorded = readBack.language.term(edit.retargets[0]![1])!;
    expect(recorded).toMatchObject({ name: "Reading", status: "accepted", proposal: null });
    expect(recorded.classification).toEqual(classificationOf("value_object", { context: AUTHORING }));
    expect(readBack.recorded.get(recorded.id)).toEqual((edit.changes[0] as { term: VocabularyTerm }).term);
  });

  it("refuses recording without a classification (recording-requires-a-classification)", () => {
    const b = built(REAL, [proposedReading]);
    expect(refusalOf(b.language.record(READING, null))).toBe("Classify the term before recording it in the vocabulary.");
  });

  it("refuses recording what arclint's file cannot keep", () => {
    const b = built(REAL, [proposedReading]);
    expect(refusalOf(b.language.record(READING, classificationOf("aggregate", { context: AUTHORING })))).toBe(
      "domain.arclint.yaml keeps an Aggregate only with its identity: a Value Object term from the same bounded context.",
    );
    expect(refusalOf(b.language.record(READING, classificationOf("value_object")))).toBe(
      "domain.arclint.yaml keeps a term only inside a bounded context. Choose its bounded context.",
    );
    expect(refusalOf(b.language.record(READING, classificationOf("entity")))).toBe(
      "domain.arclint.yaml keeps an Entity only inside its Aggregate. Choose the Aggregate.",
    );
    const identified = classificationOf("aggregate", { context: AUTHORING, identity: termIdFor("authoring", "TermId") });
    expect(b.language.record(READING, identified).ok).toBe(true);
  });

  it("states a placed rule as one put-term of that term, which is what arclint holds after defining it", () => {
    const b = built();
    const FEATURE = termIdFor("authoring", "Feature");
    const rule = invariant("title-is-one-line", "A Feature's title is one line.");
    const edit = languageEdit(b, unwrap(b.language.placeRule(FEATURE, rule)), title);
    expect(edit.retargets).toEqual([]);
    expect(edit.changes).toHaveLength(1);
    const change = edit.changes[0]!;
    expect(change).toMatchObject({ type: "put-term", term: { name: "Feature", kind: "aggregate", context: "authoring", identity: "FeatureId" } });
    expect("replaces" in change).toBe(false);
    expect(change.type === "put-term" && change.term.invariants?.map((r) => r.key)).toEqual(["references-never-overlap", "title-is-one-line"]);

    const folder = arclintCopy();
    arclint(folder, "domain", "define", "invariant", rule.key, "--owner", "Feature", "--statement", rule.statement);
    const readBack = built(arclintDocument(folder));
    expect(change.type === "put-term" && change.term).toEqual(readBack.recorded.get(FEATURE));
  });

  it("states a removed rule as one put-term of that term, which is what arclint holds after removing it", () => {
    const b = built();
    const FEATURE = termIdFor("authoring", "Feature");
    const edit = languageEdit(b, unwrap(b.language.removeRule(FEATURE, "references-never-overlap")), title);
    expect(edit.changes).toHaveLength(1);
    const change = edit.changes[0]!;
    expect(change.type === "put-term" && change.term.invariants).toBeUndefined();

    const folder = arclintCopy();
    arclint(folder, "domain", "remove", "invariant", "references-never-overlap", "--owner", "Feature");
    expect(change.type === "put-term" && change.term).toEqual(built(arclintDocument(folder)).recorded.get(FEATURE));
  });

  it("reclassifies an accepted term in its bounded context under the same id, naming the key it replaces", () => {
    const b = built();
    const QUALIFIED_NAME = termIdFor("authoring", "QualifiedName");
    const edit = languageEdit(b, unwrap(b.language.classify(QUALIFIED_NAME, classificationOf("specification", { context: AUTHORING }))), title);
    expect(edit.retargets).toEqual([]);
    expect(edit.changes).toEqual([
      {
        type: "put-term",
        term: { ...b.recorded.get(QUALIFIED_NAME)!, kind: "specification" },
        replaces: { name: "QualifiedName", context: "authoring" },
      },
    ]);
    expect(b.recorded.get(QUALIFIED_NAME)?.kind).toBe("value_object");
  });

  it("moves an accepted term to another bounded context under a new id, which the edit retargets", () => {
    const twoContexts = withTerms(REAL, { name: "publishing", kind: "bounded_context", definition: "Sharing finished Features." });
    const b = built(twoContexts);
    const QUALIFIED_NAME = termIdFor("authoring", "QualifiedName");
    const moved = classificationOf("value_object", { context: termIdFor(undefined, "publishing") });
    const edit = languageEdit(b, unwrap(b.language.classify(QUALIFIED_NAME, moved)), title);
    expect(edit.retargets).toEqual([[QUALIFIED_NAME, termIdFor("publishing", "QualifiedName")]]);
    expect(edit.changes).toEqual([
      {
        type: "put-term",
        term: { ...b.recorded.get(QUALIFIED_NAME)!, context: "publishing" },
        replaces: { name: "QualifiedName", context: "authoring" },
      },
    ]);
  });

  it("writes back a relation it could not tie to a term exactly as the file wrote it", () => {
    // FeatureId leaves the file, so Feature's identity names no term of the language.
    const b = built({ ...REAL, terms: REAL.terms.filter((t) => t.name !== "FeatureId") });
    const FEATURE = termIdFor("authoring", "Feature");
    expect(relationOf(b.language.term(FEATURE)!.classification!, "identity")).toBeNull();
    expect(languageEdit(b, b.language, title).changes).toEqual([]);
    const edit = languageEdit(b, unwrap(b.language.placeRule(FEATURE, invariant("has-a-title"))), title);
    expect(edit.changes).toHaveLength(1);
    expect(edit.changes[0]).toMatchObject({ type: "put-term", term: { name: "Feature", identity: "FeatureId" } });
  });
});

/** The YAML example of BWrite's own file, exactly as the contract's doc comment writes it. */
function contractExample(): string {
  const source = readFileSync(join(REPO_ROOT, "src/contexts/authoring/application/vocabulary-document.ts"), "utf8");
  const comment = source.slice(source.indexOf(" *   version: 1"), source.indexOf(" */\nexport interface VocabularyDocument"));
  const lines = comment.split("\n").filter((l) => l.startsWith(" *   "));
  expect(lines.length).toBeGreaterThan(10);
  return lines.map((l) => l.slice(" *   ".length)).join("\n") + "\n";
}

describe("translating changes for BWrite's own file", () => {
  const FILE = BWRITE_FILE.file;
  const folder = temporaryFolder();
  writeFileSync(join(folder, FILE), contractExample());
  const read = (): VocabularyDocument => parse(readFileSync(join(folder, FILE), "utf8")) as VocabularyDocument;
  const builtFromFile = () => buildLanguage(PROJECT, { file: BWRITE_FILE, document: read(), localProposals: [] });
  const GIFT_WRAP = termIdFor(undefined, "Gift Wrap");
  const RETURN_LABEL = termIdFor(undefined, "Return Label");
  const SALES = termIdFor(undefined, "Sales");

  it("reads proposed terms from the file itself, with their proposal", () => {
    const b = builtFromFile();
    expect(b.language.proposedTerms().map((t) => t.id)).toEqual([GIFT_WRAP]);
    expect(b.language.term(GIFT_WRAP)).toMatchObject({
      status: "proposed",
      classification: null,
      proposal: { featureId: "f-1", text: "gift wrap", proposedAt: "2026-10-10T12:00:00.000Z" },
    });
    expect(b.language.term(termIdFor("Sales", "Order"))?.aliases).toEqual(["Purchase Order"]);
    expect(languageEdit(b, b.language, title)).toEqual({ changes: [], localProposals: [], retargets: [] });
  });

  it("keeps the identity the file names but no term holds when the Aggregate changes", () => {
    const b = builtFromFile();
    const ORDER = termIdFor("Sales", "Order");
    expect(relationOf(b.language.term(ORDER)!.classification!, "identity")).toBeNull();
    const edit = languageEdit(b, unwrap(b.language.placeRule(ORDER, invariant("has-a-customer"))), title);
    expect(edit.changes).toHaveLength(1);
    expect(edit.changes[0]).toMatchObject({ type: "put-term", term: { name: "Order", identity: "OrderId", aliases: ["Purchase Order"] } });
  });

  it("states a proposal as a put-term the file keeps, proposed, with the feature's title", () => {
    const b = builtFromFile();
    const after = unwrap(
      b.language.propose(
        { name: "Return Label", definition: "The label a customer prints to send an item back.", classification: null },
        RETURN_LABEL,
        termProposalOf(SEED_IDS.feature, "return label", AT),
      ),
    );
    const edit = languageEdit(b, after, title);
    const term: VocabularyTerm = {
      name: "Return Label",
      definition: "The label a customer prints to send an item back.",
      status: "proposed",
      proposal: { feature: SEED_TITLE, featureId: SEED_IDS.feature, text: "return label", proposedAt: AT.toISOString() },
    };
    expect(edit).toEqual({ changes: [{ type: "put-term", term }], localProposals: [], retargets: [] });

    // BWrite writes a new term at the end of its file.
    writeFileSync(join(folder, FILE), stringify({ ...read(), terms: [...read().terms, term] }));
    const readBack = builtFromFile();
    expect(readBack.language.term(RETURN_LABEL)).toMatchObject({ name: "Return Label", status: "proposed" });
    expect(languageEdit(readBack, readBack.language, title).changes).toEqual([]);
  });

  it("records a proposed term as a put-term without status or proposal, keyed as it was", () => {
    const b = builtFromFile();
    const edit = languageEdit(b, unwrap(b.language.record(GIFT_WRAP, classificationOf("value_object", { context: SALES }))), title);
    expect(edit.changes).toEqual([
      {
        type: "put-term",
        term: { name: "Gift Wrap", definition: "Wrapping an item as a gift.", kind: "value_object", context: "Sales" },
        replaces: { name: "Gift Wrap" },
      },
    ]);
    expect(edit.retargets).toEqual([[GIFT_WRAP, termIdFor("Sales", "Gift Wrap")]]);
    expect(edit.localProposals).toEqual([]);
  });

  it("records a term in no bounded context, which BWrite's file keeps", () => {
    const b = builtFromFile();
    expect(b.language.term(RETURN_LABEL)?.status).toBe("proposed");
    const edit = languageEdit(b, unwrap(b.language.record(RETURN_LABEL, classificationOf("value_object"))), title);
    expect(edit.changes).toEqual([
      {
        type: "put-term",
        term: { name: "Return Label", definition: "The label a customer prints to send an item back.", kind: "value_object" },
        replaces: { name: "Return Label" },
      },
    ]);
    expect(edit.retargets).toEqual([]);
  });

  it("refuses recording without a classification here too (recording-requires-a-classification)", () => {
    expect(refusalOf(builtFromFile().language.record(GIFT_WRAP, null))).toBe("Classify the term before recording it in the vocabulary.");
  });

  it("refuses a change once the file is gone", () => {
    const gone = buildLanguage(PROJECT, { file: { ...BWRITE_FILE, found: false }, document: null, localProposals: [] });
    const withTerm = unwrap(
      gone.language.propose({ name: "Cart", definition: "A basket.", classification: null }, termIdFor(undefined, "Cart") as TermId, termProposalOf(SEED_IDS.feature, "cart", AT)),
    );
    expect(refusalOf(withTerm.record(termIdFor(undefined, "Cart"), classificationOf("value_object")))).toBe(
      "Create ubiquitous-language.bwrite.yaml first: this project has no vocabulary file yet.",
    );
  });
});
