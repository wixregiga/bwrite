import { Prec, StateEffect, StateField, type EditorState, type Extension, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap, showTooltip, type Tooltip } from "@codemirror/view";
import type { DomainTerm } from "../domain/domain-term";
import { normalizeTermName } from "../domain/terms";
import { referenceTransaction } from "./domain-references";
import { kindBadgeElement, UNCLASSIFIED } from "./kind-marks";
import { shortcut } from "./shortcuts";

const WORD = /[\p{L}\p{M}\p{N}_]/u;

export interface TermInsertionMatch {
  from: number;
  to: number;
  query: string;
  terms: readonly DomainTerm[];
}

/** The longest same-line prefix beginning at a word boundary immediately before the cursor. */
export function termInsertionMatch(text: string, cursor: number, terms: readonly DomainTerm[]): TermInsertionMatch {
  const start = text.lastIndexOf("\n", cursor - 1) + 1;
  const left = text.slice(start, cursor);
  let from = cursor;
  let query = "";
  let candidates = [...terms];
  // Whitespace and line start deliberately open the complete language.
  if (left && !/\s$/u.test(left)) {
    candidates = [];
    const points = [...left];
    let offset = 0;
    for (let i = 0; i < points.length; i++) {
      const previous = points[i - 1];
      if (WORD.test(points[i]) && (!previous || !WORD.test(previous))) {
        const run = left.slice(offset);
        const prefix = normalizeTermName(run);
        const literal = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(`^${literal}`, "iu");
        const matches = terms.filter((t) => pattern.test(normalizeTermName(t.name)));
        if (matches.length) {
          from = start + offset;
          query = run;
          candidates = matches;
          break;
        }
      }
      offset += points[i].length;
    }
    if (!candidates.length && WORD.test(points.at(-1)!)) {
      const word = left.match(/[\p{L}\p{M}\p{N}_]+$/u)![0];
      query = word;
      from = cursor - word.length;
    } else if (!candidates.length) {
      candidates = [...terms];
    }
  }
  const prefix = normalizeTermName(query);
  const literal = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exact = new RegExp(`^${literal}$`, "iu");
  candidates.sort((a, b) =>
    Number(exact.test(normalizeTermName(b.name))) - Number(exact.test(normalizeTermName(a.name)))
    || Number(a.status === "proposed") - Number(b.status === "proposed")
    || a.name.localeCompare(b.name)
    || a.id.localeCompare(b.id));
  return { from, to: cursor, query, terms: candidates };
}

/** Text and its names TermReference share the existing isolated history transaction. */
export function insertTermTransaction(state: EditorState, match: TermInsertionMatch, term: DomainTerm): TransactionSpec {
  const spec = referenceTransaction(state, match.from, match.to, { termId: term.id, reading: { kind: "names" } }, term.name);
  return { ...spec, selection: { anchor: match.from + term.name.length } };
}

interface InsertionMenu extends TermInsertionMatch {
  active: number;
}
const setMenu = StateEffect.define<InsertionMenu | null>();
let nextMenuId = 0;

/** CodeMirror owns the cursor anchor, viewport fitting, and lifetime of the insertion menu. */
export function termInsertion(getTerms: () => readonly DomainTerm[]): { extension: Extension; open(view: EditorView): boolean } {
  const menuId = `term-insertion-${++nextMenuId}`;
  const field = StateField.define<InsertionMenu | null>({
    create: () => null,
    update(value, tr) {
      for (const effect of tr.effects) if (effect.is(setMenu)) return effect.value;
      return tr.docChanged || tr.selection !== undefined || tr.effects.length > 0 ? null : value;
    },
    provide: (f) => showTooltip.from(f, (menu): Tooltip | null => menu ? {
      pos: menu.to, above: false,
      create: createTooltip,
    } : null),
  });
  function createTooltip(view: EditorView) {
    const doc = view.dom.ownerDocument;
    const dom = doc.createElement("div");
    dom.className = "bw-term-insertion";
    dom.id = menuId;
    dom.setAttribute("role", "listbox");
    dom.setAttribute("aria-label", "Insert domain term");
    let rendered: InsertionMenu | null = null;
    const render = () => {
      const current = view.state.field(field);
      if (!current || current === rendered) return;
      if (current.terms === rendered?.terms) {
        Array.from(dom.children).forEach((row, i) => row.setAttribute("aria-selected", String(i === current.active)));
        rendered = current;
        return;
      }
      rendered = current;
      dom.replaceChildren();
      if (!current.terms.length) {
        const empty = doc.createElement("div");
        empty.className = "bw-palette-empty";
        empty.setAttribute("role", "status");
        empty.textContent = current.query ? `No domain terms match “${current.query}”` : "No domain terms in this project";
        dom.append(empty);
      }
      current.terms.forEach((term, i) => {
        const row = doc.createElement("div");
        row.id = `${dom.id}-${i}`;
        row.className = "bw-palette-option";
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(i === current.active));
        row.append(kindBadgeElement(term.classification?.kind ?? UNCLASSIFIED, { proposed: term.status === "proposed" }, doc));
        const name = doc.createElement("span");
        name.textContent = term.name;
        row.append(name);
        if (term.status === "proposed") {
          const status = doc.createElement("small");
          status.textContent = "proposed";
          row.append(status);
        }
        row.addEventListener("mousedown", (event) => event.preventDefault());
        row.addEventListener("click", () => choose(view, i));
        dom.append(row);
      });
    };
    render();
    return {
      dom,
      update: render,
      positioned() {
        const row = dom.children[view.state.field(field)?.active ?? 0] as HTMLElement | undefined;
        if (!row) return;
        const top = row.offsetTop;
        const bottom = top + row.offsetHeight;
        if (top < dom.scrollTop) dom.scrollTop = top;
        else if (bottom > dom.scrollTop + dom.clientHeight) dom.scrollTop = bottom - dom.clientHeight;
      },
    };
  }
  const close = (view: EditorView) => {
    if (!view.state.field(field)) return false;
    view.dispatch({ effects: setMenu.of(null) });
    return true;
  };
  const choose = (view: EditorView, index?: number) => {
    const menu = view.state.field(field);
    if (!menu) return false;
    const term = menu.terms[index ?? menu.active];
    if (term) view.dispatch(insertTermTransaction(view.state, menu, term));
    view.focus();
    return true;
  };
  const move = (view: EditorView, delta: number) => {
    const menu = view.state.field(field);
    if (!menu) return false;
    if (menu.terms.length) view.dispatch({ effects: setMenu.of({ ...menu, active: (menu.active + delta + menu.terms.length) % menu.terms.length }) });
    return true;
  };
  const open = (view: EditorView) => {
    const cursor = view.state.selection.main.head;
    view.dispatch({ effects: setMenu.of({ ...termInsertionMatch(view.state.doc.toString(), cursor, getTerms()), active: 0 }) });
    return true;
  };
  return {
    open,
    extension: [field, EditorView.contentAttributes.compute([field], (state) => {
      const menu = state.field(field);
      if (!menu) return {};
      return {
        role: "combobox", "aria-autocomplete": "list", "aria-controls": menuId,
        "aria-haspopup": "listbox", "aria-expanded": "true",
        ...(menu.terms.length ? { "aria-activedescendant": `${menuId}-${menu.active}` } : {}),
      };
    }), Prec.highest(keymap.of([
      { ...shortcut("insert-term").binding, run: open, preventDefault: true },
      { ...shortcut("move-down").binding, run: (view) => move(view, 1) },
      { ...shortcut("move-up").binding, run: (view) => move(view, -1) },
      { ...shortcut("newline").binding, run: choose, shift: undefined },
      { ...shortcut("choose-term").binding, run: choose },
      { ...shortcut("dismiss").binding, run: close },
    ])), EditorView.domEventHandlers({ blur: (_event, view) => close(view) })],
  };
}
