import { useEffect, useId, useMemo, useRef, useState } from "react";
import { matchesShortcut, shortcut } from "../editor/shortcuts";
import type { Workspace } from "../application/workspace";
import { normalizeSearchQuery, searchWorkspace, type SearchResult } from "../application/search";

export function CommandPalette({ workspace, onChoose, onClosed }: {
  workspace: Workspace; onChoose(result: SearchResult): void; onClosed(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const chosen = useRef(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const id = useId();
  const groups = useMemo(() => searchWorkspace(workspace, query), [workspace, query]);
  const results = groups.flatMap((g) => g.results);
  const index = Math.min(active, Math.max(0, results.length - 1));
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    input.current!.focus();
    return () => {
      if (!chosen.current && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    document.getElementById(`${id}-option-${index}`)?.scrollIntoView({ block: "nearest" });
  }, [id, index, groups]);
  const choose = (result: SearchResult) => {
    chosen.current = true;
    ref.current!.close();
    onChoose(result);
  };
  return <dialog ref={ref} className="bw-dialog bw-command-palette" aria-labelledby={`${id}-title`} onClose={onClosed}>
    <div className="bw-palette-head"><h2 id={`${id}-title`}>Search all projects</h2>
      <button className="bw-button" type="button" onClick={() => ref.current!.close()}>Close</button>
    </div>
    <div className="bw-palette-query">
      <label className="bw-eyebrow" htmlFor={`${id}-query`}>Search the workspace</label>
      <input ref={input} id={`${id}-query`} className="bw-input" type="text" value={query} autoComplete="off"
        role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-results`}
        aria-activedescendant={results.length ? `${id}-option-${index}` : undefined} aria-describedby={`${id}-status`}
        onChange={(event) => { setQuery(event.target.value); setActive(0); }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          const down = matchesShortcut(event.nativeEvent, shortcut("move-down"));
          const up = matchesShortcut(event.nativeEvent, shortcut("move-up"));
          if (down || up) {
            event.preventDefault();
            if (results.length) setActive((index + (down ? 1 : -1) + results.length) % results.length);
          } else if (matchesShortcut(event.nativeEvent, shortcut("newline"))) {
            event.preventDefault();
            if (results[index]) choose(results[index]);
          }
        }} />
    </div>
    <p id={`${id}-status`} className="bw-palette-help" role="status">
      {!normalizeSearchQuery(query) ? "Type to search projects, features, domain terms, and placed rules."
        : !results.length ? `No matches for “${query.trim()}”`
        : `${groups.reduce((n, g) => n + g.results.length + g.more, 0)} results. Use ↑ and ↓ to move and Enter to open.`}
    </p>
    <div id={`${id}-results`} className="bw-search-results" role="listbox" aria-label="Search results">
      {groups.filter((g) => g.results.length).map((group) => <div key={group.category} role="group" aria-labelledby={`${id}-${group.category}`}>
        <div className="bw-search-category" id={`${id}-${group.category}`}>{group.label}</div>
        {group.results.map((result) => {
          const position = results.indexOf(result);
          return <div id={`${id}-option-${position}`} key={result.id} role="option" aria-selected={position === index}
            className="bw-palette-option bw-search-option" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(result)}>
            <div className="bw-search-option__label"><strong>{result.label}</strong>{result.category === "terms" && result.proposed && <small>proposed</small>}</div>
            <small>{result.projectName}</small>
            <span className="bw-search-snippet">{result.snippet.slice(0, result.highlight.from)}<mark>{result.snippet.slice(result.highlight.from, result.highlight.to)}</mark>{result.snippet.slice(result.highlight.to)}</span>
          </div>;
        })}
        {group.more > 0 && <p className="bw-palette-help">+{group.more} more in {group.label.toLowerCase()}. Refine your search to see them.</p>}
      </div>)}
    </div>
  </dialog>;
}
