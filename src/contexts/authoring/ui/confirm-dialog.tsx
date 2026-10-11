import { useEffect, useId, useRef, type ReactNode } from "react";

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** Called once after the dialog closes, with whether the action was confirmed. */
  onClosed(confirmed: boolean): void;
}

/** A modal confirmation for destructive actions. Cancel has focus initially, so Enter does not destroy. */
export function ConfirmDialog({ title, children, confirmLabel, onClosed }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmed = useRef(false);
  const ids = useId();

  useEffect(() => {
    // No close() on cleanup: it would fire "close" and report a dismissal the user never made.
    const dialog = dialogRef.current!;
    if (!dialog.open) dialog.showModal();
    cancelRef.current!.focus();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="bw-dialog"
      role="alertdialog"
      aria-labelledby={`${ids}-title`}
      aria-describedby={`${ids}-body`}
      onClose={() => onClosed(confirmed.current)}
    >
      <div className="bw-proposal">
        <header>
          <h2 id={`${ids}-title`} className="bw-proposal__title">
            {title}
          </h2>
          <div id={`${ids}-body`} className="bw-proposal__lede">
            {children}
          </div>
        </header>
        <div className="bw-proposal__actions">
          <button ref={cancelRef} type="button" className="bw-button" onClick={() => dialogRef.current!.close()}>
            Cancel
          </button>
          <button
            type="button"
            className="bw-button bw-button--danger"
            onClick={() => {
              confirmed.current = true;
              dialogRef.current!.close();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
