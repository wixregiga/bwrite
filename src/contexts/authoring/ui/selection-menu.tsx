import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface SelectionMenuProps {
  x: number;
  y: number;
  onPropose(): void;
  onAssociate(): void;
  /** Present when the selection is on a Rule line that can be placed. */
  onPlaceRule?: () => void;
  onDismiss(): void;
}

const VIEWPORT_MARGIN = 8;

/** Context menu shown over a text selection in the feature body. */
export function SelectionMenu({ x, y, onPropose, onAssociate, onPlaceRule, onDismiss }: SelectionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const menu = menuRef.current!;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - width - VIEWPORT_MARGIN)),
      top: Math.max(VIEWPORT_MARGIN, Math.min(y, window.innerHeight - height - VIEWPORT_MARGIN)),
    });
    itemRef.current!.focus();
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current!.contains(event.target as Node)) onDismiss();
    };
    const onViewportChange = () => onDismiss();
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [onDismiss]);

  return (
    <div
      ref={menuRef}
      className="bw-menu"
      role="menu"
      aria-label="Selection actions"
      style={{ left: position.left, top: position.top }}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          onDismiss();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const items = [...menuRef.current!.querySelectorAll<HTMLElement>("[role=menuitem]")];
          const step = event.key === "ArrowDown" ? 1 : -1;
          const index = items.indexOf(document.activeElement as HTMLElement);
          items[(index + step + items.length) % items.length].focus();
        }
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button ref={itemRef} type="button" role="menuitem" className="bw-menu__item" onClick={onPropose}>
        Propose domain term
      </button>
      <button type="button" role="menuitem" className="bw-menu__item" onClick={onAssociate}>
        Associate with domain concept
      </button>
      {onPlaceRule && (
        <button type="button" role="menuitem" className="bw-menu__item" onClick={onPlaceRule}>
          Place rule
        </button>
      )}
      <div className="bw-menu__hint" aria-hidden="true">
        Shift + right-click for the browser menu
      </div>
    </div>
  );
}
