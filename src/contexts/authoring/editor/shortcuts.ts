import {
  defaultKeymap,
  historyKeymap,
  simplifySelection,
  cursorSyntaxLeft,
  cursorSyntaxRight,
  moveLineUp,
  moveLineDown,
  copyLineUp,
  copyLineDown,
  addCursorAbove,
  addCursorBelow,
  selectLine,
  indentLess,
  indentMore,
  indentSelection,
  deleteLine,
  cursorMatchingBracket,
  toggleComment,
  toggleTabFocusMode,
  cursorCharLeft,
  cursorCharRight,
  cursorGroupLeft,
  cursorGroupRight,
  cursorLineBoundaryLeft,
  cursorLineBoundaryRight,
  cursorLineUp,
  cursorLineDown,
  cursorDocStart,
  cursorDocEnd,
  cursorPageUp,
  cursorPageDown,
  cursorLineBoundaryBackward,
  cursorLineBoundaryForward,
  selectAll,
  deleteCharBackward,
  deleteCharForward,
  deleteGroupBackward,
  deleteGroupForward,
  deleteLineBoundaryBackward,
  deleteLineBoundaryForward,
  cursorLineStart,
  cursorLineEnd,
  deleteToLineEnd,
  splitLine,
  transposeChars,
} from "@codemirror/commands";
import type { KeyBinding } from "@codemirror/view";

export type ShortcutPlatform = "mac" | "win" | "linux";
export interface Shortcut {
  id: string;
  binding: KeyBinding;
  description: string;
  scope: "editor" | "global";
  /** Overrides the existing editor command only while the application action applies. */
  overrides?: string;
}

const applicationShortcuts: Shortcut[] = [
  { id: "insert-term", binding: { key: "Ctrl-Space" }, description: "Insert domain term", scope: "editor" },
  { id: "choose-term", binding: { key: "Tab" }, description: "Choose domain term in dropdown", scope: "editor" },
  { id: "inspect-term", binding: { key: "Mod-i" }, description: "Inspect term", scope: "editor", overrides: "selectParentSyntax" },
  { id: "search", binding: { key: "Mod-k" }, description: "Search all projects", scope: "global" },
  { id: "shortcuts", binding: { key: "Mod-Shift-/" }, description: "Display shortcuts", scope: "global" },
  { id: "dismiss", binding: { key: "Escape" }, description: "Dismiss popup or simplify selection", scope: "global", overrides: "simplifySelection" },
];

const commandDescriptions = new Map<NonNullable<KeyBinding["run"]>, string>([
  [simplifySelection, "Simplify selection"],
  [cursorSyntaxLeft, "Move to previous syntax boundary"],
  [cursorSyntaxRight, "Move to next syntax boundary"],
  [moveLineUp, "Move line up"],
  [moveLineDown, "Move line down"],
  [copyLineUp, "Copy line up"],
  [copyLineDown, "Copy line down"],
  [addCursorAbove, "Add cursor above"],
  [addCursorBelow, "Add cursor below"],
  [selectLine, "Select line"],
  [indentLess, "Decrease indentation"],
  [indentMore, "Increase indentation"],
  [indentSelection, "Indent selection"],
  [deleteLine, "Delete line"],
  [cursorMatchingBracket, "Move to matching bracket"],
  [toggleComment, "Toggle comment"],
  [toggleTabFocusMode, "Toggle Tab focus mode"],
  [cursorCharLeft, "Move left"],
  [cursorCharRight, "Move right"],
  [cursorGroupLeft, "Move to previous word"],
  [cursorGroupRight, "Move to next word"],
  [cursorLineBoundaryLeft, "Move to start of line"],
  [cursorLineBoundaryRight, "Move to end of line"],
  [cursorLineUp, "Move up or select previous dropdown result"],
  [cursorLineDown, "Move down or select next dropdown result"],
  [cursorDocStart, "Move to start of document"],
  [cursorDocEnd, "Move to end of document"],
  [cursorPageUp, "Move one page up"],
  [cursorPageDown, "Move one page down"],
  [cursorLineBoundaryBackward, "Move to start of line"],
  [cursorLineBoundaryForward, "Move to end of line"],
  [selectAll, "Select all"],
  [deleteCharBackward, "Delete previous character"],
  [deleteCharForward, "Delete next character"],
  [deleteGroupBackward, "Delete previous word"],
  [deleteGroupForward, "Delete next word"],
  [deleteLineBoundaryBackward, "Delete to start of line"],
  [deleteLineBoundaryForward, "Delete to end of line"],
  [cursorLineStart, "Move to start of line"],
  [cursorLineEnd, "Move to end of line"],
  [deleteToLineEnd, "Delete to end of line"],
  [splitLine, "Split line"],
  [transposeChars, "Transpose characters"],
]);
const unnamedDescriptions: Record<string, string> = {
  "Mod-Enter": "Insert blank line", "Alt-A": "Toggle block comment", Enter: "New line and indent or choose dropdown result",
};

// The shipped CodeMirror keymaps supply both commands and bindings. Inspection deliberately
// replaces selectParentSyntax, as BWrite's existing editor does. Escape falls through to
// simplifySelection when no popup is open.
const builtins: Shortcut[] = defaultKeymap.filter((b) => b.key !== "Mod-i").map((binding, i) => {
  const description = (binding.run && commandDescriptions.get(binding.run)) ?? unnamedDescriptions[binding.key ?? ""];
  if (!description) throw new Error(`The editor binding ${binding.key ?? binding.mac} needs a shortcut description.`);
  return {
    id: ({ Escape: "editor-escape", ArrowUp: "move-up", ArrowDown: "move-down", Enter: "newline" } as Record<string, string>)[binding.key ?? ""] ?? `editor-${i}`,
    binding,
    description,
    scope: "editor",
  };
});
const historyDescriptions = ["Undo", "Redo", "Redo", "Undo selection", "Redo selection"];
const historyIds = ["undo", "redo", "redo-linux", "undo-selection", "redo-selection"];

export const SHORTCUTS: readonly Shortcut[] = [
  ...applicationShortcuts,
  ...historyKeymap.map((binding, i): Shortcut => ({ id: historyIds[i], binding, description: historyDescriptions[i], scope: "editor" })),
  ...builtins.filter((s) => s.id !== "editor-escape"),
];

export function shortcut(id: string): Shortcut {
  const entry = SHORTCUTS.find((s) => s.id === id);
  if (!entry) throw new Error(`Unknown shortcut: ${id}`);
  return entry;
}

export function shortcutPlatform(): ShortcutPlatform {
  if (/Mac|iPhone|iPad/.test(navigator.platform)) return "mac";
  return /Win/.test(navigator.platform) ? "win" : "linux";
}

export function shortcutKey(entry: Shortcut, platform: ShortcutPlatform): string | undefined {
  return entry.binding[platform] ?? entry.binding.key;
}

export function shortcutLabel(entry: Shortcut, platform: ShortcutPlatform = shortcutPlatform()): string | null {
  const key = shortcutKey(entry, platform);
  if (!key) return null;
  return key.split("-").map((part) => ({
    Mod: platform === "mac" ? "⌘" : "Ctrl", Cmd: "⌘", Alt: platform === "mac" ? "Option" : "Alt",
    Space: "Space", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  }[part] ?? (part.length === 1 ? part.toUpperCase() : part))).join("+");
}

export function matchesShortcut(event: KeyboardEvent, entry: Shortcut, platform = shortcutPlatform()): boolean {
  const binding = shortcutKey(entry, platform);
  if (!binding || event.isComposing || event.getModifierState("AltGraph")) return false;
  const parts = binding.split("-");
  const key = parts.pop()!;
  const mod = platform === "mac" ? "Cmd" : "Ctrl";
  const modifiers = new Set(parts.map((p) => p === "Mod" ? mod : p));
  // On US keyboards Shift+/ produces ?, while other layouts may retain /.
  const actualKey = event.code === "Slash" && key === "/" ? "/" : event.key === " " ? "Space" : event.key;
  return actualKey.toLowerCase() === key.toLowerCase()
    && event.ctrlKey === modifiers.has("Ctrl") && event.metaKey === modifiers.has("Cmd")
    && event.altKey === modifiers.has("Alt") && event.shiftKey === modifiers.has("Shift");
}

export function editorKeymap(handlers: Readonly<Record<string, NonNullable<KeyBinding["run"]>>>): KeyBinding[] {
  return [
    ...applicationShortcuts.filter((s) => handlers[s.id]).map((s) => ({ ...s.binding, run: handlers[s.id], preventDefault: true })),
    ...SHORTCUTS.filter((s) => s.binding.run).map((s) => s.binding),
    // Dismissal uses the popup's handler first, then the editor's standard Escape behavior.
    builtins.find((s) => s.id === "editor-escape")!.binding,
  ];
}
