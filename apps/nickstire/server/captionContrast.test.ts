/**
 * CAPTION CONTRAST, MEASURED FROM THE STYLE THE RENDERER BURNS IN (2026-10-08).
 *
 * The 2026-10-08 control-gates review (creative-intelligence-os/README.md §Z,
 * item 12) listed caption contrast as "not measured". It can be measured
 * without rendering a frame: every burned-in caption is drawn with fixed
 * colours, so the WCAG contrast ratio of the text against what touches it is a
 * property of the style, not of the footage.
 *
 * What touches the text: drawtext captions (reelAssembly.ts) draw a 6 px black
 * stroke around every glyph and a 60%-black box behind the line; the word-timed
 * ASS captions (reelVoice.ts, BorderStyle 3) sit in an opaque box. So the
 * binding numbers are the fill against its stroke or box (what the eye reads
 * at the glyph edge) and, for the translucent box, the fill against that box
 * over the WORST footage behind it (pure white or pure black).
 *
 * Bars: 7:1 for the fill against its stroke or opaque box (WCAG AAA), 3:1 for
 * the fill against the translucent box over any footage (WCAG AA, large text:
 * these captions are 60-90 px on a 1080 px frame). These are bounds computed
 * from the configured colours, not pixel samples of a rendered Reel.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ASSEMBLY = readFileSync(path.join(__dirname, "services", "reelAssembly.ts"), "utf8");
const VOICE = readFileSync(path.join(__dirname, "services", "reelVoice.ts"), "utf8");

type Rgb = [number, number, number];
const NAMED: Record<string, Rgb> = { black: [0, 0, 0], white: [255, 255, 255] };

const hex = (h: string): Rgb => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** A box of `color` at `opacity` composited over `under`. */
const over = (color: Rgb, opacity: number, under: Rgb): Rgb =>
  color.map((c, i) => Math.round(c * opacity + under[i] * (1 - opacity))) as Rgb;

interface DrawtextStyle { fill: Rgb; stroke: Rgb; strokeWidth: number; box: Rgb; boxOpacity: number }

function drawtextStyles(src: string): DrawtextStyle[] {
  const re = /fontcolor=0x([0-9A-Fa-f]{6}):borderw=(\d+):bordercolor=(\w+):box=1:boxcolor=(\w+)@([0-9.]+)/g;
  return [...src.matchAll(re)].map((m) => ({
    fill: hex(m[1]),
    strokeWidth: Number(m[2]),
    stroke: NAMED[m[3]] ?? [-1, -1, -1],
    box: NAMED[m[4]] ?? [-1, -1, -1],
    boxOpacity: Number(m[5]),
  }));
}

/** Worst contrast of the fill against its translucent box over white and over black footage. */
const worstBoxContrast = (s: DrawtextStyle) =>
  Math.min(contrast(s.fill, over(s.box, s.boxOpacity, NAMED.white)), contrast(s.fill, over(s.box, s.boxOpacity, NAMED.black)));

describe("burned-in captions (drawtext) keep their contrast on any footage", () => {
  const styles = drawtextStyles(ASSEMBLY);

  it("the scan read the renderer's caption styles (beat captions and the SAVE card)", () => {
    expect(styles.length).toBeGreaterThanOrEqual(2);
    for (const s of styles) expect(s.stroke[0], "an unknown stroke colour name").toBeGreaterThanOrEqual(0);
  });

  it("the fill against its stroke clears 7:1, and against the box over white or black clears 3:1", () => {
    for (const s of styles) {
      expect(s.strokeWidth).toBeGreaterThanOrEqual(4);
      expect(contrast(s.fill, s.stroke)).toBeGreaterThanOrEqual(7);
      expect(worstBoxContrast(s)).toBeGreaterThanOrEqual(3);
    }
    // The measured values, so a palette change shows what it costs: gold 0xFDB913
    // on black is 12.1:1; on the 60% box over white footage it is 3.3:1.
    expect(contrast(hex("FDB913"), NAMED.black)).toBeCloseTo(12.1, 1);
    expect(worstBoxContrast(styles[0])).toBeCloseTo(3.31, 1);
  });

  it("CONTROL: a style that would fail is failed — white text, thin box, no dark stroke", () => {
    const weak: DrawtextStyle = { fill: hex("FFFFFF"), stroke: NAMED.white, strokeWidth: 0, box: NAMED.black, boxOpacity: 0.2 };
    expect(contrast(weak.fill, weak.stroke)).toBeLessThan(7);
    expect(worstBoxContrast(weak)).toBeLessThan(3);
  });
});

describe("word-timed ASS captions keep their contrast", () => {
  it("BorderStyle 3 draws an opaque box in the outline colour, and the fill clears 7:1 against it", () => {
    const style = VOICE.match(/Style: Default,[^,]+,\d+,&H([0-9A-Fa-f]{8}),&H[0-9A-Fa-f]{8},&H([0-9A-Fa-f]{8}),&H[0-9A-Fa-f]{8},(?:-?\d+,){4}\d+,\d+,\d+,\d+,(\d)/);
    expect(style, "ASS Default style not found — anchor moved").not.toBeNull();
    // ASS colours are &HAABBGGRR; alpha 00 is opaque.
    const abgr = (v: string) => ({ alpha: parseInt(v.slice(0, 2), 16), rgb: [parseInt(v.slice(6, 8), 16), parseInt(v.slice(4, 6), 16), parseInt(v.slice(2, 4), 16)] as Rgb });
    const fill = abgr(style![1]);
    const box = abgr(style![2]);
    expect(style![3]).toBe("3");
    expect(fill.rgb).toEqual(hex("FDB913"));
    expect(box.alpha).toBe(0);
    expect(contrast(fill.rgb, box.rgb)).toBeGreaterThanOrEqual(7);
  });
});
