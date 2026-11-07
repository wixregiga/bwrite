/**
 * Random identifier with a readable prefix. Uses getRandomValues, which unlike
 * randomUUID is available outside secure contexts (for example a LAN dev server).
 */
export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${hex}`;
}
