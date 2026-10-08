import { describe, expect, it } from "vitest";
import {
  APPROVED_REEL_PACKS,
  APPROVED_REEL_PACK_SLUGS,
  approvedReelPackAt,
  approvedReelPackAtFromPool,
  buildBriefFromApprovedProductionPack,
  clearActiveReelSlate,
  loadApprovedProductionPack,
  normalizeActiveReelSlateSlugs,
  parseApprovedPackRotationIndex,
  readActiveReelSlate,
  resolveApprovedPackRotationIndex,
  resolveApprovedPackSelection,
  writeActiveReelSlate,
} from "./services/approvedReelPackRotation";
import { askLeakageProblem, askProblem, askSignals, type ReelAsk } from "../shared/reelAsk";
import { declaredBeatSource } from "../shared/shotRouter";

describe("approved Reel-pack rotation", () => {
  it("contains every explicitly approved pack exactly once", () => {
    expect(APPROVED_REEL_PACKS).toHaveLength(APPROVED_REEL_PACK_SLUGS.length);
    expect(new Set(APPROVED_REEL_PACK_SLUGS).size).toBe(APPROVED_REEL_PACK_SLUGS.length);
  });

  it("uses the reviewed chronological order and a generator-safe topic", () => {
    expect(approvedReelPackAt(0)).toEqual({
      slug: "2026-08-16-wheel-bearing-hum",
      topic: "wheel bearing hum",
    });
    const last = APPROVED_REEL_PACKS[APPROVED_REEL_PACKS.length - 1];
    expect(last).toBeDefined();
    expect(approvedReelPackAt(APPROVED_REEL_PACKS.length - 1)).toEqual(last);
  });

  it("does not wrap completed or invalid rotations back to the first pack", () => {
    expect(approvedReelPackAt(-1)).toBeNull();
    expect(approvedReelPackAt(APPROVED_REEL_PACKS.length)).toBeNull();
    expect(approvedReelPackAt(Number.NaN)).toBeNull();
    expect(parseApprovedPackRotationIndex("0")).toBe(0);
    expect(parseApprovedPackRotationIndex(String(APPROVED_REEL_PACKS.length - 1))).toBe(APPROVED_REEL_PACKS.length - 1);
    expect(parseApprovedPackRotationIndex(String(APPROVED_REEL_PACKS.length))).toBe(APPROVED_REEL_PACKS.length);
    expect(parseApprovedPackRotationIndex(null)).toBeNull();
    expect(parseApprovedPackRotationIndex("nope")).toBeNull();
    expect(parseApprovedPackRotationIndex("-1")).toBeNull();
  });

  it("uses the first pack for an absent cursor in both selection and completion", () => {
    expect(resolveApprovedPackRotationIndex(null)).toBe(0);
    expect(resolveApprovedPackRotationIndex("0")).toBe(0);
    expect(resolveApprovedPackRotationIndex("nope")).toBeNull();
  });

  it("uses a configured active slate in exact operator order and never falls through after exhaustion", () => {
    const a = APPROVED_REEL_PACK_SLUGS[0];
    const b = APPROVED_REEL_PACK_SLUGS[1];
    expect(approvedReelPackAtFromPool(0, [b, a])?.slug).toBe(b);
    expect(approvedReelPackAtFromPool(1, [b, a])?.slug).toBe(a);
    expect(resolveApprovedPackSelection(73, { configured: true, slugs: [b, a], cursor: 0, malformed: false })).toMatchObject({
      state: "active_slate",
      index: 0,
      pack: { slug: b },
    });
    // The slate cursor is independent from the full-library cursor.
    expect(resolveApprovedPackSelection(73, { configured: true, slugs: [b, a], cursor: 1, malformed: false })).toMatchObject({
      state: "active_slate",
      index: 1,
      pack: { slug: a },
    });
    expect(resolveApprovedPackSelection(73, { configured: true, slugs: [b, a], cursor: 2, malformed: false })).toEqual({
      state: "slate_exhausted",
      pack: null,
      index: 2,
    });
    expect(resolveApprovedPackSelection(73, { configured: true, slugs: [b, a], cursor: 0, malformed: true })).toEqual({
      state: "slate_malformed",
      pack: null,
      index: null,
    });
    // A malformed/missing FULL-LIBRARY cursor must not break a valid overlay.
    expect(resolveApprovedPackSelection(null, { configured: true, slugs: [b, a], cursor: 0, malformed: false })).toMatchObject({
      state: "active_slate",
      index: 0,
      pack: { slug: b },
    });
  });

  it("normalizes active-slate input without admitting unknown or duplicate packs", () => {
    const first = APPROVED_REEL_PACK_SLUGS[0];
    const second = APPROVED_REEL_PACK_SLUGS[1];
    expect(normalizeActiveReelSlateSlugs([first, "not-approved", first, second, 42])).toEqual([first, second]);
    expect(normalizeActiveReelSlateSlugs(APPROVED_REEL_PACK_SLUGS.slice(0, 30))).toHaveLength(24);
  });

  it("keeps legacy approved-library selection only when no active slate exists", () => {
    const resolved = resolveApprovedPackSelection(7, { configured: false, slugs: [], cursor: null, malformed: false });
    expect(resolved.state).toBe("full_approved_library");
    expect(resolved.index).toBe(7);
    expect(resolved.pack?.slug).toBe(APPROVED_REEL_PACK_SLUGS[7]);
  });

  it("saves the slate and resets ONLY its overlay cursor in the same transaction", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const tx = {
      insert: () => ({
        values: (values: Record<string, unknown>) => ({
          onDuplicateKeyUpdate: async () => { writes.push(values); },
        }),
      }),
    };
    const database = { transaction: async (fn: (inner: typeof tx) => Promise<void>) => fn(tx) };
    const a = APPROVED_REEL_PACK_SLUGS[0];
    const b = APPROVED_REEL_PACK_SLUGS[1];
    const result = await writeActiveReelSlate(database as never, [b, a], "owner@example.com");
    expect(writes).toHaveLength(2);
    expect(writes[0].key).toBe("reel_active_slate_json");
    const saved = JSON.parse(String(writes[0].value));
    expect(saved.slugs).toEqual([b, a]);
    expect(saved.updatedAt).toBe(result.updatedAt);
    expect(writes[1]).toMatchObject({ key: "reel_active_slate_cursor", value: "0" });
    expect(writes.some((w) => w.key === "reel_approved_pack_rotation_index")).toBe(false);
    expect(result.cursor).toBe(0);
  });

  it("uses the payload revision so re-saving the same slate still invalidates older in-flight jobs", async () => {
    const a = APPROVED_REEL_PACK_SLUGS[0];
    const payloadRevision = "2026-09-27T20:00:00.000Z";
    const rowRevision = "2026-09-27T19:00:00.000Z";
    const database = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              {
                key: "reel_active_slate_json",
                value: JSON.stringify({ version: 1, slugs: [a], updatedAt: payloadRevision }),
                updatedAt: new Date(rowRevision),
                updatedBy: "owner",
              },
              {
                key: "reel_active_slate_cursor",
                value: "0",
                updatedAt: new Date(rowRevision),
                updatedBy: "owner",
              },
            ],
          }),
        }),
      }),
    };
    const result = await readActiveReelSlate(database as never);
    expect(result.updatedAt).toBe(payloadRevision);
    expect(result.malformed).toBe(false);
  });

  it("fails closed on a malformed explicit slate revision", async () => {
    const a = APPROVED_REEL_PACK_SLUGS[0];
    const database = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              {
                key: "reel_active_slate_json",
                value: JSON.stringify({ version: 1, slugs: [a], updatedAt: "not-a-date" }),
                updatedAt: new Date("2026-09-27T19:00:00.000Z"),
                updatedBy: "owner",
              },
              { key: "reel_active_slate_cursor", value: "0", updatedAt: new Date(), updatedBy: "owner" },
            ],
          }),
        }),
      }),
    };
    const result = await readActiveReelSlate(database as never);
    expect(result.malformed).toBe(true);
  });

  it("refuses unknown or duplicate slate entries instead of silently dropping them", async () => {
    const a = APPROVED_REEL_PACK_SLUGS[0];
    let transactionCalled = false;
    const database = {
      transaction: async () => { transactionCalled = true; },
    };
    await expect(writeActiveReelSlate(database as never, [a, a], "owner@example.com"))
      .rejects.toThrow(/unknown, duplicate, or over-limit/);
    await expect(writeActiveReelSlate(database as never, [a, "not-approved"], "owner@example.com"))
      .rejects.toThrow(/unknown, duplicate, or over-limit/);
    expect(transactionCalled).toBe(false);
  });

  it("disables the overlay without moving the full approved-library cursor", async () => {
    let deleted = false;
    const writes: Array<Record<string, unknown>> = [];
    const tx = {
      delete: () => ({ where: async () => { deleted = true; } }),
      insert: () => ({
        values: (values: Record<string, unknown>) => ({
          onDuplicateKeyUpdate: async () => { writes.push(values); },
        }),
      }),
    };
    const database = { transaction: async (fn: (inner: typeof tx) => Promise<void>) => fn(tx) };
    const result = await clearActiveReelSlate(database as never, "owner@example.com");
    expect(deleted).toBe(true);
    expect(writes).toEqual([]);
    expect(result.cursor).toBeNull();
  });

  it("preserves the reviewed pack snapshot instead of handing only its topic downstream", () => {
    const pack = approvedReelPackAt(0)!;
    const snapshot = loadApprovedProductionPack(pack.slug);
    expect(snapshot?.packId).toBe(pack.slug);
    expect(snapshot?.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    const brief = snapshot && buildBriefFromApprovedProductionPack(pack, snapshot, "autopost-test");
    expect(brief?.approvedPackSlug).toBe(pack.slug);
    expect(brief?.selectedCaption).toEqual(expect.any(String));
    expect((brief?.storyboardBeats as unknown[]).length).toBeGreaterThanOrEqual(4);
    expect((brief?.sourceNotes as Array<{ kind?: string }>).some((note) => note.kind === "proof")).toBe(true);
  });

  it("gives every currently approved tracked pack a proof-shaped source note", () => {
    for (const pack of APPROVED_REEL_PACKS) {
      const snapshot = loadApprovedProductionPack(pack.slug);
      expect(snapshot, pack.slug).not.toBeNull();
      const brief = snapshot && buildBriefFromApprovedProductionPack(pack, snapshot, `autopost-${pack.slug}`);
      expect(brief, pack.slug).not.toBeNull();
      expect((brief?.sourceNotes as Array<{ kind?: string }>).some((note) => note.kind === "proof"), pack.slug).toBe(true);
    }
  });
});

// Codex review of #2930 (2026-10-08): the declared shot source died in the
// production builder, and the three proof packs carried two asks and an
// unverified duration in their captions.
describe("proof packs and the declared beat source", () => {
  const PROOF = [
    "2026-10-08-proof-01-uneven-wear",
    "2026-10-08-proof-02-highway-shake",
    "2026-10-08-proof-03-patch-or-replace",
  ] as const;
  type Snapshot = NonNullable<ReturnType<typeof loadApprovedProductionPack>>;
  const build = (slug: string, snapshot: Snapshot) =>
    buildBriefFromApprovedProductionPack({ slug: slug as (typeof APPROVED_REEL_PACK_SLUGS)[number], topic: "" }, snapshot, `test-${slug}`);
  const beatsOf = (snapshot: Snapshot) => snapshot.parsed.storyboardBeats as Array<Record<string, unknown>>;

  it("a declared source survives the production builder and reaches the route check; a stray or absent one does not appear", () => {
    const base = loadApprovedProductionPack(PROOF[0])!;
    const beats = beatsOf(base).map((b) => ({ ...b }));
    // Beat 1's visual is tagged REAL: a field that DISAGREES with the tag proves the field arrived.
    beats[0].source = "still_motion";
    beats[1].source = " Deterministic ";
    beats[2].source = "REALLY";
    const out = build(PROOF[0], { ...base, parsed: { ...base.parsed, storyboardBeats: beats } })!.storyboardBeats as Array<Record<string, unknown>>;
    expect(out[0].source).toBe("still_motion");
    expect(declaredBeatSource(out[0] as { visual?: string; source?: never })).toBe("still_motion");
    expect(out[1].source).toBe("deterministic");
    expect("source" in out[2]).toBe(false);
    expect("source" in out[3]).toBe(false);
    // Control: the committed pack declares no field, so the builder adds none and the tag still reads.
    const plain = build(PROOF[0], base)!.storyboardBeats as Array<Record<string, unknown>>;
    expect(plain.some((b) => "source" in b)).toBe(false);
    expect(declaredBeatSource(plain[0] as { visual?: string })).toBe("real");
  });

  it("each proof pack declares one ask, and its caption, beats and voiceover ask for nothing else", () => {
    for (const slug of PROOF) {
      const snapshot = loadApprovedProductionPack(slug)!;
      const brief = build(slug, snapshot)!;
      const ask = brief.ask as ReelAsk;
      expect(ask, slug).toEqual({ kind: "visit" });
      expect(askProblem(ask), slug).toBeNull();
      expect(askLeakageProblem({
        beats: beatsOf(snapshot).map((b) => String(b.onScreenText ?? "")),
        voiceoverScript: String(snapshot.parsed.voiceoverScript ?? ""),
        caption: String(brief.selectedCaption),
        declaredAsk: ask,
      }), slug).toBeNull();
    }
    // Control: the caption the review flagged fails the same check against the same ask.
    expect(askLeakageProblem({
      caption: "An inspection says which. Comment TREAD or book an inspection — Nick's Tire & Auto, Euclid Ave, Cleveland.",
      declaredAsk: { kind: "visit" },
    })).toMatch(/comment-keyword/);
  });

  // Codex review of #2932: askSignals has no pattern for the shop's own imperatives,
  // so "GET IT CHECKED" in a beat passed the check above while the end card asked
  // STOP BY NICK'S: two asks, one of them burned into pixels and audio. These are
  // the editorial contract's CTA verbs plus the visit phrasing.
  it("no proof pack beat, narration or voiceover carries a call to action; the end card is the one ask", () => {
    const SHOP_CTA = /\b(book|call|comment|dm|visit|bring|get it checked|schedule|tap|message us|stop by|come in)\b/i;
    for (const [old, line] of [["ONE EDGE WORN? GET IT CHECKED", "beat"], ["Bring the tire; we look inside first.", "voiceover"]]) {
      expect(SHOP_CTA.test(old), `control: the removed ${line} is a CTA`).toBe(true);
      expect(askSignals(old), `control: the production detector alone misses the removed ${line}`).toEqual([]);
    }
    for (const slug of PROOF) {
      const snapshot = loadApprovedProductionPack(slug)!;
      const surfaces = [
        String(snapshot.parsed.voiceoverScript ?? ""),
        ...beatsOf(snapshot).flatMap((b) => [String(b.onScreenText ?? ""), String(b.narration ?? "")]),
      ];
      for (const text of surfaces) expect(SHOP_CTA.test(text), `${slug}: ${text}`).toBe(false);
    }
  });

  it("no proof pack promises a duration the shop has not verified", () => {
    const duration = /\b\d+[- ]?(?:minute|min|hour|hr)s?\b/i;
    expect(duration.test("A 10-minute inspection says which.")).toBe(true); // control: the removed phrase
    for (const slug of PROOF) {
      const snapshot = loadApprovedProductionPack(slug)!;
      const copy = [snapshot.parsed.selectedCaption, snapshot.parsed.voiceoverScript, ...beatsOf(snapshot).map((b) => b.onScreenText)].join(" ");
      expect(duration.test(copy), slug).toBe(false);
    }
  });
});
