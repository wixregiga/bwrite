import { TERM_KINDS, kindTitle, type TermKind } from "../domain/term-kind";

/** A Domain Term with no kind yet. It has a neutral mark of its own. */
export const UNCLASSIFIED = "unclassified" as const;

/** What a mark can stand for: one of ArcLint's term kinds, or a term that has none yet. */
export type MarkedKind = TermKind | typeof UNCLASSIFIED;

export const MARKED_KINDS: readonly MarkedKind[] = [...TERM_KINDS, UNCLASSIFIED];

/**
 * The short mark shown inside a kind's badge: never the kind's full word, at most two
 * characters, unique per kind. A capital initial where it is free; a second lowercase
 * letter where two kinds share an initial (Domain Event Ev, Domain Service S, Specification
 * Sp). "?" for a term without a kind: a question, not a guess at an initial.
 * Typed as a Record so a new term kind cannot be added without choosing its mark.
 */
const MARKS: Readonly<Record<MarkedKind, string>> = {
  bounded_context: "C",
  aggregate: "A",
  entity: "E",
  value_object: "V",
  domain_event: "Ev",
  domain_service: "S",
  specification: "Sp",
  unclassified: "?",
};

export interface KindBadgeOptions {
  /** A term not yet accepted: any kind, shown with a dashed ring. */
  proposed?: boolean;
}

export function kindMark(kind: MarkedKind): string {
  return MARKS[kind];
}

/** The kind's full name, from ArcLint's concept title; "Unclassified" for no kind. */
export function kindName(kind: MarkedKind): string {
  return kind === UNCLASSIFIED ? "Unclassified" : kindTitle(kind);
}

/** The accessible label of a badge: the kind's full name, prefixed when the term is proposed. */
export function kindBadgeLabel(kind: MarkedKind, options: KindBadgeOptions = {}): string {
  const name = kindName(kind);
  return options.proposed ? `Proposed ${name}` : name;
}

/** Classes of the badge. The color comes from the kind's modifier, which reads kinds.css. */
export function kindBadgeClassName(kind: MarkedKind, options: KindBadgeOptions = {}): string {
  const classes = ["bw-kind-badge", `bw-kind-badge--${kind}`];
  if (options.proposed) classes.push("bw-kind-badge--proposed");
  return classes.join(" ");
}

/** Class that colors a term's text in its kind's color. */
export function kindTextClassName(kind: MarkedKind): string {
  return `bw-kind-text--${kind}`;
}

/** Classes that put the kind's tint and underline behind a term. */
export function kindHighlightClassName(kind: MarkedKind): string {
  return `bw-kind-highlight bw-kind-highlight--${kind}`;
}

/** Classes for a highlighted term: text in the kind's color on the kind's tint. */
export function kindTermClassName(kind: MarkedKind): string {
  return `${kindTextClassName(kind)} ${kindHighlightClassName(kind)}`;
}

/**
 * The attributes of a badge, shared by KindBadge and kindBadgeElement so both render the
 * same markup. The badge is `role="img"` with an `aria-label` rather than `aria-hidden`:
 * the term's own text never says its kind, so hiding the badge would leave assistive
 * technology without the kind. `role="img"` makes the visible mark presentational, so
 * a screen reader announces "Domain Event" and not "Ev", and no visually hidden text is
 * added to the editor's text content. `title` gives pointer users the full name.
 */
export interface KindBadgeAttributes {
  className: string;
  role: "img";
  "aria-label": string;
  title: string;
  "data-kind": MarkedKind;
  "data-proposed"?: "true";
}

export function kindBadgeAttributes(kind: MarkedKind, options: KindBadgeOptions = {}): KindBadgeAttributes {
  const label = kindBadgeLabel(kind, options);
  return {
    className: kindBadgeClassName(kind, options),
    role: "img",
    "aria-label": label,
    title: label,
    "data-kind": kind,
    ...(options.proposed ? { "data-proposed": "true" as const } : {}),
  };
}

/**
 * The badge as a DOM element, for CodeMirror widgets (`toDOM`). Pass
 * `view.dom.ownerDocument` when the editor may live in another document.
 */
export function kindBadgeElement(
  kind: MarkedKind,
  options: KindBadgeOptions = {},
  doc: Document = document,
): HTMLElement {
  const { className, ...attributes } = kindBadgeAttributes(kind, options);
  const badge = doc.createElement("span");
  badge.className = className;
  for (const [name, value] of Object.entries(attributes)) badge.setAttribute(name, value);
  badge.textContent = kindMark(kind);
  return badge;
}
