import { describe, expect, it } from "vitest";
import { TERM_KINDS } from "./term-kind";
import { classificationOf, withKind, withRelation } from "./classification";
import { MAX_DEFINITION_LENGTH, MAX_TERM_NAME_LENGTH, type DomainTerm } from "./domain-term";
import { termProposalOf } from "./term-proposal";
import { QualifiedName } from "./qualified-name";
import { RefusalError } from "./refusal";
import { UbiquitousLanguage } from "./ubiquitous-language";
import { type VocabularyFile } from "./vocabulary-file";
import { refusalOf, unwrap } from "../../../../tests/support/unit/command-results";
import { ARCLINT_FILE, BWRITE_FILE, FEATURE, PROJECT, accepted, assertion, classified, id, invariant, language, proposed } from "../../../../tests/support/unit/language-builders";

/** A language kept in `file`. */
function languageIn(file: VocabularyFile | null, ...terms: DomainTerm[]): UbiquitousLanguage {
  return new UbiquitousLanguage(PROJECT, file, terms);
}

/**
 * A small modeled language: Sales holds the Order aggregate, identified by Order Number,
 * with its Order Line entity; Order Status is a value; Order Placed is raised by Order;
 * Billing is a second context with an Invoice aggregate and its Invoice Number.
 */
function salesLanguage(): UbiquitousLanguage {
  return language(
    accepted("sales", "Sales", { classification: classified("bounded_context") }),
    accepted("billing", "Billing", { classification: classified("bounded_context") }),
    accepted("order-number", "Order Number", { classification: classified("value_object", { context: "sales" }) }),
    accepted("order", "Order", { classification: classified("aggregate", { context: "sales", identity: "order-number" }) }),
    accepted("line", "Order Line", { classification: classified("entity", { aggregate: "order", identity: null }) }),
    proposed("status", "Order Status", { classification: classified("value_object", { context: "sales" }) }),
    accepted("placed", "Order Placed", { classification: classified("domain_event", { context: "sales", raisedBy: "order" }) }),
    accepted("invoice-number", "Invoice Number", { classification: classified("value_object", { context: "billing" }) }),
    accepted("invoice", "Invoice", { classification: classified("aggregate", { context: "billing", identity: null }) }),
    accepted("loose", "Pricing", { classification: classified("domain_service", { context: null }) }),
    accepted("plain", "Customer"),
  );
}

const seedLike = () =>
  language(
    accepted("feature", "Feature"),
    accepted("domain-term", "Domain Term"),
    proposed("proposal", "Term Proposal"),
  );
const proposal = termProposalOf(FEATURE, "author\n    intent", new Date("2026-10-09T08:30:00.000Z"));
const draft = (name: string, definition = "Why a change is made.", classification = null) => ({ name, definition, classification });

describe("proposing a term", () => {
  it("adds a proposed term with cleaned name and definition, keeping where it came from", () => {
    const next = unwrap(seedLike().propose(draft("  Author \n Intent ", "  Why a change is made.  "), id("t-new"), proposal));
    expect(next.term(id("t-new"))).toEqual({
      id: "t-new",
      name: "Author Intent",
      definition: "Why a change is made.",
      aliases: [],
      status: "proposed",
      proposal: { featureId: FEATURE, text: "author\n    intent", proposedAt: "2026-10-09T08:30:00.000Z" },
      classification: null,
      rules: [],
    });
  });

  it("never accepts it (proposing-never-accepts)", () => {
    const before = seedLike();
    const next = unwrap(before.propose(draft("Author"), id("t-new"), proposal));
    expect(next.term(id("t-new"))?.status).toBe("proposed");
    expect(next.acceptedTerms()).toEqual(before.acceptedTerms());
    expect(next.proposedTerms().map((t) => t.name)).toEqual(["Term Proposal", "Author"]);
  });

  it("requires a name (proposing-requires-a-name)", () => {
    expect(refusalOf(seedLike().propose(draft("   "), id("t"), proposal))).toBe("Enter a term name.");
  });

  it("requires a definition (proposing-requires-a-definition)", () => {
    expect(refusalOf(seedLike().propose(draft("Author", " \n "), id("t"), proposal))).toBe("Enter a definition.");
  });

  it("reports every problem of a draft at once, for the form", () => {
    expect(seedLike().proposalProblems({ name: "   ", definition: " \n " })).toEqual({
      name: "Enter a term name.",
      definition: "Enter a definition.",
    });
    expect(seedLike().proposalProblems({ name: "Author", definition: "x" })).toEqual({});
  });

  it("requires the name to contain a letter or digit", () => {
    expect(refusalOf(seedLike().propose(draft("-- !"), id("t"), proposal))).toMatch(/letter or digit/);
  });

  it("refuses names that duplicate an accepted term after normalization (names-are-unique)", () => {
    for (const name of ["Domain Term", "domain term", "  DOMAIN   TERM ", "Domain\tTerm"]) {
      expect(refusalOf(seedLike().propose(draft(name), id("t"), proposal))).toBe(
        "“Domain Term” is already an accepted term in this project's Ubiquitous Language.",
      );
    }
  });

  it("refuses names that duplicate a proposed term after normalization (names-are-unique)", () => {
    expect(refusalOf(seedLike().propose(draft("term   proposal"), id("t"), proposal))).toBe(
      "“Term Proposal” has already been proposed.",
    );
  });

  it("checks names against its own language only", () => {
    const other = new UbiquitousLanguage(PROJECT, BWRITE_FILE, []);
    expect(other.propose(draft("Domain Term"), id("t"), proposal).ok).toBe(true);
  });

  it("checks names within the bounded context the new term is classified in (names-are-unique)", () => {
    const sales = salesLanguage();
    const inBilling = { name: "Order", definition: "A purchase order received.", classification: classified("value_object", { context: "billing" }) };
    expect(unwrap(sales.propose(inBilling, id("billing-order"), proposal)).term(id("billing-order"))?.name).toBe("Order");
    const inSales = { ...inBilling, classification: classified("value_object", { context: "sales" }) };
    expect(refusalOf(sales.propose(inSales, id("sales-order"), proposal))).toBe(
      "“Order” is already an accepted term in this project's Ubiquitous Language.",
    );
    expect(sales.proposalProblems({ name: "order", definition: "x", classification: inBilling.classification })).toEqual({});
    expect(sales.proposalProblems({ name: "order", definition: "x", classification: inSales.classification }).name).toBe(
      "“Order” is already an accepted term in this project's Ubiquitous Language.",
    );
    // An Entity is in its Aggregate's bounded context.
    const entity = { name: "Order Number", definition: "x", classification: classified("entity", { aggregate: "order" }) };
    expect(sales.proposalProblems(entity).name).toBe("“Order Number” is already an accepted term in this project's Ubiquitous Language.");
    expect(sales.proposalProblems({ ...entity, classification: classified("entity", { aggregate: "invoice" }) })).toEqual({});
  });

  it("does not treat a name containing an accepted term as a duplicate", () => {
    expect(seedLike().propose(draft("Domain Term Status"), id("t"), proposal).ok).toBe(true);
  });

  it("enforces length limits", () => {
    const problems = seedLike().proposalProblems({
      name: "a".repeat(MAX_TERM_NAME_LENGTH + 1),
      definition: "b".repeat(MAX_DEFINITION_LENGTH + 1),
    });
    expect(problems.name).toMatch(/characters or fewer/);
    expect(problems.definition).toMatch(/characters or fewer/);
  });

  it("may classify the new term in relation to terms of the language, and only those (placements-stay-in-the-language)", () => {
    const sales = salesLanguage();
    const withContext = { name: "Discount", definition: "A price cut.", classification: classified("value_object", { context: "sales" }) };
    expect(unwrap(sales.propose(withContext, id("discount"), proposal)).term(id("discount"))?.classification).toEqual(
      withContext.classification,
    );
    const outside = { ...withContext, classification: classified("value_object", { context: "gone" }) };
    expect(refusalOf(sales.propose(outside, id("discount"), proposal))).toBe(
      "“Discount” is classified in relation to a term outside this Ubiquitous Language: its bounded context.",
    );
  });

  it("refuses a relation to a term of the wrong kind", () => {
    const wrong = { name: "Cart", definition: "A basket.", classification: classified("aggregate", { context: "sales", identity: "order" }) };
    expect(refusalOf(salesLanguage().propose(wrong, id("cart"), proposal))).toBe(
      "“Order” is not a Value Object, so it cannot be the identity of “Cart”.",
    );
  });
});

describe("classifying a term", () => {
  it("changes only that term's classification, never whether it is accepted or proposed (classifying-keeps-acceptance)", () => {
    const before = seedLike();
    const context = classificationOf("bounded_context");
    const after = unwrap(before.classify(id("domain-term"), context));
    expect(after.term(id("domain-term"))).toEqual({ ...before.term(id("domain-term")), classification: context });
    // No silent changes to other terms: the others are the very same values.
    for (const t of before.terms.filter((t) => t.id !== "domain-term")) expect(after.term(t.id)).toBe(t);

    const proposedAfter = unwrap(before.classify(id("proposal"), classified("aggregate")));
    const term = proposedAfter.term(id("proposal"))!;
    expect(term.status).toBe("proposed");
    expect(term.proposal).toBe(before.term(id("proposal"))!.proposal);
    expect(proposedAfter.acceptedTerms().map((t) => t.id)).toEqual(["feature", "domain-term"]);
  });

  it("can be cleared back to not classified", () => {
    const sales = salesLanguage();
    expect(unwrap(sales.classify(id("loose"), null)).term(id("loose"))?.classification).toBeNull();
  });

  it("refuses an unknown term", () => {
    expect(refusalOf(seedLike().classify(id("gone"), null))).toBe("That term is no longer in this Ubiquitous Language.");
  });

  it("refuses a relation to a term outside the language (placements-stay-in-the-language)", () => {
    expect(refusalOf(seedLike().classify(id("feature"), classified("value_object", { context: "gone" })))).toBe(
      "“Feature” is classified in relation to a term outside this Ubiquitous Language: its bounded context.",
    );
  });

  it("refuses making a term that holds invariants an Entity (invariants-only-on-aggregates-and-values)", () => {
    const sales = unwrap(unwrap(salesLanguage().placeRule(id("order"), invariant("has-lines"))).placeRule(id("order"), invariant("total-is-positive")));
    expect(refusalOf(sales.classify(id("order"), classified("entity", { aggregate: "invoice" })))).toBe(
      "Remove its 2 invariants first. Only an Aggregate or a Value Object holds invariants.",
    );
    expect(refusalOf(sales.classify(id("order"), null))).toMatch(/^Remove its 2 invariants first/);
  });

  it("refuses making a term that holds an assertion a Value Object (assertions-only-on-aggregates-and-services)", () => {
    const sales = unwrap(salesLanguage().placeRule(id("loose"), assertion("price-is-known", "Quote")));
    expect(refusalOf(sales.classify(id("loose"), classified("value_object")))).toBe(
      "Remove its 1 assertion first. Only an Aggregate or a Domain Service holds assertions.",
    );
  });

  it("refuses reclassifying a term another term relies on, naming that term", () => {
    expect(refusalOf(salesLanguage().classify(id("order-number"), classified("entity", { aggregate: "order" })))).toBe(
      "“Order” uses it as its identity, so it must stay a Value Object. Change the identity of “Order” first.",
    );
    expect(refusalOf(salesLanguage().classify(id("order-number"), classified("value_object", { context: "billing" })))).toBe(
      "“Order” uses it as its identity, so it must stay in the same bounded context as “Order”. Change the identity of “Order” first.",
    );
    expect(refusalOf(salesLanguage().classify(id("sales"), classified("value_object")))).toMatch(
      /uses it as its bounded context, so it must stay a Bounded Context/,
    );
  });

  it("refuses moving an Aggregate when it would leave a related term in another bounded context", () => {
    // Order Placed is raised by Order and stays in Sales.
    expect(refusalOf(salesLanguage().classify(id("order"), classified("aggregate", { context: "billing", identity: null })))).toBe(
      "“Order Placed” uses it as its raising Aggregate, so it must stay in the same bounded context as “Order Placed”. Change the raising Aggregate of “Order Placed” first.",
    );
  });

  it("refuses a term as its own relation", () => {
    expect(refusalOf(salesLanguage().classify(id("order-number"), classified("aggregate", { identity: "order-number" })))).toBe(
      "A term cannot be its own identity.",
    );
  });
});

describe("bounded context is optional", () => {
  it("every kind can be classified without one, and only arclint's later needs are noted, never refused", () => {
    for (const kind of TERM_KINDS) {
      const classification = classificationOf(kind);
      const after = unwrap(seedLike().classify(id("feature"), classification));
      expect(after.term(id("feature"))?.classification).toEqual(classification);
    }
    const lang = seedLike();
    expect(lang.arclintNeeds(classificationOf("aggregate"))).toEqual([
      "arclint needs this Aggregate's identity: a Value Object term from the same bounded context.",
    ]);
    expect(lang.arclintNeeds(classificationOf("entity"))).toEqual(["arclint needs the Aggregate this Entity belongs to."]);
    for (const kind of ["bounded_context", "value_object", "domain_event", "domain_service", "specification"] as const) {
      expect(lang.arclintNeeds(classificationOf(kind)), kind).toEqual([]);
    }
    expect(lang.arclintNeeds(null)).toEqual([]);
  });

  it("treats terms with no bounded context as one unplaced language when offering relations", () => {
    const lang = language(
      accepted("number", "Cart Number", { classification: classified("value_object") }),
      accepted("sales", "Sales", { classification: classified("bounded_context") }),
      accepted("placed", "Sales Number", { classification: classified("value_object", { context: "sales" }) }),
      accepted("cart", "Cart", { classification: classified("aggregate") }),
    );
    const cart = lang.term(id("cart"))!.classification!;
    expect(lang.relationCandidates(id("cart"), cart, "identity").map((t) => t.id)).toEqual(["number"]);
    expect(lang.relationCandidates(id("cart"), cart, "context").map((t) => t.id)).toEqual(["sales"]);
    expect(unwrap(lang.classify(id("cart"), withRelation(cart, "identity", id("number")))).term(id("cart"))?.classification).toEqual(
      classified("aggregate", { identity: "number" }),
    );
  });

  it("offers only related terms of the right kind in the same bounded context", () => {
    const sales = salesLanguage();
    const draftAggregate = classified("aggregate", { context: "sales", identity: null });
    expect(sales.relationCandidates(null, draftAggregate, "identity").map((t) => t.id)).toEqual(["order-number", "status"]);
    expect(sales.relationCandidates(null, draftAggregate, "context").map((t) => t.id)).toEqual(["sales", "billing"]);
    const draftEvent = classified("domain_event", { context: "billing", raisedBy: null });
    expect(sales.relationCandidates(null, draftEvent, "raisedBy").map((t) => t.id)).toEqual(["invoice"]);
    // An Entity's Aggregate decides its bounded context, so every Aggregate is offered.
    const draftEntity = classified("entity", { aggregate: null, identity: null });
    expect(sales.relationCandidates(null, draftEntity, "aggregate").map((t) => t.id)).toEqual(["order", "invoice"]);
  });

  it("derives an Entity's bounded context from its Aggregate", () => {
    const sales = salesLanguage();
    const line = sales.term(id("line"))!.classification!;
    expect(sales.contextOf(line)?.name).toBe("Sales");
    expect(sales.relationCandidates(id("line"), line, "identity").map((t) => t.id)).toEqual(["order-number", "status"]);
    const underInvoice = withRelation(line, "aggregate", id("invoice"));
    expect(sales.contextOf(underInvoice)?.name).toBe("Billing");
    expect(sales.contextOf(withRelation(line, "aggregate", null))).toBeUndefined();
  });

  it("clears only the edited term's relations that stop fitting when its bounded context or Aggregate changes", () => {
    const sales = salesLanguage();
    const order = sales.term(id("order"))!.classification!;
    expect(sales.fitRelations(id("order"), withRelation(order, "context", id("billing")))).toEqual(
      classified("aggregate", { context: "billing", identity: null }),
    );
    const line = classified("entity", { aggregate: "order", identity: "order-number" });
    expect(sales.fitRelations(id("line"), withRelation(line, "aggregate", id("invoice")))).toEqual(
      classified("entity", { aggregate: "invoice", identity: null }),
    );
    expect(sales.fitRelations(id("order"), order)).toEqual(order);
    expect(withKind(order, "value_object")).toEqual(classified("value_object", { context: "sales" }));
  });
});

describe("placing and removing rules", () => {
  it("places invariants on Aggregates and Value Objects, and assertions on Aggregates and Domain Services", () => {
    let sales = salesLanguage();
    sales = unwrap(sales.placeRule(id("order"), invariant("has-lines")));
    sales = unwrap(sales.placeRule(id("status"), invariant("is-known")));
    sales = unwrap(sales.placeRule(id("order"), assertion("placing-needs-lines", "Place")));
    sales = unwrap(sales.placeRule(id("loose"), assertion("price-is-known", "Quote")));
    expect(sales.term(id("order"))?.rules.map((r) => r.key)).toEqual(["has-lines", "placing-needs-lines"]);
    expect(sales.rule(id("order"), "placing-needs-lines")).toMatchObject({ kind: "assertion", operation: "Place" });
    // A proposed term holds rules too, and stays proposed.
    expect(sales.term(id("status"))?.status).toBe("proposed");
  });

  it("refuses an invariant on a term that is not an Aggregate or Value Object (invariants-only-on-aggregates-and-values)", () => {
    expect(refusalOf(salesLanguage().placeRule(id("line"), invariant("has-a-product")))).toBe(
      "Only an Aggregate or a Value Object holds invariants, and “Order Line” is an Entity.",
    );
    expect(refusalOf(salesLanguage().placeRule(id("plain"), invariant("has-a-name")))).toBe(
      "Only an Aggregate or a Value Object holds invariants, and “Customer” is not classified.",
    );
  });

  it("refuses an assertion on a term that is not an Aggregate or Domain Service (assertions-only-on-aggregates-and-services)", () => {
    expect(refusalOf(salesLanguage().placeRule(id("status"), assertion("is-known", "Change")))).toBe(
      "Only an Aggregate or a Domain Service holds assertions, and “Order Status” is a Value Object.",
    );
  });

  it("keeps keys unique within a term, not across terms", () => {
    const sales = unwrap(salesLanguage().placeRule(id("order"), invariant("is-valid")));
    expect(refusalOf(sales.placeRule(id("order"), assertion("is-valid", "Place")))).toBe(
      "“Order” already holds a rule keyed “is-valid”. Choose another key.",
    );
    expect(sales.placeRule(id("invoice"), invariant("is-valid")).ok).toBe(true);
  });

  it("removes a rule, and refuses removing one the term does not hold", () => {
    const sales = unwrap(salesLanguage().placeRule(id("order"), invariant("has-lines")));
    expect(unwrap(sales.removeRule(id("order"), "has-lines")).term(id("order"))?.rules).toEqual([]);
    expect(refusalOf(sales.removeRule(id("order"), "nope"))).toBe("“Order” holds no rule keyed “nope”.");
  });

  it("resolves a reference target only while its term, and its rule, are in the language", () => {
    const sales = unwrap(salesLanguage().placeRule(id("order"), invariant("has-lines")));
    expect(sales.resolves({ termId: id("order"), ruleKey: "has-lines" })).toBe(true);
    expect(sales.resolves({ termId: id("order"), ruleKey: null })).toBe(true);
    expect(sales.resolves({ termId: id("order"), ruleKey: "gone" })).toBe(false);
    expect(sales.resolves({ termId: id("gone"), ruleKey: null })).toBe(false);
  });
});

describe("a language built from data enforces every invariant", () => {
  const build = (...terms: DomainTerm[]) => () => new UbiquitousLanguage(PROJECT, BWRITE_FILE, terms);
  const cases: [string, () => UbiquitousLanguage, RegExp][] = [
    ["names-are-unique", build(accepted("a", "Order"), proposed("b", " order ")), /differ only in letter case or spacing/],
    [
      "names-are-unique within one bounded context",
      build(
        accepted("sales", "Sales", { classification: classified("bounded_context") }),
        accepted("a", "Order", { classification: classified("value_object", { context: "sales" }) }),
        accepted("b", "ORDER", { classification: classified("specification", { context: "sales" }) }),
      ),
      /“Order” and “ORDER” differ only in letter case or spacing/,
    ],
    [
      "placements-stay-in-the-language",
      build(accepted("a", "Order", { classification: classified("aggregate", { context: "gone", identity: null }) })),
      /outside this Ubiquitous Language/,
    ],
    [
      "invariants-only-on-aggregates-and-values",
      build(accepted("a", "Pricing", { classification: classified("domain_service"), rules: [invariant("x")] })),
      /holds invariants without being classified as an Aggregate or a Value Object/,
    ],
    [
      "assertions-only-on-aggregates-and-services",
      build(accepted("a", "Status", { classification: classified("value_object"), rules: [assertion("x", "Set")] })),
      /holds assertions without being classified as an Aggregate or a Domain Service/,
    ],
    ["proposed-terms-keep-their-proposal", build(proposed("a", "Author", { proposal: null })), /no longer says where it was proposed from/],
    ["unique term IDs", build(accepted("a", "Order"), accepted("a", "Invoice")), /Two terms share the ID a/],
    [
      "unique rule keys within a term",
      build(accepted("a", "Order", { classification: classified("aggregate"), rules: [invariant("x"), invariant("x")] })),
      /holds two rules keyed/,
    ],
    [
      "relations that fit",
      build(accepted("a", "Order", { classification: classified("aggregate") }), accepted("b", "Line", { classification: classified("entity", { aggregate: "b" }) })),
      /cannot be its own Aggregate/,
    ],
  ];

  it.each(cases)("refuses data breaking %s", (_name, make, reason) => {
    expect(make).toThrow(RefusalError);
    expect(make).toThrow(reason);
  });

  it("builds the same name in two bounded contexts", () => {
    const both = build(
      accepted("sales", "Sales", { classification: classified("bounded_context") }),
      accepted("billing", "Billing", { classification: classified("bounded_context") }),
      accepted("a", "Order", { classification: classified("value_object", { context: "sales" }) }),
      accepted("b", "Order", { classification: classified("value_object", { context: "billing" }) }),
    )();
    expect(both.terms.filter((t) => t.name === "Order")).toHaveLength(2);
  });
});

describe("recording a proposed term", () => {
  const value = classified("value_object", { context: "sales" });

  it("accepts it, classified, and drops its proposal", () => {
    const sales = salesLanguage();
    const after = unwrap(sales.record(id("status"), value));
    expect(after.term(id("status"))).toEqual({ ...sales.term(id("status")), status: "accepted", proposal: null, classification: value });
    expect(after.acceptedTerms().map((t) => t.id)).toContain("status");
    for (const t of sales.terms.filter((t) => t.id !== "status")) expect(after.term(t.id)).toBe(t);
  });

  it("is refused until it is classified (recording-requires-a-classification)", () => {
    expect(refusalOf(salesLanguage().record(id("status"), null))).toBe("Classify the term before recording it in the vocabulary.");
  });

  it("is refused for a term already recorded, and for a term not in the language", () => {
    expect(refusalOf(salesLanguage().record(id("order"), value))).toBe("“Order” is already recorded in this Ubiquitous Language.");
    expect(refusalOf(salesLanguage().record(id("gone"), value))).toBe("That term is no longer in this Ubiquitous Language.");
  });

  it("checks the classification it records like any other (relations-fit-their-kind)", () => {
    expect(refusalOf(salesLanguage().record(id("status"), classified("aggregate", { context: "sales", identity: "order" })))).toBe(
      "“Order” is not a Value Object, so it cannot be the identity of “Order Status”.",
    );
  });
});

describe("what the VocabularyFile can hold", () => {
  const terms = () => [
    accepted("sales", "Sales", { classification: classified("bounded_context") }),
    accepted("order-number", "Order Number", { classification: classified("value_object", { context: "sales" }) }),
    accepted("order", "Order", { classification: classified("aggregate", { context: "sales", identity: "order-number" }) }),
    accepted("legacy", "Legacy Order", { classification: classified("aggregate", { context: "sales", identity: null }) }),
    proposed("cart", "Cart"),
  ];
  const arclint = () => languageIn(ARCLINT_FILE, ...terms());

  it("refuses every change that needs a file while the file is not read or not there", () => {
    expect(refusalOf(languageIn(null, ...terms()).record(id("cart"), classified("bounded_context")))).toBe(
      "This project's vocabulary file has not been read yet.",
    );
    expect(refusalOf(languageIn({ ...ARCLINT_FILE, found: false }, ...terms()).record(id("cart"), classified("bounded_context")))).toBe(
      "Create domain.arclint.yaml first: this project has no vocabulary file yet.",
    );
    expect(refusalOf(languageIn(null, ...terms()).classify(id("order-number"), classified("value_object")))).toBe(
      "This project's vocabulary file has not been read yet.",
    );
  });

  it("keeps an accepted term in arclint's file only with a kind, a bounded context, an Entity's Aggregate, and a new Aggregate's identity", () => {
    expect(refusalOf(arclint().classify(id("order-number"), null))).toBe("domain.arclint.yaml keeps only classified terms. Choose its kind.");
    expect(refusalOf(arclint().classify(id("order-number"), classified("value_object")))).toBe(
      "domain.arclint.yaml keeps a term only inside a bounded context. Choose its bounded context.",
    );
    expect(refusalOf(arclint().record(id("cart"), classified("entity", { aggregate: null })))).toBe(
      "domain.arclint.yaml keeps an Entity only inside its Aggregate. Choose the Aggregate.",
    );
    expect(refusalOf(arclint().record(id("cart"), classified("aggregate", { context: "sales", identity: null })))).toBe(
      "domain.arclint.yaml keeps an Aggregate only with its identity: a Value Object term from the same bounded context.",
    );
    expect(arclint().record(id("cart"), classified("bounded_context")).ok).toBe(true);
    expect(arclint().record(id("cart"), classified("entity", { aggregate: "order" })).ok).toBe(true);
    expect(arclint().record(id("cart"), classified("aggregate", { context: "sales", identity: "order-number" })).ok).toBe(true);
  });

  it("lets an Aggregate arclint already holds without an identity keep being changed", () => {
    expect(arclint().classify(id("legacy"), classified("aggregate", { context: "sales", identity: null })).ok).toBe(true);
  });

  it("classifies a proposed term freely, since it is not in arclint's file", () => {
    expect(arclint().classify(id("cart"), classified("aggregate")).ok).toBe(true);
    expect(arclint().classify(id("cart"), null).ok).toBe(true);
  });

  it("keeps any classification in BWrite's own file", () => {
    const own = languageIn(BWRITE_FILE, ...terms());
    expect(own.classify(id("legacy"), null).ok).toBe(true);
    expect(own.classify(id("legacy"), classified("value_object")).ok).toBe(true);
    expect(own.record(id("cart"), classified("aggregate")).ok).toBe(true);
    expect(own.record(id("cart"), classified("entity")).ok).toBe(true);
  });
});

describe("qualified names", () => {
  it("follow containment: bounded context, then the Aggregate of an Entity, then the term, then the value", () => {
    const sales = salesLanguage();
    expect(sales.qualifiedName(id("line")).text).toBe("Sales.Order.Order Line");
    expect(sales.qualifiedName(id("status"), "Shipped").text).toBe("Sales.Order Status.Shipped");
    expect(sales.qualifiedName(id("order")).text).toBe("Sales.Order");
    // Raising an event is not containment.
    expect(sales.qualifiedName(id("placed")).text).toBe("Sales.Order Placed");
    expect(sales.qualifiedName(id("sales")).text).toBe("Sales");
    expect(sales.qualifiedName(id("plain")).text).toBe("Customer");
    expect(sales.qualifiedName(id("loose")).containers).toEqual([]);
  });

  it("still qualify a term without a bounded context when it has a container", () => {
    const lang = language(
      accepted("order", "Order", { classification: classified("aggregate") }),
      accepted("line", "Order Line", { classification: classified("entity", { aggregate: "order" }) }),
      accepted("status", "Order Status", { classification: classified("value_object") }),
    );
    expect(lang.qualifiedName(id("line")).text).toBe("Order.Order Line");
    expect(lang.qualifiedName(id("status"), " shipped ").text).toBe("Order Status.shipped");
    expect(lang.qualifiedName(id("line")).containers).toEqual(["Order"]);
  });

  it("are built through one door that refuses empty names", () => {
    expect(QualifiedName.of(["Sales", " Order  Line "]).text).toBe("Sales.Order Line");
    expect(() => QualifiedName.of([])).toThrow(RefusalError);
    expect(() => QualifiedName.of(["Sales", "  "])).toThrow(RefusalError);
  });
});

describe("accepted terms", () => {
  it("are the ones recognized by name, the same list on every call", () => {
    const lang = seedLike();
    expect(lang.acceptedTerms().map((t) => t.name)).toEqual(["Feature", "Domain Term"]);
    expect(lang.acceptedTerms()).toBe(lang.acceptedTerms());
  });
});
