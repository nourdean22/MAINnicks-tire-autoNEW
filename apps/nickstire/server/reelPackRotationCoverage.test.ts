/**
 * Usable packs must not pile up outside the rotation.
 *
 * THE FAILURE THIS CATCHES. Scheduled runs write production packs to
 * `docs/reel-packs/` continuously, but the pipeline reaches a pack only through
 * `APPROVED_REEL_PACK_SLUGS`, a hand-maintained array. Nothing connected the
 * two, so the array stayed at 32 while the directory grew to 164 — and on
 * 2026-09-07, **67 packs that the production builder accepts were sitting
 * unreachable**. No gate, no log, no report said so; "not in rotation" and
 * "nobody looked" were indistinguishable.
 *
 * This makes them distinguishable. A pack the builder accepts must be either in
 * the rotation or in ROTATION_EXCLUDED with a written reason. Silence is no
 * longer a passing state.
 *
 * WHAT IT CANNOT CHECK, stated rather than implied: originality needs the live
 * published corpus and therefore a database, so it is not asserted here. That
 * is survivable specifically because a terminally-refused pack now advances the
 * cursor past itself (089823177) — a repost that slips into the rotation ejects
 * itself on first attempt instead of jamming it.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPROVED_REEL_PACK_SLUGS,
  ROTATION_EXCLUDED,
  buildApprovedPackBriefForTest,
} from "./services/approvedReelPackRotation";

const PACKS_DIR = path.join(__dirname, "..", "docs", "reel-packs");

/** Every pack directory carrying a brief.json. */
function packsOnDisk(): string[] {
  if (!fs.existsSync(PACKS_DIR)) return [];
  return fs
    .readdirSync(PACKS_DIR)
    .filter((d) => /^\d{4}-\d{2}-\d{2}-/.test(d) && fs.existsSync(path.join(PACKS_DIR, d, "brief.json")))
    .sort();
}

/** Packs the PRODUCTION builder accepts — the only definition of usable that matters. */
function usablePacks(): string[] {
  return packsOnDisk().filter((slug) => buildApprovedPackBriefForTest(slug) !== null);
}

describe("every usable pack is either rotating or explicitly excluded", () => {
  it("finds packs on disk at all — a zero here would make the whole suite vacuous", () => {
    // Without this, a wrong PACKS_DIR turns every assertion below into a
    // no-op that passes. The directory had 164 briefs on 2026-09-07.
    expect(packsOnDisk().length).toBeGreaterThan(100);
    expect(usablePacks().length).toBeGreaterThan(50);
  });

  it("no usable pack is left out of the rotation without a reason", () => {
    const rotating = new Set<string>(APPROVED_REEL_PACK_SLUGS as readonly string[]);
    const orphaned = usablePacks().filter((s) => !rotating.has(s) && !(s in ROTATION_EXCLUDED));
    expect(
      orphaned,
      `${orphaned.length} pack(s) the builder accepts are unreachable — add them to ` +
        `APPROVED_REEL_PACK_SLUGS (append, never reorder: the cursor is an index) or to ` +
        `ROTATION_EXCLUDED with a reason:\n  ${orphaned.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every exclusion carries a real reason", () => {
    for (const [slug, reason] of Object.entries(ROTATION_EXCLUDED)) {
      expect(reason.trim().length, `${slug} is excluded with no reason`).toBeGreaterThan(20);
    }
  });

  it("nothing is both rotating and excluded", () => {
    const rotating = new Set<string>(APPROVED_REEL_PACK_SLUGS as readonly string[]);
    for (const slug of Object.keys(ROTATION_EXCLUDED)) {
      expect(rotating.has(slug), `${slug} is in both lists`).toBe(false);
    }
  });
});

describe("the rotation array's own invariants", () => {
  it("has no duplicate slugs — a repeat would post the same pack twice per cycle", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const slug of APPROVED_REEL_PACK_SLUGS) {
      if (seen.has(slug)) dupes.push(slug);
      seen.add(slug);
    }
    expect(dupes).toEqual([]);
  });

  it("every rotating slug exists on disk and is loadable", () => {
    const missing = (APPROVED_REEL_PACK_SLUGS as readonly string[]).filter(
      (s) => buildApprovedPackBriefForTest(s) === null,
    );
    expect(
      missing,
      `these are in the rotation but the builder cannot produce a brief from them, so the ` +
        `daily job would fall through to the miner on their turn:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("keeps the first 32 in their original order — the cursor is an index into this array", () => {
    // The operator set the cursor by hand to 2 on 2026-09-07. Reordering the
    // head would silently repoint it at a different pack.
    expect(APPROVED_REEL_PACK_SLUGS[0]).toBe("2026-08-16-wheel-bearing-hum");
    expect(APPROVED_REEL_PACK_SLUGS[1]).toBe("2026-08-16-check-engine-light");
    expect(APPROVED_REEL_PACK_SLUGS[2]).toBe("2026-08-17-balance-vs-alignment");
    expect(APPROVED_REEL_PACK_SLUGS[31]).toBe("2026-08-19-wont-start-battery-starter-alternator");
  });

  it("grew — 32 was the stalled state, not the intended one", () => {
    expect(APPROVED_REEL_PACK_SLUGS.length).toBeGreaterThan(90);
  });
});
