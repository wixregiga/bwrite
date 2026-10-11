import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { MarkedKind } from "../editor/kind-marks";
import { extendedSearch, movedIndex, pickerKeyAction, typeAheadIndex } from "./picker-navigation";
import { KindBadge } from "./kind-badge";

/** One choice of the picker. The badge of `kind` is drawn left of the label; null draws none. */
export interface PickerOption {
  value: string;
  label: string;
  kind: MarkedKind | null;
  /** The choice is a proposed term: its badge carries the proposed ring. */
  proposed?: boolean;
  /** Options with the same group that follow one another sit under one group heading. */
  group?: string;
}

interface KindPickerProps {
  /** The id of the combobox element, so a label can point at it. */
  id: string;
  /** The id of the element that names the combobox. */
  labelId: string;
  describedBy?: string;
  options: readonly PickerOption[];
  value: string;
  onChange(value: string): void;
}

/** A group of consecutive options under one heading, or a run of ungrouped options. */
interface OptionRun {
  group: string | undefined;
  start: number;
  options: PickerOption[];
}

function runsOf(options: readonly PickerOption[]): OptionRun[] {
  const runs: OptionRun[] = [];
  options.forEach((option, index) => {
    const last = runs.at(-1);
    if (last && last.group === option.group) last.options.push(option);
    else runs.push({ group: option.group, start: index, options: [option] });
  });
  return runs;
}

function OptionContent({ option }: { option: PickerOption }) {
  return (
    <>
      <span className="bw-picker__badge" aria-hidden="true">
        {option.kind && <KindBadge kind={option.kind} proposed={option.proposed} />}
      </span>
      <span className="bw-picker__label">{option.label}</span>
    </>
  );
}

/**
 * A select-only combobox that follows the WAI-ARIA Authoring Practices Guide pattern:
 * focus stays on the combobox and `aria-activedescendant` names the option under the
 * cursor. Each option shows its kind's badge left of its label, drawn from the same
 * markup as the editor's badge.
 */
export function KindPicker({ id, labelId, describedBy, options, value, onChange }: KindPickerProps) {
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const [open, setOpenState] = useState(false);
  const [active, setActiveState] = useState(selectedIndex);
  // Keys typed faster than React renders must each see the state the previous key left, so the
  // key handler reads these refs, which change at once, rather than the last render's values.
  const openNow = useRef(false);
  const activeNow = useRef(selectedIndex);
  const setOpen = (next: boolean) => {
    openNow.current = next;
    setOpenState(next);
  };
  const setActive = (next: number) => {
    activeNow.current = next;
    setActiveState(next);
  };
  const search = useRef({ text: "", at: 0 });

  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const openAt = (index: number) => {
    setActive(index);
    setOpen(true);
  };

  const choose = (index: number) => {
    // A choice ends the search, so the next letter typed starts a new one.
    search.current = { text: "", at: 0 };
    setOpen(false);
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const open = openNow.current;
    const active = activeNow.current;
    const action = pickerKeyAction(open, event.nativeEvent);
    switch (action.type) {
      case "ignore":
        return;
      case "open":
        openAt(selectedIndex);
        break;
      case "open-and-move":
        openAt(movedIndex(options.length, selectedIndex, action.move));
        break;
      case "close":
        setOpen(false);
        event.stopPropagation();
        break;
      case "move":
        setActive(movedIndex(options.length, active, action.move));
        break;
      case "choose":
        choose(active);
        break;
      case "choose-and-leave":
        choose(active);
        return;
      case "type-ahead": {
        const now = event.timeStamp;
        search.current = { text: extendedSearch(search.current.text, search.current.at, now, action.character), at: now };
        const found = typeAheadIndex(
          options.map((o) => o.label),
          open ? active : selectedIndex,
          search.current.text,
        );
        if (found >= 0) openAt(found);
        break;
      }
    }
    event.preventDefault();
  };

  const selected = options[selectedIndex];
  return (
    <div className="bw-picker">
      <div
        id={id}
        role="combobox"
        tabIndex={0}
        className="bw-picker__combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        aria-activedescendant={open ? optionId(active) : undefined}
        onClick={() => (open ? setOpen(false) : openAt(selectedIndex))}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      >
        {selected && <OptionContent option={selected} />}
        <svg className="bw-picker__chevron" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>
      <div id={listId} role="listbox" aria-labelledby={labelId} className="bw-picker__list" hidden={!open}>
        {runsOf(options).map((run) => {
          const items = run.options.map((option, offset) => {
            const index = run.start + offset;
            return (
              <div
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={index === selectedIndex}
                className={`bw-picker__option${index === active ? " is-active" : ""}${index === selectedIndex ? " is-selected" : ""}`}
                onPointerDown={(event) => event.preventDefault()}
                onPointerMove={() => index !== active && setActive(index)}
                onClick={() => choose(index)}
              >
                <OptionContent option={option} />
              </div>
            );
          });
          if (run.group === undefined) return <Fragment key={run.start}>{items}</Fragment>;
          const headingId = `${listId}-group-${run.start}`;
          return (
            <div key={run.group} role="group" aria-labelledby={headingId}>
              <div id={headingId} role="presentation" className="bw-picker__group">
                {run.group}
              </div>
              {items}
            </div>
          );
        })}
      </div>
    </div>
  );
}
