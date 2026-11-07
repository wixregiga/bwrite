import { useEffect, useId, useRef } from "react";
import { SHORTCUTS, shortcutLabel, shortcutPlatform, type ShortcutPlatform } from "../editor/shortcuts";

export function ShortcutsDialog({ onClosed, platform = shortcutPlatform() }: { onClosed(): void; platform?: ShortcutPlatform }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={ref} className="bw-dialog bw-shortcuts-dialog" aria-labelledby={id} onClose={onClosed}>
    <div className="bw-palette-head"><h2 id={id}>Keyboard shortcuts</h2>
      <button type="button" className="bw-button" onClick={() => ref.current!.close()}>Close</button>
    </div>
    <p className="bw-palette-help">In a dropdown, use ↑ and ↓ to move, Enter to choose, and Escape to close. Tab also chooses a domain term.</p>
    {(["global", "editor"] as const).map((scope) => <section key={scope} className="bw-shortcut-group">
      <h3>{scope === "global" ? "Application" : "Editor"}</h3>
      <dl>{SHORTCUTS.filter((s) => s.scope === scope && shortcutLabel(s, platform)).map((s) => <div key={s.id} data-shortcut-id={s.id}>
        <dt>{s.description}{s.binding.shift && <small>Hold Shift to extend the selection.</small>}</dt>
        <dd><kbd>{shortcutLabel(s, platform)}</kbd></dd>
      </div>)}</dl>
    </section>)}
  </dialog>;
}
