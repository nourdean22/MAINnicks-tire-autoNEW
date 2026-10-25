import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error plain .mjs module, no type declarations
import { classifyPack } from "./reelTriageClassify.mjs";

/**
 * An AIRED pack is a record of a reel already posted. Triage must call it "aired", never "dead"
 * (blocked) and never a draft that regeneration could pick up again.
 */
const opts = { hasCaptions: true, hasBrief: false };
const AIRED_LINE = "AIRED: 2026-10-25 instagram 18048091778822545";
const PACKS = ["2026-10-25-warmth-reviews", "2026-10-25-mount-balance-torque"];

describe("classifyPack: aired marker", () => {
  it("positive control: a blocked pack is still dead and a plain still pack is still publishable", () => {
    expect(classifyPack("BLOCKED: NO MOTION ROUTE", opts).status).toBe("dead");
    expect(classifyPack("stills only", opts).status).toBe("publishable");
  });

  it("an AIRED line wins over the blocked and generated-video checks", () => {
    const r = classifyPack(`${AIRED_LINE}\nBLOCKED: NO MOTION ROUTE\nuses Higgsfield generated video`, opts);
    expect(r.status).toBe("aired");
    expect(r.blockReason).toMatch(/aired/i);
  });

  it("the marker must start a line; a mention in prose does not count", () => {
    expect(classifyPack("the AIRED: marker is described here", opts).status).not.toBe("aired");
  });

  it.each(PACKS)("the committed README of %s lands in aired", (dir) => {
    const txt = readFileSync(join(__dirname, "../../docs/reel-packs", dir, "README.md"), "utf8");
    expect(txt).toMatch(/^AIRED: 2026-10-25 instagram \d+/m);
    expect(classifyPack(txt, opts).status).toBe("aired");
  });
});
