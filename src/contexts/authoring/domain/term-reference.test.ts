import { describe, expect, it } from "vitest";
import { termReferenceOf, type TermReference } from "./term-reference";
import {
  describeReference,
  lineNumberAt,
  readingWord,
  referenceCue,
  referenceDraftErrors,
  replacementPreview,
  resolveUsages,
  usageAt,
  withReference,
  wordingError,
  wordingOptions,
} from "./references";
import { unwrap } from "../../../../tests/support/unit/command-results";
import { accepted, assertion, classified, id, invariant, language, proposed } from "../../../../tests/support/unit/language-builders";

const lang = () =>
  unwrap(
    language(
      accepted("ctx", "Authoring", { classification: classified("bounded_context") }),
      accepted("term", "Domain Term", { classification: classified("aggregate", { context: "ctx", identity: null }) }),
      proposed("status", "Domain Term Status", { classification: classified("value_object", { context: "ctx" }) }),
      accepted("plain", "Feature"),
      proposed("loose", "Term Kind", { classification: classified("value_object") }),
    ).placeRule(id("term"), invariant("names-are-unique", "Names are unique.")),
  );

const TEXT = ["Given a Feature contains an accepted Domain Term", "- the proposal is accepted later, by a reviewer?"].join("\n");
const firstAccepted = TEXT.indexOf("accepted");
const secondAccepted = TEXT.indexOf("accepted", firstAccepted + 1);

const statusValue: TermReference = termReferenceOf(TEXT, firstAccepted, firstAccepted + 8, id("status"), {
  kind: "value",
  value: "Accepted",
});

const acceptedTerms = [
  { id: "plain", name: "Feature" },
  { id: "term", name: "Domain Term" },
];

describe("resolving domain usages", () => {
  it("applies an association to its own occurrence only", () => {
    const usages = resolveUsages(TEXT, acceptedTerms, [statusValue]);
    expect(usages.map((u) => [u.kind, u.termId, TEXT.slice(u.from, u.to)])).toEqual([
      ["recognized", "plain", "Feature"],
      ["reference", "status", "accepted"],
      ["recognized", "term", "Domain Term"],
    ]);
    // The second "accepted" is a different meaning and stays plain text.
    expect(usageAt(usages, secondAccepted + 2)).toBeNull();
  });

  it("lets an association decide the meaning of a recognized name within its range", () => {
    const domainTerm = TEXT.indexOf("Domain Term");
    const reference = termReferenceOf(TEXT, domainTerm, domainTerm + "Domain Term".length, id("status"), { kind: "names" });
    const usages = resolveUsages(TEXT, acceptedTerms, [reference]);
    expect(usages.filter((u) => u.termId === "term")).toEqual([]);
    expect(usages.filter((u) => u.kind === "recognized").map((u) => u.termId)).toEqual(["plain"]);
  });

  it("recognizes terms in notes, questions, statements, scenarios, and rules alike", () => {
    const text = "Is a Feature ever empty?\nGiven a Feature\n  Scenario: Feature\nRule: a Feature has a title";
    expect(resolveUsages(text, acceptedTerms, []).map((u) => lineNumberAt(text, u.from))).toEqual([1, 2, 3, 4]);
  });
});

describe("usageAt", () => {
  const usages = resolveUsages("a Feature and a Scenario", [{ id: "f", name: "Feature" }, { id: "s", name: "Scenario" }], []);

  it("finds the usage covering a position, inclusive of both ends", () => {
    expect(usageAt(usages, 2)?.termId).toBe("f");
    expect(usageAt(usages, 9)?.termId).toBe("f");
    expect(usageAt(usages, 20)?.termId).toBe("s");
  });

  it("returns null between usages", () => {
    expect(usageAt(usages, 11)).toBeNull();
  });
});

describe("replacing references", () => {
  it("replaces overlapping associations and stays sorted", () => {
    const other = termReferenceOf(TEXT, 0, 5, id("status"), { kind: "names" });
    const next = termReferenceOf(TEXT, firstAccepted + 2, firstAccepted + 6, id("status"), { kind: "names" });
    expect(withReference([other, statusValue], next.from, next.to, next)).toEqual([other, next]);
    expect(withReference([other, statusValue], statusValue.from, statusValue.to, null)).toEqual([other]);
  });
});

describe("association drafts", () => {
  it("require a Value Object for a value reading, and a value", () => {
    expect(referenceDraftErrors({ termId: id("term"), reading: { kind: "value", value: " " } }, lang())).toEqual({
      term: "A value belongs to a Value Object; “Domain Term” is not classified as one.",
      value: "Enter the value this text stands for.",
    });
    expect(referenceDraftErrors({ termId: id("status"), reading: { kind: "value", value: "Accepted" } }, lang())).toEqual({});
  });

  it("require a term of the language", () => {
    expect(referenceDraftErrors({ termId: null, reading: { kind: "names" } }, lang()).term).toBe("Choose the term this text refers to.");
    expect(referenceDraftErrors({ termId: id("gone"), reading: { kind: "names" } }, lang()).term).toBeDefined();
  });

  it("describe a proposed term's value without calling it accepted", () => {
    expect(describeReference(statusValue, lang())).toBe("Value “Accepted” of Domain Term Status (Value Object).");
    expect(referenceCue(statusValue, lang())).toBe("value · Domain Term Status");
    expect(referenceCue({ ...statusValue, termId: id("term"), reading: { kind: "names" } }, lang())).toBe("aggregate");
    expect(referenceCue({ ...statusValue, termId: id("plain"), reading: { kind: "names" } }, lang())).toBe("term");
  });

  it("describe a placed rule visibly, by its kind and term", () => {
    const rule = { ...statusValue, termId: id("term"), reading: { kind: "rule" as const, ruleKey: "names-are-unique" } };
    expect(referenceCue(rule, lang())).toBe("invariant of Domain Term");
    expect(describeReference(rule, lang())).toBe("States invariant “names-are-unique” of Domain Term (Aggregate).");
    const withAssertion = unwrap(lang().placeRule(id("term"), assertion("needs-name", "Propose")));
    const asserted = { ...rule, reading: { kind: "rule" as const, ruleKey: "needs-name" } };
    expect(referenceCue(asserted, withAssertion)).toBe("assertion of Domain Term on Propose");
    expect(describeReference(asserted, withAssertion)).toBe("States assertion on Propose “needs-name” of Domain Term (Aggregate).");
  });

  it("name the reading in one word beside the badge, and none when the text simply names its term", () => {
    const rule = { ...statusValue, termId: id("term"), reading: { kind: "rule" as const, ruleKey: "names-are-unique" } };
    expect(readingWord(statusValue, lang())).toBe("value");
    expect(readingWord(rule, lang())).toBe("invariant");
    const withAssertion = unwrap(lang().placeRule(id("term"), assertion("needs-name", "Propose")));
    expect(readingWord({ ...rule, reading: { kind: "rule", ruleKey: "needs-name" } }, withAssertion)).toBe("assertion");
    expect(readingWord({ ...rule, reading: { kind: "rule", ruleKey: "not-placed" } }, lang())).toBe("rule");
    expect(readingWord({ ...statusValue, reading: { kind: "names" } }, lang())).toBeNull();
  });
});

describe("wording", () => {
  it("offers the value and its qualified name for a value reading", () => {
    expect(wordingOptions({ termId: id("status"), reading: { kind: "value", value: "Accepted" } }, "accepted", lang())).toEqual([
      { id: "keep", label: "Keep the text as written", text: "accepted" },
      { id: "value", label: "The value", text: "Accepted" },
      { id: "qualified", label: "Qualified name", text: "Authoring.Domain Term Status.Accepted" },
    ]);
  });

  it("offers the term's name and qualified name for a naming reading, without repeating the current text", () => {
    const draft = { termId: id("term"), reading: { kind: "names" as const } };
    expect(wordingOptions(draft, "Domain Term", lang()).map((o) => o.text)).toEqual(["Domain Term", "Authoring.Domain Term"]);
    expect(wordingOptions(draft, "term", lang()).map((o) => o.id)).toEqual(["keep", "name", "qualified"]);
  });

  it("offers the qualified name only when it differs from the plain wording", () => {
    const plain = { termId: id("plain"), reading: { kind: "names" as const } };
    expect(wordingOptions(plain, "feature", lang()).map((o) => o.id)).toEqual(["keep", "name"]);
    // A value of a Value Object without a bounded context still sits under its term.
    const value = { termId: id("loose"), reading: { kind: "value" as const, value: "Aggregate" } };
    expect(wordingOptions(value, "aggregate", lang()).map((o) => o.text)).toEqual(["aggregate", "Aggregate", "Term Kind.Aggregate"]);
  });

  it("rejects wording a reference could not cover", () => {
    expect(wordingError("")).toBeDefined();
    expect(wordingError("two\nlines")).toBe("Keep the wording on one line.");
    expect(wordingError("...")).toBe("The wording needs at least one letter or digit.");
    expect(wordingError("Accepted")).toBeUndefined();
  });

  it("previews the replacement within its line", () => {
    expect(replacementPreview(TEXT, statusValue.from, statusValue.to, "Accepted")).toEqual({
      before: "Given a Feature contains an ",
      removed: "accepted",
      inserted: "Accepted",
      after: " Domain Term",
    });
  });
});
