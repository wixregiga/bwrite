import { describe, expect, it } from "vitest";
import { KIND_LEVELS, kindTitle } from "../domain/term-kind";
import {
  TYPE_AHEAD_WINDOW,
  extendedSearch,
  movedIndex,
  pickerKeyAction,
  typeAheadIndex,
  type PickerKey,
} from "./picker-navigation";

const press = (key: string, modifiers: Partial<PickerKey> = {}): PickerKey => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...modifiers,
});

// The real options of the kind picker, in the order it lists them.
const LABELS = ["Not classified", ...KIND_LEVELS.flatMap((level) => level.kinds.map(kindTitle))];

describe("pickerKeyAction on a closed combobox (WAI-ARIA APG select-only)", () => {
  it("opens on Enter, Space, and Alt+Arrow, leaving the chosen option active", () => {
    expect(pickerKeyAction(false, press("Enter"))).toEqual({ type: "open" });
    expect(pickerKeyAction(false, press(" "))).toEqual({ type: "open" });
    expect(pickerKeyAction(false, press("ArrowDown", { altKey: true }))).toEqual({ type: "open" });
    expect(pickerKeyAction(false, press("ArrowUp", { altKey: true }))).toEqual({ type: "open" });
  });

  it("opens and moves on Arrow, Home, and End", () => {
    expect(pickerKeyAction(false, press("ArrowDown"))).toEqual({ type: "open-and-move", move: "next" });
    expect(pickerKeyAction(false, press("ArrowUp"))).toEqual({ type: "open-and-move", move: "previous" });
    expect(pickerKeyAction(false, press("Home"))).toEqual({ type: "open-and-move", move: "first" });
    expect(pickerKeyAction(false, press("End"))).toEqual({ type: "open-and-move", move: "last" });
  });

  it("searches on a printable character and leaves everything else to the page", () => {
    expect(pickerKeyAction(false, press("d"))).toEqual({ type: "type-ahead", character: "d" });
    expect(pickerKeyAction(false, press("Escape"))).toEqual({ type: "ignore" });
    expect(pickerKeyAction(false, press("Tab"))).toEqual({ type: "ignore" });
    expect(pickerKeyAction(false, press("Shift"))).toEqual({ type: "ignore" });
  });

  it("never takes a shortcut that holds Control or Meta", () => {
    expect(pickerKeyAction(false, press("a", { ctrlKey: true }))).toEqual({ type: "ignore" });
    expect(pickerKeyAction(true, press("i", { metaKey: true }))).toEqual({ type: "ignore" });
  });
});

describe("pickerKeyAction on an open combobox", () => {
  it("moves with the arrows, Home, and End", () => {
    expect(pickerKeyAction(true, press("ArrowDown"))).toEqual({ type: "move", move: "next" });
    expect(pickerKeyAction(true, press("ArrowUp"))).toEqual({ type: "move", move: "previous" });
    expect(pickerKeyAction(true, press("Home"))).toEqual({ type: "move", move: "first" });
    expect(pickerKeyAction(true, press("End"))).toEqual({ type: "move", move: "last" });
  });

  it("chooses on Enter, Space, and Alt+ArrowUp", () => {
    expect(pickerKeyAction(true, press("Enter"))).toEqual({ type: "choose" });
    expect(pickerKeyAction(true, press(" "))).toEqual({ type: "choose" });
    expect(pickerKeyAction(true, press("ArrowUp", { altKey: true }))).toEqual({ type: "choose" });
  });

  it("closes on Escape and chooses while letting focus leave on Tab", () => {
    expect(pickerKeyAction(true, press("Escape"))).toEqual({ type: "close" });
    expect(pickerKeyAction(true, press("Tab"))).toEqual({ type: "choose-and-leave" });
    expect(pickerKeyAction(true, press("Tab", { altKey: false }))).toEqual({ type: "choose-and-leave" });
  });

  it("searches on a printable character", () => {
    expect(pickerKeyAction(true, press("v"))).toEqual({ type: "type-ahead", character: "v" });
    expect(pickerKeyAction(true, press("F5"))).toEqual({ type: "ignore" });
  });
});

describe("movedIndex", () => {
  it("steps without wrapping", () => {
    expect(movedIndex(8, 0, "previous")).toBe(0);
    expect(movedIndex(8, 7, "next")).toBe(7);
    expect(movedIndex(8, 3, "next")).toBe(4);
    expect(movedIndex(8, 3, "previous")).toBe(2);
  });

  it("reaches the ends", () => {
    expect(movedIndex(8, 3, "first")).toBe(0);
    expect(movedIndex(8, 3, "last")).toBe(7);
  });

  it("reaches nothing when there are no options", () => {
    expect(movedIndex(0, 0, "next")).toBe(-1);
  });
});

describe("typeAheadIndex over the kind picker's own labels", () => {
  it("finds the first option beginning with the search", () => {
    expect(LABELS[typeAheadIndex(LABELS, 0, "v")]).toBe("Value Object");
    expect(LABELS[typeAheadIndex(LABELS, 0, "sp")]).toBe("Specification");
    expect(LABELS[typeAheadIndex(LABELS, 0, "not")]).toBe("Not classified");
  });

  it("ignores case", () => {
    expect(LABELS[typeAheadIndex(LABELS, 0, "BOUNDED")]).toBe("Bounded Context");
  });

  it("steps through options sharing an initial when the same letter repeats", () => {
    const first = typeAheadIndex(LABELS, 0, "d");
    expect(LABELS[first]).toBe("Domain Event");
    const second = typeAheadIndex(LABELS, first, "dd");
    expect(LABELS[second]).toBe("Domain Service");
    const third = typeAheadIndex(LABELS, second, "ddd");
    expect(LABELS[third]).toBe("Domain Event");
  });

  it("keeps the active option while a longer search still matches it", () => {
    const event = LABELS.indexOf("Domain Event");
    expect(typeAheadIndex(LABELS, event, "domain e")).toBe(event);
    expect(LABELS[typeAheadIndex(LABELS, event, "domain s")]).toBe("Domain Service");
  });

  it("wraps past the end and finds nothing for an unmatched search", () => {
    expect(LABELS[typeAheadIndex(LABELS, LABELS.length - 1, "a")]).toBe("Aggregate");
    expect(typeAheadIndex(LABELS, 0, "zzz-nothing")).toBe(-1);
    expect(typeAheadIndex(LABELS, 0, "")).toBe(-1);
    expect(typeAheadIndex([], 0, "a")).toBe(-1);
  });
});

describe("extendedSearch", () => {
  it("joins characters typed within the window and restarts after it", () => {
    expect(extendedSearch("d", 1000, 1000 + TYPE_AHEAD_WINDOW, "o")).toBe("do");
    expect(extendedSearch("do", 1000, 1000 + TYPE_AHEAD_WINDOW + 1, "v")).toBe("v");
  });
});
