import { useLayoutEffect, useRef } from "react";

interface TitleFieldProps {
  id: string;
  value: string;
  onChange(value: string): void;
  /** Called when Enter is pressed, so focus can move on to the body. */
  onCommit(): void;
}

/** A single-line title that wraps instead of clipping on narrow screens. */
export function TitleField({ id, value, onChange, onCommit }: TitleFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // The width changes with the viewport and whenever a side panel opens or closes, so refit on width changes.
  useLayoutEffect(() => {
    const el = ref.current!;
    let width = -1;
    const fit = () => {
      width = el.clientWidth;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== width) fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  return (
    <textarea
      ref={ref}
      id={id}
      className="bw-title-input"
      rows={1}
      autoComplete="off"
      spellCheck
      placeholder="Untitled feature"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, " "))}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit();
        }
      }}
    />
  );
}
