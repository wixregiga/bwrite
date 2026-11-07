/** Original geometric mark: three stacked strokes of decreasing length, offset like indented lines. */
export function Logo() {
  return (
    <svg className="bw-logo" viewBox="0 0 32 32" width="28" height="28" role="img" aria-label="BWrite" focusable="false">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--logo-bg)" />
      <rect x="7" y="8.5" width="18" height="3.5" rx="1.75" fill="var(--logo-fg)" />
      <rect x="11" y="14.25" width="14" height="3.5" rx="1.75" fill="var(--logo-fg)" opacity="0.78" />
      <rect x="15" y="20" width="10" height="3.5" rx="1.75" fill="var(--logo-accent)" />
    </svg>
  );
}
