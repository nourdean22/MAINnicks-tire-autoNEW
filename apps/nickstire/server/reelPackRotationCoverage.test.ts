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
 *
 * REACHABLE IS NOT THE SAME AS SHIPPABLE — review P1 on #2169, and the number
 * it corrects was mine. "The builder accepts it" was used as the definition of
 * usable, and a count built on it (50) was reported as shippable. The real
 * pre-spend gate is `runReelPreflight`, which is strictly stronger, and through
 * it the honest count is **2 of 99**. Same defect shape as the one in the
 * header: a weaker instrument reporting a clean result was mistaken for the
 * strong one passing.
 *
 * Both properties are now asserted, separately, because they fail for different
 * reasons and want different fixes:
 *   · REACHABILITY — is a usable pack wired into the rotation at all? (a code
 *     defect; fixed by editing the array)
 *   · ENQUEUEABILITY — would preflight let it reserve paid generation? (a
 *     CONTENT defect; fixed by editing briefs)
 * A pack can be perfectly reachable and still never spend a credit. Until this
 * ran, nothing in the repo could tell those two apart.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runReelPreflight } from "../client/src/lib/facelessReelStudio";
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

/**
 * RATCHET. Raise as briefs are fixed; never lower it WITHOUT recording why.
 *
 * 2026-09-07, first measurement: 2 of 99.
 * 2026-09-07, after `maxSeconds` 22 -> 35 (operator decision): the length gate
 *   stopped refusing 95 packs and the count rose to 30.
 * 2026-09-07, after `validateVoiceoverFitsRender` landed: back to **1**.
 *
 * THE DROP TO 1 IS THE POINT, not a regression. Raising the ceiling exposed a
 * defect the ceiling had been hiding: 93 of the 99 packs carry more narration
 * than their own reel can PLAY. Assembly clamps every beat to one ~4s provider
 * clip, so a 5-beat pack renders ~20s of video, and the ffmpeg graph forces the
 * voice track to exactly that length — the rest is cut off mid-sentence. The
 * worst pack has 121 words (~55s of speech) for a 27s video.
 *
 * Before the ceiling moved, those packs were refused for being 25-35s and the
 * truncation never came up. So the honest reading is not "the change lost a
 * pack" but "the change revealed that ~all of the library was unshippable for
 * a second, worse reason, and only one pack was ever genuinely clean".
 * `2026-08-20-slow-leak-soap-test` is the one that moved: 56 words (~25.5s)
 * against 19s of renderable video.
 *
 * 2026-09-07, after the voiceover trim: **31**. All 93 over-long scripts were
 * rewritten to their per-pack budget, so the voiceover blocker is gone from the
 * histogram entirely. It also took `no-free-claims` from 39 to 24 as a side
 * effect — several scripts carried the word only in the sentences that were cut.
 *
 * 2026-09-07, after the blocker sweep: **99 of 99**. Every remaining class was
 * cleared - 38 mechanic truths written from each pack's own teaching content,
 * 28 in-frame-text and 5 faceless visuals recast as physical objects, 20 claim
 * rewordings, 19 storyboards merged into the 4-6 beat band, 2 malformed beat
 * indices, and 8 top-level voiceover scripts re-synced to their merged beats.
 *
 * THE FLOOR IS NOW THE WHOLE ROTATION, which changes what a failure means: any
 * drop is a REGRESSION in a pack that shipped clean, not a pack that was never
 * fixed. The failure message still prints the blocking histogram, so the first
 * line of a red run names the class and the pack.
 */
// 2026-09-25: evening import added 23 distinct packs; the reconciled midday
// import adds 11 more distinct lessons after removing 16 semantic duplicates.
// The full rotation must remain preflight-clean; never lower the floor because
// a pack broke. 2026-10-08: 133 -> 99 because 34 packs LEFT the rotation (the
// two 2026-09-25 imports, every beat a placeholder that names no object; see
// ROTATION_EXCLUDED), not because one stopped passing: all 99 that remain pass.
const PREFLIGHT_PASSING_FLOOR = 99;

/** Packs that clear the REAL pre-spend gate, not merely the builder. */
function preflightVerdicts() {
  const passing: string[] = [];
  const blockers = new Map<string, number>();
  for (const slug of APPROVED_REEL_PACK_SLUGS) {
    const brief = buildApprovedPackBriefForTest(slug);
    if (!brief) continue;
    const report = runReelPreflight(brief);
    if (report.status === "pass") {
      passing.push(slug);
      continue;
    }
    for (const f of report.blocking) {
      // Normalise the varying parts so the histogram groups by CAUSE, not by
      // the particular second or beat number that tripped it.
      const key = f.message
        .replace(/beat \d+/gi, "beat N")
        .replace(/\d+(\.\d+)?s/g, "Ns")
        .replace(/\d+/g, "N")
        .slice(0, 80);
      blockers.set(key, (blockers.get(key) ?? 0) + 1);
    }
  }
  return { passing, blockers };
}

describe("reachable is not shippable — the pre-spend gate is the real one", () => {
  it("at least the measured number of packs still clears preflight", () => {
    const { passing, blockers } = preflightVerdicts();
    const histogram = [...blockers.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, n]) => `  ${String(n).padStart(3)}x  ${reason}`)
      .join("\n");
    expect(
      passing.length,
      `${passing.length} of ${APPROVED_REEL_PACK_SLUGS.length} rotating packs clear ` +
        `runReelPreflight (floor ${PREFLIGHT_PASSING_FLOOR}).\n` +
        `Passing: ${passing.join(", ") || "(none)"}\n` +
        `Blocking causes, by pack count:\n${histogram}\n` +
        `If you FIXED briefs, raise PREFLIGHT_PASSING_FLOOR. If this DROPPED, a ` +
        `brief edit broke a pack that used to ship.`,
    ).toBeGreaterThanOrEqual(PREFLIGHT_PASSING_FLOOR);
  });

  it("the preflight actually ran — a silent zero would look identical to a clean sweep", () => {
    // The instrument must be shown to FIRE. This used to assert that SOME pack
    // fails, on the reasoning that an all-green sweep is indistinguishable from
    // a probe reading nothing. That was true while packs were failing and is
    // now simply wrong: the sweep cleared every blocker, so the "some pack must
    // fail" half asserted a defect that no longer exists.
    //
    // The property that still matters is that the probe READ the whole
    // rotation, so pin the count against the array itself rather than against
    // zero. A misread directory or an unbuildable brief shows up here as a
    // shortfall, and the deliberate-break canary below supplies the other half
    // of the proof — that a blocking verdict is still reachable at all.
    const { passing } = preflightVerdicts();
    expect(APPROVED_REEL_PACK_SLUGS.length, "the rotation itself went empty").toBeGreaterThan(90);
    expect(
      passing.length,
      `only ${passing.length} of ${APPROVED_REEL_PACK_SLUGS.length} packs were read — the probe is ` +
        `not seeing the whole rotation`,
    ).toBe(APPROVED_REEL_PACK_SLUGS.length);
  });

  it("canary — preflight really would refuse a defective brief", () => {
    // Positive control for the assertions above. Take a pack that PASSES today
    // and break one rule; preflight must flip to "block". Without this, a
    // preflight that returned "pass" unconditionally would score green.
    const { passing } = preflightVerdicts();
    const good = buildApprovedPackBriefForTest(passing[0]);
    expect(good, "the ratchet names a pack the builder cannot build").not.toBeNull();
    expect(runReelPreflight(good!).status).toBe("pass");
    const broken = { ...good!, mechanicTruth: "   " };
    const verdict = runReelPreflight(broken);
    expect(verdict.status, "preflight passed a brief with no mechanic truth").toBe("block");
    expect(verdict.blocking.some((f) => /mechanic truth/i.test(f.message))).toBe(true);
  });
});
