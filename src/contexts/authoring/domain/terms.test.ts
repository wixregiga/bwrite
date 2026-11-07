import { describe, expect, it } from "vitest";
import { cleanTermName, findTermMatches, normalizeTermName, type MatchableTerm } from "./terms";
import { matched } from "../../../../tests/support/unit/term-matches";

const term = (id: string, name: string): MatchableTerm => ({ id, name });

describe("findTermMatches", () => {
  const feature = term("feature", "Feature");
  const scenario = term("scenario", "Scenario");
  const domainTerm = term("domain-term", "Domain Term");
  const ubiquitous = term("ul", "Ubiquitous Language");

  it("matches case-insensitively", () => {
    expect(matched("a feature, a FEATURE, a Feature", [feature])).toEqual([
      ["feature", "feature"],
      ["feature", "FEATURE"],
      ["feature", "Feature"],
    ]);
  });

  it("does not match inside unrelated words", () => {
    expect(matched("Features featured prefeature feature_x feature2", [feature])).toEqual([]);
  });

  it("treats punctuation and hyphens as term boundaries", () => {
    expect(matched("(Feature), Feature. Feature-level 'feature'", [feature]).map(([, s]) => s)).toEqual([
      "Feature",
      "Feature",
      "Feature",
      "feature",
    ]);
  });

  it("uses Unicode letters as word characters, not only ASCII", () => {
    expect(matched("Featureé éFeature naïve Feature", [feature])).toEqual([["feature", "Feature"]]);
  });

  it("matches multiword terms across any run of spaces or tabs", () => {
    expect(matched("a Domain Term, a domain  term, a DOMAIN\tTERM", [domainTerm])).toEqual([
      ["domain-term", "Domain Term"],
      ["domain-term", "domain  term"],
      ["domain-term", "DOMAIN\tTERM"],
    ]);
  });

  it("does not match a multiword term split across lines", () => {
    expect(matched("Given a Domain\n  Term appears", [domainTerm])).toEqual([]);
  });

  it("prefers the longest matching term when terms overlap at the same start", () => {
    const domain = term("domain", "Domain");
    expect(matched("each Domain Term and each Domain", [domain, domainTerm])).toEqual([
      ["domain-term", "Domain Term"],
      ["domain", "Domain"],
    ]);
  });

  it("prefers the longest term even when a shorter term starts earlier", () => {
    const ab = term("ab", "alpha beta");
    const bcd = term("bcd", "beta gamma delta");
    expect(matched("alpha beta gamma delta", [ab, bcd])).toEqual([["bcd", "beta gamma delta"]]);
  });

  it("reports adjacent non-overlapping terms separately", () => {
    expect(matched("Feature Scenario", [feature, scenario])).toEqual([
      ["feature", "Feature"],
      ["scenario", "Scenario"],
    ]);
  });

  it("escapes regular expression characters in term names", () => {
    const cpp = term("cpp", "C++ API");
    const dotted = term("dotted", "a.b");
    expect(matched("Use the C++ API, not axb or a.b", [cpp, dotted])).toEqual([
      ["cpp", "C++ API"],
      ["dotted", "a.b"],
    ]);
  });

  it("ignores terms with no letters or digits rather than matching everything", () => {
    expect(matched("Feature --- !!", [term("dash", "---"), term("blank", "   ")])).toEqual([]);
  });

  it("treats Gherkin keywords at the start of a line as syntax", () => {
    const text = "Feature: Feature editing\n  Scenario: a Scenario\n    Given a Feature";
    expect(findTermMatches(text, [feature, scenario]).map((m) => [m.termId, m.from])).toEqual([
      ["feature", text.indexOf("Feature editing")],
      ["scenario", text.indexOf("a Scenario") + 2],
      ["feature", text.lastIndexOf("Feature")],
    ]);
  });

  it("still matches keyword words that are not in keyword position", () => {
    const given = term("given", "Given");
    expect(matched("  Given the Given value", [given])).toEqual([["given", "Given"]]);
  });

  it("matches inside doc strings, where keywords are prose", () => {
    const text = 'Given text\n  """\n  Feature: inside\n  """\nFeature: outside';
    const matches = findTermMatches(text, [feature]);
    expect(matches.map((m) => m.from)).toEqual([text.indexOf("Feature: inside")]);
  });

  it("returns UTF-16 offsets that slice back to the authored text", () => {
    const text = "😀 Domain Term 😀\r\nand ünïcode Domain Term";
    for (const m of findTermMatches(text, [domainTerm])) {
      expect(text.slice(m.from, m.to)).toBe("Domain Term");
    }
    expect(findTermMatches(text, [domainTerm])).toHaveLength(2);
  });

  it("recognizes a term by any of its aliases, as that term", () => {
    const order: MatchableTerm = { id: "order", name: "Order", aliases: ["Purchase Order", "PO"] };
    expect(matched("A purchase order, an Order, and a PO", [order])).toEqual([
      ["order", "purchase order"],
      ["order", "Order"],
      ["order", "PO"],
    ]);
  });

  it("leaves a phrase that names terms in two bounded contexts unrecognized, never guessing", () => {
    const salesOrder: MatchableTerm = { id: "sales/order", name: "Order" };
    const billingOrder: MatchableTerm = { id: "billing/order", name: "Order", aliases: ["Billing Order"] };
    const invoice: MatchableTerm = { id: "billing/invoice", name: "Invoice", aliases: ["order"] };
    expect(matched("An Order becomes an Invoice through the Billing Order", [salesOrder, billingOrder, invoice])).toEqual([
      ["billing/invoice", "Invoice"],
      ["billing/order", "Billing Order"],
    ]);
  });

  it("recognizes a phrase one term lists twice, as its name and as an alias", () => {
    const order: MatchableTerm = { id: "order", name: "Order", aliases: ["order"] };
    expect(matched("an Order", [order])).toEqual([["order", "Order"]]);
  });

  it("matches a multiword term written in lower case within a sentence", () => {
    expect(matched("Then the ubiquitous language is visible", [ubiquitous, domainTerm])).toEqual([
      ["ul", "ubiquitous language"],
    ]);
  });

  it("returns nothing when there are no terms", () => {
    expect(findTermMatches("Feature", [])).toEqual([]);
  });
});

describe("term name normalization", () => {
  it("trims and collapses whitespace for display", () => {
    expect(cleanTermName("  Domain \n\t Term ")).toBe("Domain Term");
  });

  it("compares case-insensitively and in composed Unicode form", () => {
    expect(normalizeTermName("Café Order")).toBe(normalizeTermName("CAFÉ  order"));
  });
});
