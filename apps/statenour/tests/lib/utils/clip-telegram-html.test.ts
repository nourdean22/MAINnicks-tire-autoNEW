/**
 * Telegram rejects a parse_mode "HTML" message with a 400 ("can't parse entities") when a
 * cut lands inside an entity (`&am`) or leaves a tag open (`<b>` with no `</b>`), and then
 * NOTHING is delivered. The webhook cut long replies with a raw `.slice(0, 3900)` (/brief
 * among them). clipTelegramHtml cuts without breaking the markup.
 */
import { describe, expect, it } from "vitest";

import { clipTelegramHtml } from "@/lib/utils/escape-html";

describe("clipTelegramHtml", () => {
  it("short text passes through untouched", () => {
    expect(clipTelegramHtml("<b>Brief</b> &amp; more", 3900)).toBe("<b>Brief</b> &amp; more");
  });

  it("a cut inside an entity drops the partial entity (the /brief case)", () => {
    const text = "x".repeat(10) + "Tires &amp; brakes";
    const out = clipTelegramHtml(text, 19); // raw slice ends "...Tires &am"
    expect(text.slice(0, 19)).toMatch(/&am$/);
    expect(out).not.toMatch(/&[a-z#0-9]*$/i);
    expect(out.length).toBeLessThanOrEqual(19);
  });

  it("a cut inside a tag drops the partial tag", () => {
    const out = clipTelegramHtml("Revenue <b>$1,240</b>", 10); // raw slice "Revenue <b"
    expect(out).toBe("Revenue");
  });

  it("an open tag at the cut is closed, so Telegram can parse it", () => {
    const out = clipTelegramHtml("<b>Goals</b> · 6 active\n<i>A long italic line that runs past the cut</i>", 40);
    expect(out.endsWith("</i>")).toBe(true);
    expect((out.match(/<i>/g) ?? []).length).toBe((out.match(/<\/i>/g) ?? []).length);
    expect(out.length).toBeLessThanOrEqual(40);
  });

  it("a link tag left open is closed too", () => {
    const out = clipTelegramHtml('<a href="https://bdnick.info/stats">open the goals page now please</a>', 50);
    expect(out.endsWith("</a>")).toBe(true);
  });
});
