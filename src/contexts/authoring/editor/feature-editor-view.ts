// The CodeMirror view of one Feature's text: every editor extension BWrite installs, created
// once on a host element and driven through a FeatureEditorHandle. The React view hosts it.

import { EditorState, Prec } from "@codemirror/state";
import { EditorView, drawSelection, highlightSpecialChars, keymap, placeholder } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { gherkin } from "./gherkin-language";
import {
  domainReferences,
  referenceTransaction,
  referencesOf,
  ruleStepOf,
  ruleTransaction,
  setReferenceTargets,
  type ReferenceTargets,
} from "./domain-references";
import { domainTerms, setEditorVocabulary, type EditorVocabulary } from "./domain-terms";
import type { TermReference } from "../domain/term-reference";
import type { TermId } from "../domain/term-id";
import type { PlacedRule, RuleChange } from "../domain/placed-rule";
import type { ReferenceDraft } from "../domain/references";
import { hasWordCharacter } from "../domain/terms";
import type { DomainTerm } from "../domain/domain-term";
import { editorKeymap } from "./shortcuts";
import { termInsertion } from "./term-insertion";

export interface EditorSelection {
  from: number;
  to: number;
  text: string;
}

export interface FeatureEditorHandle {
  focus(): void;
  select(from: number, to: number): void;
  /** Opens the popover for the term or reference at the cursor; false when there is none. */
  inspectAtCursor(): boolean;
  /**
   * Associates `[from, to)` with `draft`, or removes its association when `draft` is null,
   * replacing the text with `wording` when given. One undo step; selects the result.
   */
  applyReference(from: number, to: number, draft: ReferenceDraft | null, wording: string | null): void;
  /** Places `rule` on `termId` and ties the Rule's text `[from, to)` to it. One undo step. */
  placeRule(from: number, to: number, termId: TermId, rule: PlacedRule): void;
}

export interface SelectionMenuRequest {
  x: number;
  y: number;
}

/** What the view reads from its host on every use, so the view is created exactly once. */
export interface FeatureEditorSettings {
  initialText: string;
  initialReferences: readonly TermReference[];
  vocabulary: EditorVocabulary;
  /** The terms of the Ubiquitous Language and the rules each holds. */
  targets: ReferenceTargets;
  terms: readonly DomainTerm[];
  labelledBy: string;
  describedBy: string;
  /**
   * One editor step: the text, its references, and the rules the step placed or removed,
   * reported together so references always describe the reported text.
   */
  onEdit(text: string, references: TermReference[], ruleChanges: RuleChange[]): void;
  onSelectionChange(selection: EditorSelection): void;
  onOpenTerm(termId: TermId): void;
  onEditReference(reference: TermReference): void;
  onPlaceRuleAt(pos: number): void;
  onNoTermAtCursor(): void;
  onRequestSelectionMenu(request: SelectionMenuRequest): void;
  /** Why a step that places a rule (including a redo) cannot, or null when it can. */
  ruleRefusal(change: RuleChange): string | null;
  onRuleRefused(reason: string): void;
}

export interface FeatureEditorView extends FeatureEditorHandle {
  setVocabulary(vocabulary: EditorVocabulary): void;
  setTargets(targets: ReferenceTargets): void;
  destroy(): void;
}

/** Creates the editor on `parent`; `settings` is called on every use for the host's current values. */
export function createFeatureEditorView(parent: HTMLElement, settings: () => FeatureEditorSettings): FeatureEditorView {
  const support = domainTerms(settings().vocabulary, {
    openTerm: (id) => settings().onOpenTerm(id),
    editReference: (reference) => settings().onEditReference(reference),
    placeRuleAt: (pos) => settings().onPlaceRuleAt(pos),
    noTermAtCursor: () => settings().onNoTermAtCursor(),
  });

  const reportSelection = (view: EditorView) => {
    const { from, to } = view.state.selection.main;
    settings().onSelectionChange({ from, to, text: view.state.sliceDoc(from, to) });
  };

  const insertion = termInsertion(() => settings().terms);
  const initial = settings();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: initial.initialText,
      extensions: [
        history(),
        drawSelection(),
        highlightSpecialChars(),
        EditorView.lineWrapping,
        placeholder("Write notes, Given/When/Then statements, Scenarios, or Rules…"),
        Prec.high(keymap.of(editorKeymap({
          "inspect-term": (view) => {
            if (!support.inspectAtCursor(view)) settings().onNoTermAtCursor();
            return true;
          },
        }))),
        insertion.extension,
        gherkin,
        domainReferences({
          references: initial.initialReferences,
          targets: initial.targets,
          ruleRefusal: (change) => settings().ruleRefusal(change),
        }),
        support.extension,
        EditorView.contentAttributes.of({
          "aria-labelledby": initial.labelledBy,
          "aria-describedby": initial.describedBy,
          spellcheck: "true",
        }),
        EditorView.updateListener.of((update) => {
          const references = referencesOf(update.state);
          const steps = update.transactions.map(ruleStepOf);
          const ruleChanges = steps.flatMap((step) => step.applied);
          for (const { reason } of steps.flatMap((step) => step.refused)) settings().onRuleRefused(reason);
          if (update.docChanged || references !== referencesOf(update.startState) || ruleChanges.length > 0) {
            settings().onEdit(update.state.doc.toString(), [...references], ruleChanges);
          }
          if (update.docChanged || update.selectionSet) reportSelection(update.view);
        }),
        EditorView.domEventHandlers({
          contextmenu(event, view) {
            // Shift + right-click always yields the browser's own menu.
            if (event.shiftKey) return false;
            const sel = view.state.selection.main;
            if (sel.empty || !hasWordCharacter(view.state.sliceDoc(sel.from, sel.to))) return false;
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos !== null && (pos < sel.from || pos > sel.to)) return false;
            event.preventDefault();
            const pointerInside = pos !== null && event.clientX !== 0 && event.clientY !== 0;
            const anchor = pointerInside ? null : view.coordsAtPos(sel.to);
            settings().onRequestSelectionMenu({
              x: anchor ? anchor.left : event.clientX,
              y: anchor ? anchor.bottom : event.clientY,
            });
            return true;
          },
        }),
      ],
    }),
  });

  return {
    focus() {
      view.focus();
    },
    select(from, to) {
      view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
      view.focus();
    },
    inspectAtCursor() {
      view.focus();
      return support.inspectAtCursor(view);
    },
    applyReference(from, to, draft, wording) {
      view.dispatch(referenceTransaction(view.state, from, to, draft, wording));
      view.focus();
    },
    placeRule(from, to, termId, rule) {
      view.dispatch(ruleTransaction(view.state, from, to, termId, rule));
      view.focus();
    },
    setVocabulary(vocabulary) {
      view.dispatch({ effects: setEditorVocabulary.of(vocabulary) });
    },
    setTargets(targets) {
      view.dispatch({ effects: setReferenceTargets.of(targets) });
    },
    destroy() {
      view.destroy();
    },
  };
}
