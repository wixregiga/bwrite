/**
 * Keyboard behavior of a select-only combobox, as the WAI-ARIA Authoring Practices
 * Guide describes it: https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/
 * Pure functions, so the behavior is tested without a browser.
 */

export type PickerMove = "next" | "previous" | "first" | "last";

export type PickerAction =
  /** Open the list; the active option stays the chosen one. */
  | { type: "open" }
  /** Open the list and put the active option on `move`. */
  | { type: "open-and-move"; move: PickerMove }
  /** Close the list and keep the chosen option. */
  | { type: "close" }
  | { type: "move"; move: PickerMove }
  /** Choose the active option and close the list. */
  | { type: "choose" }
  /** Choose the active option, close the list, and let focus leave. */
  | { type: "choose-and-leave" }
  /** A printable character to search the options by. */
  | { type: "type-ahead"; character: string }
  | { type: "ignore" };

export interface PickerKey {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

const MOVES: Readonly<Record<string, PickerMove>> = {
  ArrowDown: "next",
  ArrowUp: "previous",
  Home: "first",
  End: "last",
};

/** What a key press does to a combobox whose list is `open` or closed. */
export function pickerKeyAction(open: boolean, press: PickerKey): PickerAction {
  const { key, altKey, ctrlKey, metaKey } = press;
  if (ctrlKey || metaKey) return { type: "ignore" };
  if (!open) {
    if (key === "ArrowDown" || key === "ArrowUp") return altKey ? { type: "open" } : { type: "open-and-move", move: key === "ArrowDown" ? "next" : "previous" };
    if (key === "Home" || key === "End") return { type: "open-and-move", move: MOVES[key] };
    if (key === "Enter" || key === " ") return { type: "open" };
    if (isTypeAheadCharacter(key, altKey)) return { type: "type-ahead", character: key };
    return { type: "ignore" };
  }
  if (key === "ArrowUp" && altKey) return { type: "choose" };
  if (key in MOVES && !altKey) return { type: "move", move: MOVES[key] };
  if (key === "Enter" || key === " ") return { type: "choose" };
  if (key === "Escape") return { type: "close" };
  if (key === "Tab") return { type: "choose-and-leave" };
  if (isTypeAheadCharacter(key, altKey)) return { type: "type-ahead", character: key };
  return { type: "ignore" };
}

function isTypeAheadCharacter(key: string, altKey: boolean): boolean {
  return !altKey && [...key].length === 1 && key !== " ";
}

/** The index a move reaches from `current` among `count` options. The list does not wrap. */
export function movedIndex(count: number, current: number, move: PickerMove): number {
  if (count === 0) return -1;
  switch (move) {
    case "first":
      return 0;
    case "last":
      return count - 1;
    case "next":
      return Math.min(current + 1, count - 1);
    case "previous":
      return Math.max(current - 1, 0);
  }
}

/** How long typed characters keep forming one search, in milliseconds. */
export const TYPE_AHEAD_WINDOW = 500;

/**
 * The option a search reaches. `search` is everything typed within the window. Characters
 * that are all the same letter step through the options beginning with it, one per press,
 * starting after the active one; otherwise the first option, from the active one onward and
 * wrapping, that begins with the whole search. -1 when no option begins with it.
 */
export function typeAheadIndex(labels: readonly string[], current: number, search: string): number {
  const needle = search.toLocaleLowerCase();
  if (needle === "" || labels.length === 0) return -1;
  const repeated = [...needle].every((c) => c === needle[0]);
  const prefix = repeated ? needle[0] : needle;
  const start = repeated ? current + 1 : Math.max(current, 0);
  for (let step = 0; step < labels.length; step++) {
    const index = (start + step) % labels.length;
    if (labels[index].toLocaleLowerCase().startsWith(prefix)) return index;
  }
  return -1;
}

/** `search` extended by `character` when it was typed within the window of the last one, else just `character`. */
export function extendedSearch(search: string, lastTypedAt: number, now: number, character: string): string {
  return now - lastTypedAt <= TYPE_AHEAD_WINDOW ? search + character : character;
}
