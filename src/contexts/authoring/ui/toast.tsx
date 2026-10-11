import { useEffect } from "react";

export interface ToastMessage {
  id: number;
  text: string;
  tone: "info" | "success" | "error";
  action?: { label: string; run(): void };
}

const VISIBLE_MS = 6000;

/** A polite live region; the latest message replaces the previous one. */
export function Toast({ message, onDismiss }: { message: ToastMessage | null; onDismiss(): void }) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <div className="bw-toast-region" role="status" aria-live="polite">
      {message && (
        <div key={message.id} className={`bw-toast bw-toast--${message.tone}`}>
          <span>{message.text}</span>
          {message.action && (
            <button
              type="button"
              className="bw-link-button"
              onClick={() => {
                message.action!.run();
                onDismiss();
              }}
            >
              {message.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
