import { history, redo, undo } from "@codemirror/commands";
import { EditorState, type Transaction, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { termReferenceOf, type TermReference } from "../domain/term-reference";
import type { RuleChange } from "../domain/placed-rule";
import type { ReferenceDraft } from "../domain/references";
import {
  domainReferences,
  referenceTransaction,
  referencesOf,
  ruleStepOf,
  ruleTransaction,
  setReferenceTargets,
  type ReferenceTargets,
} from "./domain-references";
import { id, invariant } from "../../../../tests/support/unit/language-builders";

const TEXT = "Given a Feature contains an accepted Domain Term\nAnd it was accepted yesterday\nRule: A Domain Term name is unique";
const FROM = TEXT.indexOf("accepted");
const TO = FROM + "accepted".length;
const DRAFT: ReferenceDraft = { termId: id("status"), reading: { kind: "value", value: "Accepted" } };
const REFERENCE: TermReference = termReferenceOf(TEXT, FROM, TO, id("status"), DRAFT.reading);
const RULE_FROM = TEXT.indexOf("A Domain Term name");
const RULE_TO = TEXT.length;
const RULE = invariant("name-is-unique", "A Domain Term name is unique");
const TARGETS: ReferenceTargets = new Map([
  [id("status"), new Set<string>()],
  [id("term"), new Set<string>()],
]);

/**
 * A minimal editor without a view: state plus the history the real editor uses. It plays
 * the app's part too: it records every rule change the editor reports, and refuses a
 * placement when `refuse` says so.
 */
class Harness {
  state: EditorState;
  readonly reported: RuleChange[] = [];
  readonly refusals: string[] = [];
  refuse: string | null = null;

  constructor(references: readonly TermReference[] = [], targets: ReferenceTargets = TARGETS) {
    this.state = EditorState.create({
      doc: TEXT,
      extensions: [
        history(),
        domainReferences({
          references,
          targets,
          ruleRefusal: () => this.refuse,
        }),
      ],
    });
  }
  dispatch = (spec: TransactionSpec | Transaction) => {
    const tr = "startState" in spec ? spec : this.state.update(spec);
    const step = ruleStepOf(tr);
    this.reported.push(...step.applied);
    this.refusals.push(...step.refused.map((r) => r.reason));
    this.state = tr.state;
  };
  get text() {
    return this.state.doc.toString();
  }
  get covered() {
    return referencesOf(this.state).map((r) => this.text.slice(r.from, r.to));
  }
  undo() {
    expect(undo(this)).toBe(true);
  }
  redo() {
    expect(redo(this)).toBe(true);
  }
}

describe("references follow edits", () => {
  it("do not grow when typing at either edge, and do grow when typing inside", () => {
    const h = new Harness([REFERENCE]);
    h.dispatch({ changes: { from: TO, insert: "ly" } });
    h.dispatch({ changes: { from: FROM, insert: "un" } });
    expect(h.covered).toEqual(["accepted"]);
    const inside = referencesOf(h.state)[0].from + 3;
    h.dispatch({ changes: { from: inside, insert: "X" } });
    expect(h.covered).toEqual(["accXepted"]);
  });

  it("are dropped when their text is deleted or split across lines, and come back on undo", () => {
    const h = new Harness([REFERENCE]);
    h.dispatch({ changes: { from: FROM, to: TO } });
    expect(referencesOf(h.state)).toEqual([]);
    h.undo();
    expect(h.text).toBe(TEXT);
    expect(referencesOf(h.state)).toEqual([REFERENCE]);

    h.dispatch({ changes: { from: FROM + 3, insert: "\n" } });
    expect(referencesOf(h.state)).toEqual([]);
    h.undo();
    expect(referencesOf(h.state)).toEqual([REFERENCE]);
  });

  it("move with text inserted before them", () => {
    const h = new Harness([REFERENCE]);
    h.dispatch({ changes: { from: 0, insert: "# note\n" } });
    expect(referencesOf(h.state)[0]).toMatchObject({ from: FROM + 7, to: TO + 7 });
  });

  it("are dropped when their term leaves the language", () => {
    const h = new Harness([REFERENCE]);
    h.dispatch({ effects: setReferenceTargets.of(new Map([[id("term"), new Set<string>()]])) });
    expect(referencesOf(h.state)).toEqual([]);
  });
});

describe("associating and rewording", () => {
  it("associates one occurrence as its own undo step, leaving the other occurrence alone", () => {
    const h = new Harness();
    h.dispatch(referenceTransaction(h.state, FROM, TO, DRAFT, null));
    expect(h.text).toBe(TEXT);
    expect(referencesOf(h.state)).toEqual([REFERENCE]);
    h.undo();
    expect(referencesOf(h.state)).toEqual([]);
    h.redo();
    expect(referencesOf(h.state)).toEqual([REFERENCE]);
  });

  it("replaces the wording and keeps the association on the new text; undo restores both", () => {
    const h = new Harness([REFERENCE]);
    h.dispatch(referenceTransaction(h.state, FROM, TO, DRAFT, "Accepted"));
    expect(h.text).toBe(TEXT.replace("an accepted", "an Accepted"));
    expect(h.covered).toEqual(["Accepted"]);
    expect(h.state.selection.main).toMatchObject({ from: FROM, to: TO });

    h.undo();
    expect(h.text).toBe(TEXT);
    expect(referencesOf(h.state)).toEqual([REFERENCE]);

    h.redo();
    expect(h.text).toBe(TEXT.replace("an accepted", "an Accepted"));
    expect(h.covered).toEqual(["Accepted"]);
  });

  it("shifts later associations when the wording changes length", () => {
    const later = TEXT.indexOf("accepted", TO);
    const second = termReferenceOf(TEXT, later, later + 8, id("status"), { kind: "names" });
    const h = new Harness([REFERENCE, second]);
    h.dispatch(referenceTransaction(h.state, FROM, TO, DRAFT, "Domain Term Status.Accepted"));
    expect(h.covered).toEqual(["Domain Term Status.Accepted", "accepted"]);
    h.undo();
    expect(referencesOf(h.state)).toEqual([REFERENCE, second]);
  });

  it("removes an association without touching the text, and undo brings it back", () => {
    const h = new Harness([REFERENCE]);
    h.dispatch(referenceTransaction(h.state, FROM, TO, null, null));
    expect(h.text).toBe(TEXT);
    expect(referencesOf(h.state)).toEqual([]);
    h.undo();
    expect(referencesOf(h.state)).toEqual([REFERENCE]);
  });

  it("is not merged into the typing before it", () => {
    const h = new Harness();
    h.dispatch({ changes: { from: TEXT.length, insert: "!" }, userEvent: "input.type" });
    h.dispatch(referenceTransaction(h.state, FROM, TO, DRAFT, null));
    h.undo();
    expect(h.text).toBe(`${TEXT}!`);
    expect(referencesOf(h.state)).toEqual([]);
  });
});

describe("placing a rule", () => {
  const ruleReference = termReferenceOf(TEXT, RULE_FROM, RULE_TO, id("term"), { kind: "rule", ruleKey: RULE.key });

  it("places the rule and ties the Rule's text to it as one undo step, which undo and redo reverse together", () => {
    const h = new Harness();
    h.dispatch(ruleTransaction(h.state, RULE_FROM, RULE_TO, id("term"), RULE));
    expect(h.text).toBe(TEXT);
    expect(referencesOf(h.state)).toEqual([ruleReference]);
    expect(h.reported).toEqual([{ kind: "placed", termId: "term", rule: RULE }]);

    h.undo();
    expect(referencesOf(h.state)).toEqual([]);
    expect(h.reported.at(-1)).toEqual({ kind: "removed", termId: "term", rule: RULE });

    h.redo();
    expect(referencesOf(h.state)).toEqual([ruleReference]);
    expect(h.reported.at(-1)).toEqual({ kind: "placed", termId: "term", rule: RULE });
  });

  it("is not merged with the typing before it", () => {
    const h = new Harness();
    h.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input.type" });
    h.dispatch(ruleTransaction(h.state, RULE_FROM + 1, RULE_TO + 1, id("term"), RULE));
    h.undo();
    expect(h.text).toBe(`x${TEXT}`);
    expect(referencesOf(h.state)).toEqual([]);
    expect(h.reported.map((c) => c.kind)).toEqual(["placed", "removed"]);
  });

  it("replaces an association on the Rule's text, and undo brings it back", () => {
    const termInRule = TEXT.indexOf("Domain Term", RULE_FROM);
    const names = termReferenceOf(TEXT, termInRule, termInRule + 11, id("term"), { kind: "names" });
    const h = new Harness([names]);
    h.dispatch(ruleTransaction(h.state, RULE_FROM, RULE_TO, id("term"), RULE));
    expect(referencesOf(h.state)).toEqual([ruleReference]);
    h.undo();
    expect(referencesOf(h.state)).toEqual([names]);
  });

  it("places nothing when the language refuses, whether placing or redoing", () => {
    const h = new Harness();
    h.refuse = "Only an Aggregate or a Value Object holds invariants.";
    h.dispatch(ruleTransaction(h.state, RULE_FROM, RULE_TO, id("term"), RULE));
    expect(referencesOf(h.state)).toEqual([]);
    expect(h.reported).toEqual([]);
    expect(h.refusals).toEqual(["Only an Aggregate or a Value Object holds invariants."]);

    h.refuse = null;
    h.dispatch(ruleTransaction(h.state, RULE_FROM, RULE_TO, id("term"), RULE));
    h.undo();
    // A redo the language refuses places nothing and leaves no reference behind. CodeMirror's
    // history still consumes the step, so the rule is placed again from the dialog.
    h.refuse = "Refused now.";
    h.redo();
    expect(referencesOf(h.state)).toEqual([]);
    expect(h.refusals.at(-1)).toBe("Refused now.");
    expect(h.reported.map((c) => c.kind)).toEqual(["placed", "removed"]);
    h.refuse = null;
    h.dispatch(ruleTransaction(h.state, RULE_FROM, RULE_TO, id("term"), RULE));
    expect(referencesOf(h.state)).toEqual([ruleReference]);
    expect(h.reported.map((c) => c.kind)).toEqual(["placed", "removed", "placed"]);
  });

  it("never brings back a reference to a rule removed in the meantime", () => {
    const h = new Harness();
    h.dispatch(ruleTransaction(h.state, RULE_FROM, RULE_TO, id("term"), RULE));
    h.dispatch({ changes: { from: RULE_FROM, to: RULE_TO }, userEvent: "delete" });
    expect(referencesOf(h.state)).toEqual([]);
    // The rule is removed from the language elsewhere, so the language no longer holds it.
    h.dispatch({ effects: setReferenceTargets.of(TARGETS) });
    h.undo();
    expect(h.text).toBe(TEXT);
    expect(referencesOf(h.state)).toEqual([]);
  });
});
