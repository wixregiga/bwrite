import { describe, expect, it } from "vitest";
import { Feature } from "./feature";
import { isReferenceRange, termReferenceOf, type TermReference } from "./term-reference";
import { RefusalError } from "./refusal";
import { refusalOf, unwrap } from "../../../../tests/support/unit/command-results";
import { FEATURE, PROJECT, id } from "../../../../tests/support/unit/language-builders";

const BODY = "Rule: An Order always has a line\nGiven an Order with a line";
const at = (needle: string, occurrence = 0) => {
  let index = BODY.indexOf(needle);
  for (let i = 0; i < occurrence; i++) index = BODY.indexOf(needle, index + 1);
  return index;
};
const ref = (needle: string, reading: TermReference["reading"] = { kind: "names" }, occurrence = 0): TermReference =>
  termReferenceOf(BODY, at(needle, occurrence), at(needle, occurrence) + needle.length, id("order"), reading);

const feature = (references: readonly TermReference[] = []) =>
  new Feature({ id: FEATURE, projectId: PROJECT, title: "Orders", body: BODY, references });

describe("TermReference door", () => {
  it("accepts one line of the text with a word in it, for each reading", () => {
    expect(ref("Order", { kind: "names" })).toEqual({ from: 9, to: 14, termId: "order", reading: { kind: "names" } });
    expect(ref("line", { kind: "value", value: "  a   line " }).reading).toEqual({ kind: "value", value: "a line" });
    expect(ref("An Order always has a line", { kind: "rule", ruleKey: "order-has-lines" }).reading).toEqual({
      kind: "rule",
      ruleKey: "order-has-lines",
    });
  });

  it("refuses ranges that are empty, outside the text, across lines, or without a word", () => {
    expect(isReferenceRange(BODY, 3, 3)).toBe(false);
    expect(isReferenceRange(BODY, 0, BODY.length + 1)).toBe(false);
    expect(isReferenceRange("a - b", 1, 4)).toBe(false);
    expect(() => termReferenceOf(BODY, at("line"), at("Given") + 5, id("order"), { kind: "names" })).toThrow(
      "A reference covers a word or phrase on one line of the feature.",
    );
    expect(() => termReferenceOf(BODY, 0, 0, id("order"), { kind: "names" })).toThrow(RefusalError);
  });

  it("refuses an empty value and a rule reading without a rule key", () => {
    expect(() => termReferenceOf(BODY, 9, 14, id("order"), { kind: "value", value: "  " })).toThrow(
      "Enter the value this text stands for.",
    );
    expect(() => termReferenceOf(BODY, 9, 14, id("order"), { kind: "rule", ruleKey: "Not A Key" })).toThrow(RefusalError);
  });
});

describe("Feature", () => {
  it("keeps its references sorted by position", () => {
    const later = ref("Order", { kind: "names" }, 1);
    const earlier = ref("Order");
    expect(feature([later, earlier]).references).toEqual([earlier, later]);
  });

  it("never holds two references over the same text (references-never-overlap)", () => {
    const whole = ref("An Order always has a line", { kind: "rule", ruleKey: "has-lines" });
    expect(() => feature([whole, ref("Order")])).toThrow("Two references in this feature cover the same text.");
    // Adjacent references do not overlap.
    const an = termReferenceOf(BODY, 6, 8, id("a"), { kind: "names" });
    const order = termReferenceOf(BODY, 9, 14, id("o"), { kind: "names" });
    expect(feature([an, order]).references).toHaveLength(2);
  });

  it("refuses an edit whose references overlap or do not fit the new text", () => {
    const f = feature();
    expect(refusalOf(f.edit(BODY, [ref("An Order always"), ref("Order always has")]))).toBe(
      "Two references in this feature cover the same text.",
    );
    expect(refusalOf(f.edit("short", [ref("Order", { kind: "names" }, 1)]))).toBe(
      "A reference covers a word or phrase on one line of the feature.",
    );
  });

  it("edits text and references together, and retitles without touching them", () => {
    const edited = unwrap(feature().edit(`${BODY}!`, [ref("Order")]));
    expect(edited.body).toBe(`${BODY}!`);
    expect(edited.references).toEqual([ref("Order")]);
    const retitled = unwrap(edited.retitle("Order lines"));
    expect(retitled).toMatchObject({ id: FEATURE, title: "Order lines", body: `${BODY}!`, references: [ref("Order")] });
  });

  it("unties the occurrences that state one rule, leaving the text and other references", () => {
    const rule = ref("An Order always has a line", { kind: "rule", ruleKey: "has-lines" });
    const other = termReferenceOf(BODY, at("Order", 1), at("Order", 1) + 5, id("order"), { kind: "names" });
    const f = feature([rule, other]);
    expect(f.ruleReferences(id("order"), "has-lines")).toEqual([rule]);
    const untied = unwrap(f.removeRuleReferences(id("order"), "has-lines"));
    expect(untied.references).toEqual([other]);
    expect(untied.body).toBe(BODY);
    expect(unwrap(f.removeRuleReferences(id("invoice"), "has-lines")).references).toEqual([rule, other]);
  });
});
