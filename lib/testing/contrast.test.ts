/**
 * WCAG AA contrast on the SPEC §10 tokens, in both themes (US-013 AC-013.5;
 * Milestone 4 P7-U2).
 *
 * The tokens are parsed out of `app/globals.css` rather than duplicated here,
 * so changing a colour changes what this test checks. A `number` on a colour
 * channel is not a money value — the kernel's "never a float" rule is about
 * amounts and rates, and relative luminance is neither.
 *
 * AA is 4.5:1 for body text and 3:1 for large text and UI boundaries
 * (WCAG 2.2, 1.4.3 and 1.4.11). Every pair asserted here is text on a
 * background a screen actually puts it on.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = fs.readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");

/** The declarations of one CSS block, by custom-property name. */
function tokensOf(selector: string): Record<string, string> {
  const start = CSS.indexOf(selector);
  if (start < 0) throw new Error(`contrast: no '${selector}' block in globals.css`);
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("}", open);
  const body = CSS.slice(open + 1, close);
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(--[a-z-]+):\s*([^;]+);/g)) out[name] = value.trim();
  return out;
}

function channel(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`contrast: '${hex}' is not a six-digit hex colour`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** WCAG 2.2 relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = channel(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = {
  light: tokensOf(":root {"),
  dark: tokensOf(':root[data-theme="dark"] {'),
};

/** Foreground × background pairs a screen actually renders, with their AA floor. */
const PAIRS: ReadonlyArray<{ fg: string; bg: string; min: number; what: string }> = [
  { fg: "--text", bg: "--bg", min: 4.5, what: "body text on the page" },
  { fg: "--text", bg: "--bg-subtle", min: 4.5, what: "body text on a subtle band" },
  { fg: "--text", bg: "--surface", min: 4.5, what: "body text on a card" },
  { fg: "--text-muted", bg: "--bg", min: 4.5, what: "muted text on the page" },
  { fg: "--text-muted", bg: "--bg-subtle", min: 4.5, what: "muted text on a subtle band" },
  { fg: "--text-muted", bg: "--surface", min: 4.5, what: "muted text on a card" },
  { fg: "--pos", bg: "--bg", min: 4.5, what: "a gain on the page" },
  { fg: "--pos", bg: "--surface", min: 4.5, what: "a gain on a card" },
  { fg: "--neg", bg: "--bg", min: 4.5, what: "a loss on the page" },
  { fg: "--neg", bg: "--surface", min: 4.5, what: "a loss on a card" },
  { fg: "--accent", bg: "--bg", min: 4.5, what: "a link on the page" },
  { fg: "--accent", bg: "--surface", min: 4.5, what: "a link on a card" },
];

describe("WCAG AA contrast on the §10 tokens", () => {
  for (const [theme, tokens] of Object.entries(THEMES)) {
    describe(theme, () => {
      for (const pair of PAIRS) {
        it(`${pair.what} (${pair.fg} on ${pair.bg}) meets ${pair.min}:1`, () => {
          const ratio = contrastRatio(tokens[pair.fg], tokens[pair.bg]);
          expect(
            Number(ratio.toFixed(2)),
            `${theme}: ${pair.fg} ${tokens[pair.fg]} on ${pair.bg} ${tokens[pair.bg]} is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(pair.min);
        });
      }
    });
  }

  it("the two themes define the same colour tokens", () => {
    const colour = (t: Record<string, string>) =>
      Object.keys(t)
        .filter((k) => /^#/.test(t[k]))
        .sort();
    expect(colour(THEMES.dark)).toEqual(colour(THEMES.light));
  });

  it("the system-preference block matches the explicit dark theme", () => {
    // Three places define dark (`[data-theme="dark"]`, the media query, and
    // nothing else); a token that drifts between them is a theme that changes
    // when you pick "dark" explicitly.
    const media = CSS.slice(CSS.indexOf("@media (prefers-color-scheme: dark)"));
    for (const [name, value] of Object.entries(THEMES.dark)) {
      if (!/^#/.test(value)) continue;
      expect(media, `${name} differs between the media query and [data-theme="dark"]`).toContain(`${name}: ${value};`);
    }
  });
});
