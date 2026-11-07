import { Prec, StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  activateHover,
  closeHoverTooltips,
  hasHoverTooltips,
  hoverTooltip,
  keymap,
  type DecorationSet,
  type TooltipView,
} from "@codemirror/view";
import { kindTitle, type TermKind } from "../domain/term-kind";
import type { TermReference } from "../domain/term-reference";
import { ruleLineAt } from "../domain/gherkin";
import type { TermId } from "../domain/term-id";
import type { TermStatus } from "../domain/domain-term";
import { resolveUsages, usageAt, type DomainUsage } from "../domain/references";
import type { MatchableTerm } from "../domain/terms";
import { UNCLASSIFIED, kindBadgeElement, kindTermClassName, kindTextClassName, type MarkedKind } from "./kind-marks";
import { referencesField } from "./domain-references";

/** A DomainTerm, accepted or proposed, as the editor presents it. */
export interface EditorTerm {
  id: TermId;
  name: string;
  definition: string;
  status: TermStatus;
  /** The term's kind; null when unclassified. */
  kind: TermKind | null;
  /** The names the term sits under, outermost first. */
  containers: readonly string[];
}

/** What the editor needs from the Ubiquitous Language. Only accepted terms are recognized by name. */
export interface EditorVocabulary {
  /** Shown above the term name in popovers, such as "Ubiquitous Language · BWrite". */
  languageName: string;
  acceptedTerms: readonly MatchableTerm[];
  terms: ReadonlyMap<TermId, EditorTerm>;
  /** Visible cue text for a reference. */
  /** The word that tells a value or rule reading apart without color; null when the text simply names the term. */
  readingWord(reference: TermReference): string | null;
  referenceCue(reference: TermReference): string;
  /** A sentence saying what a reference means. */
  describeReference(reference: TermReference): string;
}

export interface DomainTermHandlers {
  openTerm(termId: TermId): void;
  editReference(reference: TermReference): void;
  /** Opens the dialog that places the Rule written on the line holding `pos`. */
  placeRuleAt(pos: number): void;
  /** Called when keyboard inspection finds nothing recognized at the cursor. */
  noTermAtCursor(): void;
}

export const setEditorVocabulary = StateEffect.define<EditorVocabulary>();

interface UsageState {
  vocabulary: EditorVocabulary;
  usages: readonly DomainUsage[];
  decorations: DecorationSet;
}

/**
 * The mark drawn immediately left of a term: the kind's badge, and for a value or a rule
 * a short word, so the reading is not told by color alone. It is a widget, so it is never
 * part of the document: copying, selecting, and undo only ever see the term's own text.
 */
class TermMarkWidget extends WidgetType {
  constructor(
    readonly kind: MarkedKind,
    readonly proposed: boolean,
    /** What the text is read as, such as "value" or "invariant"; null when it simply names the term. */
    readonly word: string | null,
    /** The whole sentence the word abbreviates. */
    readonly wordTitle: string,
  ) {
    super();
  }

  override eq(other: TermMarkWidget) {
    return (
      other.kind === this.kind &&
      other.proposed === this.proposed &&
      other.word === this.word &&
      other.wordTitle === this.wordTitle
    );
  }

  toDOM(view: EditorView) {
    const doc = view.dom.ownerDocument;
    const mark = doc.createElement("span");
    mark.className = "bw-term-mark";
    mark.append(kindBadgeElement(this.kind, { proposed: this.proposed }, doc));
    if (this.word !== null) {
      const word = doc.createElement("span");
      word.className = `bw-term-mark__word ${kindTextClassName(this.kind)}`;
      word.textContent = this.word;
      word.title = this.wordTitle;
      mark.append(word);
    }
    return mark;
  }

  override ignoreEvent() {
    return false;
  }
}

/** The kind a term is marked with: its own, or the unclassified mark for no kind or a missing term. */
function markedKindOf(term: EditorTerm | undefined): MarkedKind {
  return term?.kind ?? UNCLASSIFIED;
}

function usageDecorations(
  usage: DomainUsage,
  vocabulary: EditorVocabulary,
  fresh: boolean,
): Range<Decoration>[] {
  const term = vocabulary.terms.get(usage.termId);
  const kind = markedKindOf(term);
  const proposed = term?.status === "proposed";
  // The mark sits left of the term, outside its highlight; side -1 keeps it before anything typed at the term's start.
  const markAt = (word: string | null, wordTitle: string) =>
    Decoration.widget({ widget: new TermMarkWidget(kind, proposed, word, wordTitle), side: -1 }).range(usage.from);

  if (usage.kind === "recognized") {
    const highlight = Decoration.mark({
      class: `bw-term ${kindTermClassName(kind)}${fresh ? " bw-term-fresh" : ""}`,
      attributes: { "data-term-id": usage.termId },
    }).range(usage.from, usage.to);
    return [markAt(null, ""), highlight];
  }
  const reading = usage.reference.reading.kind;
  const cue = reading === "names" ? "" : vocabulary.referenceCue(usage.reference);
  const highlight = Decoration.mark({
    class: `bw-ref bw-ref--${reading}${proposed ? " bw-ref--proposed" : ""} ${kindTermClassName(kind)}`,
    attributes: { "data-term-id": usage.termId, "data-reading": reading },
  }).range(usage.from, usage.to);
  return [markAt(vocabulary.readingWord(usage.reference), cue), highlight];
}

function buildDecorations(
  usages: readonly DomainUsage[],
  vocabulary: EditorVocabulary,
  fresh: ReadonlySet<DomainUsage>,
): DecorationSet {
  return Decoration.set(
    usages.flatMap((u) => usageDecorations(u, vocabulary, fresh.has(u))),
    true,
  );
}

const usageKey = (u: DomainUsage, from: number, to: number) => `${u.kind}:${u.termId}:${from}:${to}`;

function compute(state: EditorState, vocabulary: EditorVocabulary): readonly DomainUsage[] {
  return resolveUsages(state.doc.toString(), vocabulary.acceptedTerms, state.field(referencesField));
}

const EMPTY_VOCABULARY: EditorVocabulary = {
  languageName: "",
  acceptedTerms: [],
  terms: new Map(),
  referenceCue: () => "",
  readingWord: () => null,
  describeReference: () => "",
};

export const usagesField = StateField.define<UsageState>({
  create() {
    return { vocabulary: EMPTY_VOCABULARY, usages: [], decorations: Decoration.none };
  },
  update(value, tr) {
    let vocabulary = value.vocabulary;
    for (const effect of tr.effects) if (effect.is(setEditorVocabulary)) vocabulary = effect.value;
    const vocabularyChanged = vocabulary !== value.vocabulary;
    const referencesChanged = tr.startState.field(referencesField) !== tr.state.field(referencesField);
    if (!tr.docChanged && !vocabularyChanged && !referencesChanged) return value;

    const usages = compute(tr.state, vocabulary);
    // A recognized term is fresh when this edit created it; only those get the one-off shimmer.
    const fresh = new Set<DomainUsage>();
    if (tr.docChanged && !vocabularyChanged) {
      const previous = new Set(
        value.usages.map((u) => usageKey(u, tr.changes.mapPos(u.from, 1), tr.changes.mapPos(u.to, -1))),
      );
      for (const u of usages) if (u.kind === "recognized" && !previous.has(usageKey(u, u.from, u.to))) fresh.add(u);
    }
    return { vocabulary, usages, decorations: buildDecorations(usages, vocabulary, fresh) };
  },
  provide: (field) => EditorView.decorations.from(field, (v) => v.decorations),
});

function usagesOf(state: EditorState): readonly DomainUsage[] {
  return state.field(usagesField).usages;
}

export interface DomainTermsSupport {
  extension: Extension;
  /** Opens the popover at the cursor and focuses it. Returns false when nothing is recognized there. */
  inspectAtCursor(view: EditorView): boolean;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function domainTerms(initialVocabulary: EditorVocabulary, handlers: DomainTermHandlers): DomainTermsSupport {
  let focusNextPopover = false;

  function createPopover(view: EditorView, usage: DomainUsage, vocabulary: EditorVocabulary): TooltipView {
    const term = vocabulary.terms.get(usage.termId);
    const dom = element("div", "bw-term-popover");
    dom.setAttribute("role", "dialog");
    const close = () => view.dispatch({ effects: closeHoverTooltips });
    const actions = element("div", "bw-term-popover__actions");
    const action = (label: string, run: () => void) => {
      const button = element("button", "bw-term-popover__open", label);
      button.type = "button";
      button.addEventListener("click", () => {
        close();
        run();
      });
      actions.append(button);
      return button;
    };

    let firstAction: HTMLButtonElement;
    const isRule = usage.kind === "reference" && usage.reference.reading.kind === "rule";
    if (usage.kind === "recognized") {
      dom.setAttribute("aria-label", `Domain term: ${term?.name ?? ""}`);
      dom.append(element("div", "bw-term-popover__context", vocabulary.languageName));
      dom.append(element("div", "bw-term-popover__name", term?.name ?? ""));
      if (term) dom.append(kindLine(term, view));
      dom.append(element("p", "bw-term-popover__definition", term?.definition ?? ""));
      firstAction = action("Open term", () => handlers.openTerm(usage.termId));
    } else {
      const text = view.state.sliceDoc(usage.from, usage.to);
      dom.setAttribute("aria-label", `${isRule ? "Placed rule" : "Domain reference"}: ${text}`);
      dom.append(element("div", "bw-term-popover__context", isRule ? "Placed rule" : "Associated occurrence"));
      dom.append(element("div", "bw-term-popover__name", text));
      dom.append(element("p", "bw-term-popover__reading", vocabulary.describeReference(usage.reference)));
      if (term) dom.append(kindLine(term, view));
      if (term) {
        dom.append(element("div", "bw-term-popover__status", term.status === "proposed" ? "Proposed term" : "Accepted term"));
      }
      firstAction = action("Open term", () => handlers.openTerm(usage.termId));
      if (!isRule) action("Edit association", () => handlers.editReference(usage.reference));
    }
    // A Rule line not yet placed can be placed from any usage on it.
    const ruleLine = isRule ? null : ruleLineAt(view.state.doc.toString(), usage.from);
    if (ruleLine && ruleLine.text.length > 0) action("Place rule", () => handlers.placeRuleAt(usage.from));
    dom.append(actions);

    dom.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
      view.focus();
    });
    dom.addEventListener("focusout", (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && (dom.contains(next) || view.dom.contains(next))) return;
      if (hasHoverTooltips(view.state)) close();
    });

    return {
      dom,
      mount() {
        if (!focusNextPopover) return;
        focusNextPopover = false;
        firstAction.focus({ preventScroll: true });
      },
    };
  }

  const termHover = hoverTooltip(
    (view, pos, side) => {
      const { usages, vocabulary } = view.state.field(usagesField);
      const usage = usageAt(usages, pos);
      if (!usage) return null;
      if ((pos === usage.from && side < 0) || (pos === usage.to && side > 0)) return null;
      return { pos: usage.from, end: usage.to, above: true, create: (v) => createPopover(v, usage, vocabulary) };
    },
    { hideOnChange: true, hoverTime: 250 },
  );

  function inspectAtCursor(view: EditorView): boolean {
    const usage = usageAt(usagesOf(view.state), view.state.selection.main.head);
    if (!usage) return false;
    focusNextPopover = true;
    activateHover(view, usage.from, 1, {
      tooltip: termHover,
      until: (tr) => tr.docChanged || tr.selection !== undefined,
    });
    return true;
  }

  const extension: Extension = [
    usagesField.init((state) => {
      const usages = compute(state, initialVocabulary);
      return {
        vocabulary: initialVocabulary,
        usages,
        decorations: buildDecorations(usages, initialVocabulary, new Set()),
      };
    }),
    termHover,
    Prec.high(
      keymap.of([
        {
          key: "Mod-i",
          preventDefault: true,
          run(view) {
            if (!inspectAtCursor(view)) handlers.noTermAtCursor();
            return true;
          },
        },
        {
          key: "Escape",
          run(view) {
            if (!hasHoverTooltips(view.state)) return false;
            view.dispatch({ effects: closeHoverTooltips });
            return true;
          },
        },
      ]),
    ),
  ];

  return { extension, inspectAtCursor };
}

function placementText(term: EditorTerm): string {
  const title = term.kind ? kindTitle(term.kind) : "Not classified";
  return term.containers.length > 0 ? `${title} in ${term.containers.join(" › ")}` : title;
}

/** The popover line that names a term's kind, with the same badge the editor draws beside the term. */
function kindLine(term: EditorTerm, view: EditorView): HTMLElement {
  const line = element("div", "bw-term-popover__kind");
  line.append(
    kindBadgeElement(markedKindOf(term), { proposed: term.status === "proposed" }, view.dom.ownerDocument),
    element("span", "bw-term-popover__kind-text", placementText(term)),
  );
  return line;
}
