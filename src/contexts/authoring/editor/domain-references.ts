import { invertedEffects, isolateHistory } from "@codemirror/commands";
import {
  Facet,
  StateEffect,
  StateField,
  type ChangeDesc,
  type EditorState,
  type Extension,
  type Text,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { isReferenceRange, ruleKeyOf, termReferenceOf, type TextSource, type TermReference } from "../domain/term-reference";
import type { TermId } from "../domain/term-id";
import { inverseRuleChange, type PlacedRule, type RuleChange } from "../domain/placed-rule";
import { withReference, type ReferenceDraft } from "../domain/references";

function textSource(doc: Text): TextSource {
  return { length: doc.length, slice: (from, to) => doc.sliceString(from, to) };
}

/**
 * The terms references may point at, with the keys of the rules each holds. A reference
 * to anything else is dropped, so an undo can never bring back a reference to a rule
 * that was removed in the meantime. Null while the project's language has not been read: no
 * term can be judged gone yet, so every reference that fits the text is kept until it can be.
 */
export type ReferenceTargets = ReadonlyMap<TermId, ReadonlySet<string>> | null;

export const setReferenceTargets = StateEffect.define<ReferenceTargets>();

/** A rule placed or removed by an editor step. Undo applies its inverse. */
export const ruleChanged = StateEffect.define<RuleChange>();

/**
 * Says why a step may not place a rule, or null when it may. The language decides; the
 * editor asks for every placement, including one that a redo brings back.
 */
export const ruleGate = Facet.define<(change: RuleChange) => string | null, (change: RuleChange) => string | null>({
  combine: (gates) => gates[0] ?? (() => null),
});

/** The rule changes of one transaction: those it carried out, and the placements the language refused. */
export interface RuleStep {
  applied: readonly RuleChange[];
  refused: readonly { change: RuleChange; reason: string }[];
}

const NO_RULE_STEP: RuleStep = { applied: [], refused: [] };

const ruleStepField = StateField.define<RuleStep>({
  create: () => NO_RULE_STEP,
  update(_, tr) {
    const changes = tr.effects.filter((e) => e.is(ruleChanged)).map((e) => e.value as RuleChange);
    if (changes.length === 0) return NO_RULE_STEP;
    const gate = tr.startState.facet(ruleGate);
    const applied: RuleChange[] = [];
    const refused: { change: RuleChange; reason: string }[] = [];
    for (const change of changes) {
      const reason = change.kind === "placed" ? gate(change) : null;
      if (reason === null) applied.push(change);
      else refused.push({ change, reason });
    }
    return { applied, refused };
  },
});

/** What a transaction did to rules. A refused placement changed nothing, and its reference is dropped. */
export function ruleStepOf(tr: Transaction): RuleStep {
  return tr.state.field(ruleStepField);
}

const targetsField = StateField.define<ReferenceTargets>({
  create: () => null,
  update(targets, tr) {
    let next = targets;
    for (const effect of tr.effects) if (effect.is(setReferenceTargets)) next = effect.value;
    // A rule step is refused until the language is read, so an unread language has none to apply.
    if (next === null) return next;
    for (const { kind, termId, rule } of tr.state.field(ruleStepField).applied) {
      const keys = new Set(next.get(termId) ?? []);
      if (kind === "placed") keys.add(rule.key);
      else keys.delete(rule.key);
      next = new Map(next).set(termId, keys);
    }
    return next;
  },
});

function resolves(targets: ReferenceTargets, reference: TermReference): boolean {
  if (targets === null) return true;
  const keys = targets.get(reference.termId);
  const ruleKey = ruleKeyOf(reference);
  return keys !== undefined && (ruleKey === null || keys.has(ruleKey));
}

/**
 * Moves references through a change. Text typed at either edge stays outside the
 * reference; text typed inside it extends it. A reference whose text is deleted
 * entirely is dropped.
 */
function mapReferences(references: readonly TermReference[], changes: ChangeDesc): readonly TermReference[] {
  if (changes.empty) return references;
  let changed = false;
  const mapped: TermReference[] = [];
  for (const r of references) {
    const from = changes.mapPos(r.from, 1);
    const to = changes.mapPos(r.to, -1);
    if (from === r.from && to === r.to) {
      mapped.push(r);
      continue;
    }
    changed = true;
    if (from < to) mapped.push({ ...r, from, to });
  }
  return changed ? mapped : references;
}

/**
 * Drops references the document or the language no longer supports: out of range, split
 * across lines, without a word, or pointing at a term or rule that is gone.
 */
function fit(references: readonly TermReference[], doc: Text, targets: ReferenceTargets): readonly TermReference[] {
  const source = textSource(doc);
  const fits = (r: TermReference) => isReferenceRange(source, r.from, r.to) && resolves(targets, r);
  return references.every(fits) ? references : references.filter(fits);
}

/** Replaces the references wholesale. Values are in the coordinates of the document after the transaction. */
export const setReferences = StateEffect.define<readonly TermReference[]>({
  map: (references, mapping) => mapReferences(references, mapping),
});

export const referencesField = StateField.define<readonly TermReference[]>({
  create: () => [],
  update(references, tr) {
    let next = mapReferences(references, tr.changes);
    for (const effect of tr.effects) if (effect.is(setReferences)) next = effect.value;
    const targets = tr.state.field(targetsField);
    const targetsChanged = targets !== tr.startState.field(targetsField);
    return next === references && !tr.docChanged && !targetsChanged ? next : fit(next, tr.newDoc, targets);
  },
});

/**
 * Lets undo and redo restore references and rule placements. A transaction that sets
 * references explicitly, or whose edit drops one, records the references it started with;
 * a transaction that places or removes a rule records the opposite change.
 */
const referenceHistory = invertedEffects.of((tr) => {
  const inverse: StateEffect<unknown>[] = [];
  for (const effect of tr.effects) if (effect.is(ruleChanged)) inverse.push(ruleChanged.of(inverseRuleChange(effect.value)));
  const before = tr.startState.field(referencesField);
  const dropped =
    tr.docChanged && fit(mapReferences(before, tr.changes), tr.newDoc, tr.startState.field(targetsField)).length < before.length;
  if (tr.effects.some((e) => e.is(setReferences)) || dropped) inverse.push(setReferences.of(before));
  return inverse;
});

export interface DomainReferencesConfig {
  references: readonly TermReference[];
  targets: ReferenceTargets;
  /** Why a step may not place a rule, or null when it may. */
  ruleRefusal(change: RuleChange): string | null;
}

export function domainReferences(config: DomainReferencesConfig): Extension {
  return [
    ruleGate.of((change) => config.ruleRefusal(change)),
    ruleStepField,
    targetsField.init(() => config.targets),
    referencesField.init((state) => fit(config.references, state.doc, config.targets)),
    referenceHistory,
  ];
}

export function referencesOf(state: EditorState): readonly TermReference[] {
  return state.field(referencesField);
}

/**
 * The transaction that associates `[from, to)` with `draft` (or removes its association
 * when `draft` is null), optionally replacing the text with `wording`. References that
 * overlap the range are replaced. It is one undo step and selects the resulting text.
 */
export function referenceTransaction(
  state: EditorState,
  from: number,
  to: number,
  draft: ReferenceDraft | null,
  wording: string | null,
): TransactionSpec {
  const replace = wording !== null && wording !== state.sliceDoc(from, to);
  const changes = state.changes(replace ? { from, to, insert: wording } : []);
  const end = replace ? from + wording.length : to;
  const kept = mapReferences(withReference(state.field(referencesField), from, to, null), changes);
  const newDoc = changes.apply(state.doc);
  const next = withReference(
    kept,
    from,
    end,
    draft?.termId ? termReferenceOf(textSource(newDoc), from, end, draft.termId, draft.reading) : null,
  );
  return {
    changes,
    effects: setReferences.of(next),
    selection: { anchor: from, head: end },
    scrollIntoView: true,
    userEvent: replace ? "input.replace.domain" : "domain.associate",
    annotations: isolateHistory.of("full"),
  };
}

/**
 * The transaction that places `rule` on `termId` and ties the Rule's text `[from, to)` to
 * it with a rule reference, replacing references that overlap it. One undo step: undoing
 * it removes both the rule and the reference.
 */
export function ruleTransaction(state: EditorState, from: number, to: number, termId: TermId, rule: PlacedRule): TransactionSpec {
  const reference = termReferenceOf(textSource(state.doc), from, to, termId, { kind: "rule", ruleKey: rule.key });
  return {
    effects: [ruleChanged.of({ kind: "placed", termId, rule }), setReferences.of(withReference(state.field(referencesField), from, to, reference))],
    selection: { anchor: from, head: to },
    scrollIntoView: true,
    userEvent: "domain.rule",
    annotations: isolateHistory.of("full"),
  };
}
