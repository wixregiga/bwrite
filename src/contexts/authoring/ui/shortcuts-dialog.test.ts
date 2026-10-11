import { describe, expect, it } from "vitest";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { SHORTCUTS, editorKeymap, matchesShortcut, shortcut, shortcutKey, shortcutLabel, type ShortcutPlatform } from "../editor/shortcuts";

function canonical(key: string, platform: ShortcutPlatform) {
  const parts = key.replace(/Mod/g, platform === "mac" ? "Cmd" : "Ctrl").split("-");
  const last = parts.pop()!;
  // Uppercase letters are distinct shifted bindings in CodeMirror.
  return [...parts.sort(), last].join("-");
}

describe("shortcut registry", () => {
  it.each<ShortcutPlatform>(["mac", "win", "linux"])("has unique bindings on %s and covers the installed editor keymaps", (platform) => {
    const keys = SHORTCUTS.map((s) => shortcutKey(s, platform)).filter((k): k is string => !!k).map((k) => canonical(k, platform));
    expect(new Set(keys).size).toBe(keys.length);
    for (const binding of [...defaultKeymap, ...historyKeymap]) {
      const key = binding[platform] ?? binding.key;
      if (key) expect(keys).toContain(canonical(key, platform));
    }
  });
  it.each<ShortcutPlatform>(["mac", "win", "linux"])("has no unintended application collisions on %s", (platform) => {
    for (const entry of SHORTCUTS.filter((s) => !s.binding.run)) {
      const binding = shortcutKey(entry, platform)!;
      const collisions = [...defaultKeymap, ...historyKeymap].filter((b) => {
        const key = b[platform] ?? b.key;
        return key && canonical(key, platform) === canonical(binding, platform);
      });
      if (entry.overrides) expect(collisions.every((b) => b.run?.name === entry.overrides)).toBe(true);
      else expect(collisions).toEqual([]);
    }
  });
  it.each<ShortcutPlatform>(["mac", "win", "linux"])("renders every available registry entry with its platform label on %s", (platform) => {
    const markup = renderToStaticMarkup(createElement(ShortcutsDialog, { platform, onClosed: () => {} }));
    for (const entry of SHORTCUTS) {
      const label = shortcutLabel(entry, platform);
      if (label) {
        expect(markup).toContain(`data-shortcut-id="${entry.id}"`);
        expect(markup).toContain(entry.description);
      }
    }
    expect(markup).not.toContain("Editor command");
  });
  it("uses registry commands for the editor and keeps inspection ahead of defaults", () => {
    const inspect = () => true;
    const keymap = editorKeymap({ "inspect-term": inspect });
    expect(keymap[0]).toMatchObject({ key: shortcut("inspect-term").binding.key, run: inspect });
    expect(keymap.some((b) => b.run?.name === "selectParentSyntax")).toBe(false);
    expect(keymap.some((b) => b.run?.name === "toggleComment")).toBe(true);
  });
  it("shows Ctrl and Command labels correctly", () => {
    expect(shortcutLabel(shortcut("search"), "win")).toBe("Ctrl+K");
    expect(shortcutLabel(shortcut("search"), "mac")).toBe("⌘+K");
    expect(shortcutLabel(shortcut("insert-term"), "mac")).toBe("Ctrl+Space");
    expect(shortcutLabel(shortcut("redo"), "mac")).toBe("⌘+Shift+Z");
  });
  it("matches shifted slash, rejects additional modifiers and composition", () => {
    const event = { key: "?", code: "Slash", ctrlKey: true, shiftKey: true, metaKey: false, altKey: false, isComposing: false, getModifierState: () => false } as unknown as KeyboardEvent;
    expect(matchesShortcut(event, shortcut("shortcuts"), "linux")).toBe(true);
    expect(matchesShortcut({ ...event, altKey: true } as KeyboardEvent, shortcut("shortcuts"), "linux")).toBe(false);
    expect(matchesShortcut({ ...event, isComposing: true } as KeyboardEvent, shortcut("shortcuts"), "linux")).toBe(false);
    expect(matchesShortcut({ ...event, key: "k", code: "KeyK", shiftKey: false } as KeyboardEvent, shortcut("search"), "linux")).toBe(true);
  });
});
