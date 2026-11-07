// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KindBadge } from "./kind-badge";
import { TERM_KINDS } from "../domain/term-kind";
import {
  MARKED_KINDS,
  UNCLASSIFIED,
  kindBadgeClassName,
  kindBadgeElement,
  kindBadgeLabel,
  kindHighlightClassName,
  kindMark,
  kindName,
  kindTermClassName,
  kindTextClassName,
  type MarkedKind,
} from "../editor/kind-marks";

/* ---------------------------------------------------------------- color math */

type Rgb = readonly [number, number, number];
type Lab = readonly [number, number, number];

function parseHex(hex: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!match) throw new Error(`not a 6 digit hex color: "${hex}"`);
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

/** sRGB channel (0..255) to linear light, per IEC 61966-2-1 and WCAG 2.2. */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.2 relative luminance. */
function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG 2.2 contrast ratio, from 1 to 21. */
function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** sRGB to CIE L*a*b* under D65 (white point X 0.95047, Y 1, Z 1.08883). */
function toLab(rgb: Rgb): Lab {
  const [r, g, b] = rgb.map(linearize);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const RAD = Math.PI / 180;
const POW25_7 = 25 ** 7;

/** Hue angle in degrees in [0, 360); zero when both components are zero (Sharma et al. 2005, eq. 7). */
function hueAngle(b: number, aPrime: number): number {
  if (b === 0 && aPrime === 0) return 0;
  const h = Math.atan2(b, aPrime) / RAD;
  return h < 0 ? h + 360 : h;
}

/** CIEDE2000 colour difference, kL = kC = kH = 1, as specified in Sharma, Wu and Dalal (2005), section 3. */
function ciede2000([L1, a1, b1]: Lab, [L2, a2, b2]: Lab): number {
  const meanC = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(meanC ** 7 / (meanC ** 7 + POW25_7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = hueAngle(b1, a1p);
  const h2p = hueAngle(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * RAD) / 2);

  const meanL = (L1 + L2) / 2;
  const meanCp = (C1p + C2p) / 2;
  let meanhp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) meanhp /= 2;
    else if (h1p + h2p < 360) meanhp = (meanhp + 360) / 2;
    else meanhp = (meanhp - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos((meanhp - 30) * RAD) +
    0.24 * Math.cos(2 * meanhp * RAD) +
    0.32 * Math.cos((3 * meanhp + 6) * RAD) -
    0.2 * Math.cos((4 * meanhp - 63) * RAD);
  const dTheta = 30 * Math.exp(-(((meanhp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(meanCp ** 7 / (meanCp ** 7 + POW25_7));
  const Sl = 1 + (0.015 * (meanL - 50) ** 2) / Math.sqrt(20 + (meanL - 50) ** 2);
  const Sc = 1 + 0.045 * meanCp;
  const Sh = 1 + 0.015 * meanCp * T;
  const Rt = -Math.sin(2 * dTheta * RAD) * Rc;

  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

/* ------------------------------------------------------------ file parsing */

const ROOT = resolve(__dirname, "../../../..");
const kindsCss = readFileSync(resolve(ROOT, "src/app/styles/kinds.css"), "utf8");
const appCss = readFileSync(resolve(ROOT, "src/app/styles/styles.css"), "utf8");

/** Custom properties declared in the first `:root` block of a stylesheet. */
function rootProperties(css: string): Map<string, string> {
  const block = /:root\s*\{([^}]*)\}/.exec(css);
  if (!block) throw new Error("no :root block");
  const properties = new Map<string, string>();
  for (const m of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) properties.set(m[1], m[2].trim());
  return properties;
}

/** The declarations block of the rule whose selector is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css);
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1];
}

/** Reads a color declaration of a rule and resolves `var(--name)` through the stylesheet's :root. */
function declaredColor(css: string, selector: string, property: string): Rgb {
  const root = rootProperties(css);
  const declaration = new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+);`).exec(ruleBody(css, selector));
  if (!declaration) throw new Error(`${selector} declares no ${property}`);
  const value = declaration[1].trim();
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  const resolved = ref ? root.get(ref[1]) : value;
  if (resolved === undefined) throw new Error(`${selector} ${property} refers to undeclared ${value}`);
  return parseHex(resolved);
}

const rootVars = rootProperties(kindsCss);

function kindColor(kind: MarkedKind): Rgb {
  const value = rootVars.get(`--kind-${kind}`);
  if (value === undefined) throw new Error(`kinds.css declares no --kind-${kind}`);
  return parseHex(value);
}

function kindTint(kind: MarkedKind): Rgb {
  const value = rootVars.get(`--kind-${kind}-tint`);
  if (value === undefined) throw new Error(`kinds.css declares no --kind-${kind}-tint`);
  return parseHex(value);
}

const WHITE: Rgb = [255, 255, 255];
const AA_TEXT = 4.5;
const MIN_DELTA_E = 20;

/** The surfaces a term can sit on, each read from src/app/styles/styles.css. */
const BACKGROUNDS: readonly { name: string; color: Rgb }[] = [
  { name: "page (body)", color: declaredColor(appCss, "body", "background-color") },
  { name: "editor panel (.bw-editor-card)", color: declaredColor(appCss, ".bw-editor-card", "background") },
  { name: "editor text area (.bw-editor-host)", color: declaredColor(appCss, ".bw-editor-host", "background") },
];

/* -------------------------------------------------------------------- tests */

describe("color math against Sharma, Wu and Dalal (2005), CIEDE2000 test data, Table 1", () => {
  // [pair number in the published table, Lab1, Lab2, published dE00 to four decimals]
  const published: readonly [number, Lab, Lab, number][] = [
    [1, [50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [2, [50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [3, [50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [7, [50, 0, 0], [50, -1, 2], 2.3669],
    [9, [50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [13, [50, 2.5, 0], [50, 0, -2.5], 4.3065],
    [17, [50, 2.5, 0], [73, 25, -18], 27.1492],
    [18, [50, 2.5, 0], [61, -5, 29], 22.8977],
    [19, [50, 2.5, 0], [56, -27, -3], 31.903],
    [20, [50, 2.5, 0], [58, 24, 15], 19.4535],
  ];

  it.each(published)("pair %i matches the published value", (_pair, lab1, lab2, expected) => {
    expect(ciede2000(lab1, lab2)).toBeCloseTo(expected, 4);
    expect(ciede2000(lab2, lab1)).toBeCloseTo(expected, 4);
  });

  it("converts sRGB to Lab under D65 (white, black, and a mid red)", () => {
    const [Lw, aw, bw] = toLab([255, 255, 255]);
    expect(Lw).toBeCloseTo(100, 2);
    expect(aw).toBeCloseTo(0, 2);
    expect(bw).toBeCloseTo(0, 2);
    expect(toLab([0, 0, 0])[0]).toBeCloseTo(0, 6);
    // sRGB (255, 0, 0) is L 53.2408, a 80.0925, b 67.2032 in the Lindbloom D65 reference.
    const [Lr, ar, br] = toLab([255, 0, 0]);
    expect(Lr).toBeCloseTo(53.2408, 2);
    expect(ar).toBeCloseTo(80.0925, 1);
    expect(br).toBeCloseTo(67.2032, 1);
  });

  it("computes WCAG contrast: black on white is 21, equal colors are 1", () => {
    expect(contrastRatio([0, 0, 0], WHITE)).toBeCloseTo(21, 6);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 6);
    // WCAG's published example: #777777 on white is 4.48 (just under AA), #767676 is 4.54.
    expect(contrastRatio([0x77, 0x77, 0x77], WHITE)).toBeCloseTo(4.48, 2);
    expect(contrastRatio([0x76, 0x76, 0x76], WHITE)).toBeCloseTo(4.54, 2);
  });
});

describe("kind colors in src/app/styles/kinds.css", () => {
  it("declares a color and a tint for every term kind and for unclassified", () => {
    for (const kind of MARKED_KINDS) {
      expect(rootVars.get(`--kind-${kind}`), `--kind-${kind}`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(rootVars.get(`--kind-${kind}-tint`), `--kind-${kind}-tint`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("covers every ArcLint term kind plus unclassified, and nothing else", () => {
    expect([...MARKED_KINDS]).toEqual([...TERM_KINDS, UNCLASSIFIED]);
    const declared = [...rootVars.keys()]
      .filter((name) => /^--kind-[a-z_]+$/.test(name) && !name.startsWith("--kind-badge") && !name.startsWith("--kind-ring") && !name.startsWith("--kind-underline"))
      .map((name) => name.slice("--kind-".length));
    expect(declared.sort()).toEqual([...MARKED_KINDS].sort());
  });

  it("keeps the backgrounds it is measured against readable from src/app/styles/styles.css", () => {
    expect(BACKGROUNDS).toHaveLength(3);
    for (const { color } of BACKGROUNDS) expect(color).toHaveLength(3);
  });

  describe.each([...MARKED_KINDS])("%s", (kind) => {
    it("has WCAG AA contrast (at least 4.5:1) under white letters", () => {
      expect(contrastRatio(kindColor(kind), WHITE)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("has WCAG AA contrast (at least 4.5:1) as text on every background", () => {
      for (const { name, color } of BACKGROUNDS) {
        expect(contrastRatio(kindColor(kind), color), name).toBeGreaterThanOrEqual(AA_TEXT);
      }
    });

    it("has WCAG AA contrast (at least 4.5:1) as text on its own highlight tint", () => {
      expect(contrastRatio(kindColor(kind), kindTint(kind))).toBeGreaterThanOrEqual(AA_TEXT);
    });
  });

  it("keeps every pair of kind colors at CIEDE2000 distance of at least 20", () => {
    const pairs: string[] = [];
    let minimum = Infinity;
    for (let i = 0; i < MARKED_KINDS.length; i++) {
      for (let j = i + 1; j < MARKED_KINDS.length; j++) {
        const delta = ciede2000(toLab(kindColor(MARKED_KINDS[i])), toLab(kindColor(MARKED_KINDS[j])));
        minimum = Math.min(minimum, delta);
        if (delta < MIN_DELTA_E) pairs.push(`${MARKED_KINDS[i]} / ${MARKED_KINDS[j]}: ${delta.toFixed(2)}`);
      }
    }
    expect(pairs).toEqual([]);
    expect(minimum).toBeGreaterThanOrEqual(MIN_DELTA_E);
  });

  it("styles every kind through its own color in each component class", () => {
    for (const kind of MARKED_KINDS) {
      expect(ruleBody(kindsCss, `.bw-kind-badge--${kind}`)).toContain(`var(--kind-${kind})`);
      expect(ruleBody(kindsCss, `.bw-kind-text--${kind}`)).toContain(`var(--kind-${kind})`);
      const highlight = ruleBody(kindsCss, `.bw-kind-highlight--${kind}`);
      expect(highlight).toContain(`var(--kind-${kind}-tint)`);
      expect(highlight).toContain(`var(--kind-${kind})`);
    }
  });

  it("defines the proposed ring and the contrast and forced-colors adaptations", () => {
    expect(ruleBody(kindsCss, ".bw-kind-badge--proposed")).toContain("dashed");
    expect(kindsCss).toMatch(/@media \(prefers-contrast: more\)/);
    const forced = /@media \(forced-colors: active\)\s*\{([\s\S]*)$/.exec(kindsCss);
    expect(forced?.[1]).toMatch(/\.bw-kind-badge\s*\{[^}]*border:[^;]*CanvasText/);
  });

  it("does not repeat a kind color outside :root", () => {
    const outsideRoot = kindsCss.replace(/:root\s*\{[^}]*\}/, "");
    for (const kind of MARKED_KINDS) {
      expect(outsideRoot.toLowerCase()).not.toContain(String(rootVars.get(`--kind-${kind}`)).toLowerCase());
    }
  });
});

describe("kind marks", () => {
  it("gives every kind a mark of one or two characters", () => {
    for (const kind of MARKED_KINDS) {
      const mark = kindMark(kind);
      expect(mark.length, kind).toBeGreaterThanOrEqual(1);
      expect(mark.length, kind).toBeLessThanOrEqual(2);
    }
  });

  it("keeps marks unique", () => {
    const marks = MARKED_KINDS.map(kindMark);
    expect(new Set(marks).size).toBe(marks.length);
  });

  it("never uses the kind's full word as its mark", () => {
    for (const kind of MARKED_KINDS) {
      expect(kindMark(kind).toLowerCase()).not.toBe(kindName(kind).toLowerCase());
    }
  });

  it("labels kinds with ArcLint's concept titles and marks proposed terms", () => {
    expect(kindBadgeLabel("domain_event")).toBe("Domain Event");
    expect(kindBadgeLabel("value_object", { proposed: true })).toBe("Proposed Value Object");
    expect(kindBadgeLabel(UNCLASSIFIED)).toBe("Unclassified");
  });
});

describe("KindBadge and kindBadgeElement render identically", () => {
  function reactBadge(kind: MarkedKind, proposed: boolean): Element {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(createElement(KindBadge, { kind, proposed }));
    expect(host.children).toHaveLength(1);
    return host.children[0];
  }

  function attributesOf(element: Element): Record<string, string> {
    return Object.fromEntries([...element.attributes].map((a) => [a.name, a.value]).sort());
  }

  const cases = MARKED_KINDS.flatMap((kind) => [
    [kind, false] as const,
    [kind, true] as const,
  ]);

  it.each(cases)("%s (proposed: %s) has the same classes, text and attributes", (kind, proposed) => {
    const fromReact = reactBadge(kind, proposed);
    const fromDom = kindBadgeElement(kind, { proposed });
    expect([...fromReact.classList].sort()).toEqual([...fromDom.classList].sort());
    expect(fromReact.textContent).toBe(fromDom.textContent);
    expect(fromDom.textContent).toBe(kindMark(kind));
    expect(attributesOf(fromReact)).toEqual(attributesOf(fromDom));
    expect(fromReact.outerHTML).toBe(fromDom.outerHTML);
  });

  it("exposes the kind to assistive technology and marks proposed terms", () => {
    const badge = kindBadgeElement("domain_service", { proposed: true });
    expect(badge.getAttribute("role")).toBe("img");
    expect(badge.getAttribute("aria-label")).toBe("Proposed Domain Service");
    expect(badge.getAttribute("aria-hidden")).toBeNull();
    expect(badge.classList.contains("bw-kind-badge--proposed")).toBe(true);
    expect(kindBadgeElement("domain_service").classList.contains("bw-kind-badge--proposed")).toBe(false);
  });

  it("builds the element in the document it is given", () => {
    const other = document.implementation.createHTMLDocument("other");
    expect(kindBadgeElement("entity", {}, other).ownerDocument).toBe(other);
  });

  it("only emits classes that kinds.css defines", () => {
    const defined = new Set([...kindsCss.matchAll(/\.(bw-kind-[\w-]+)/g)].map((m) => m[1]));
    for (const kind of MARKED_KINDS) {
      const classes = [
        ...kindBadgeClassName(kind, { proposed: true }).split(" "),
        ...kindTextClassName(kind).split(" "),
        ...kindHighlightClassName(kind).split(" "),
        ...kindTermClassName(kind).split(" "),
      ];
      for (const name of classes) expect(defined.has(name), name).toBe(true);
    }
  });
});
