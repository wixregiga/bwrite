import { kindBadgeAttributes, kindMark, type KindBadgeOptions, type MarkedKind } from "../editor/kind-marks";

interface KindBadgeProps extends KindBadgeOptions {
  kind: MarkedKind;
}

/** A kind's badge: a circle in the kind's color with its mark. Same markup as kindBadgeElement. */
export function KindBadge({ kind, proposed }: KindBadgeProps) {
  return <span {...kindBadgeAttributes(kind, { proposed })}>{kindMark(kind)}</span>;
}
