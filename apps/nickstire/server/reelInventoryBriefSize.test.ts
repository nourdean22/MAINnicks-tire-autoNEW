/**
 * The inventory mirror must fit its TEXT column, and must refuse rather than
 * truncate when it cannot.
 *
 * Live 2026-09-08: the first job to reach ensureReelDraftForJob since the
 * immutable pack snapshot started riding inside the brief (09-07) carried
 * 95,351 bytes into a 65,535-byte column — ER_DATA_TOO_LONG, after the master
 * had already been stored, vaulted and registered. Both directions are pinned:
 * a snapshot-laden brief slims under the limit, and an unslimmable one throws
 * by name instead of writing a blob that parses as nothing.
 */
import { describe, it, expect, vi } from "vitest";
import { ensureReelDraftForJob, inventoryBriefJson, INVENTORY_BRIEF_MAX_BYTES } from "./services/reelInventoryLink";

function fatBrief(): Record<string, unknown> {
  return {
    id: "autopost-2026-09-08",
    topic: "balance vs alignment",
    selectedCaption: "Shaking at highway speed? You might be fixing the wrong thing.",
    storyboardBeats: Array.from({ length: 5 }, (_, i) => ({ beatNumber: i + 1, onScreenText: `BEAT ${i + 1}` })),
    // the bulk: an immutable snapshot with the raw pack text, plus two prompt packs
    approvedProductionPack: { packId: "2026-08-17-balance-vs-alignment", contentSha256: "a".repeat(64), raw: "x".repeat(60_000) },
    promptPack: { beats: Array.from({ length: 5 }, () => ({ prompt: "y".repeat(3_000) })) },
    higgsfieldPromptPack: { beats: Array.from({ length: 5 }, () => ({ prompt: "z".repeat(3_000) })) },
  };
}

describe("inventoryBriefJson", () => {
  it("the unslimmed brief really is over the column limit (positive control)", () => {
    expect(Buffer.byteLength(JSON.stringify(fatBrief()), "utf8")).toBeGreaterThan(INVENTORY_BRIEF_MAX_BYTES);
  });

  it("slims a snapshot-laden brief under the TEXT limit and keeps what the gate reads", () => {
    const json = inventoryBriefJson(fatBrief());
    expect(Buffer.byteLength(json, "utf8")).toBeLessThanOrEqual(INVENTORY_BRIEF_MAX_BYTES);
    const parsed = JSON.parse(json);
    expect(parsed.selectedCaption).toContain("Shaking at highway speed");
    expect(parsed.topic).toBe("balance vs alignment");
    expect(parsed.storyboardBeats).toHaveLength(5);
    expect(parsed.approvedProductionPack).toBeUndefined();
    expect(parsed.promptPack).toBeUndefined();
    expect(parsed.higgsfieldPromptPack).toBeUndefined();
    expect(parsed.inventoryBriefNote).toContain("reel_jobs.payload");
  });

  it("REFUSES by name when even the slimmed brief cannot fit — never a truncated blob", () => {
    const monster = { ...fatBrief(), voiceoverScript: "w".repeat(70_000) };
    expect(() => inventoryBriefJson(monster)).toThrow(/INVENTORY_BRIEF_TOO_LARGE/);
  });

  it("a brief with nothing to strip passes through with the note only", () => {
    const small = { id: "x", topic: "t", selectedCaption: "c" };
    const parsed = JSON.parse(inventoryBriefJson(small));
    expect(parsed.topic).toBe("t");
    expect(Object.keys(parsed).sort()).toEqual(["id", "inventoryBriefNote", "selectedCaption", "topic"]);
  });
});

/**
 * WIRING, not just the seam. The tests above call inventoryBriefJson directly,
 * which stays green even if the insert in ensureReelDraftForJob stops going
 * through it (Codex P2 on #2224). These drive the real `created` branch with a
 * fake drizzle client: the row that reaches .values() must carry the SLIMMED
 * brief, and an unslimmable brief must refuse BEFORE any row is written.
 *
 * Mutation-proven: with the insert changed to `briefJson: JSON.stringify(args.brief)`
 * both wiring tests fail (oversized row written; no refusal). The `updated`
 * control proves the fake actually selects the branch.
 */
function fakeDb(affectedRows: number) {
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values }));
  // drizzle/mysql2 resolves .update() to [ResultSetHeader, FieldPacket[]]
  const where = vi.fn().mockResolvedValue([{ affectedRows }, []]);
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return { db: { update, insert } as unknown as Parameters<typeof ensureReelDraftForJob>[0], values, insert };
}

describe("ensureReelDraftForJob wiring: the mirror insert goes through the size guard", () => {
  it("`created` branch writes the SLIMMED brief, never the raw one", async () => {
    const { db, values } = fakeDb(0);
    const out = await ensureReelDraftForJob(db, { briefId: "autopost-2026-09-08", mp4Url: "https://x/reel.mp4", brief: fatBrief() });
    expect(out).toBe("created");
    expect(values).toHaveBeenCalledTimes(1);
    const row = values.mock.calls[0][0] as Record<string, unknown>;
    expect(row.id).toBe("autopost-2026-09-08");
    expect(row.status).toBe("review_ready");
    expect(row.assetPaths).toEqual(["https://x/reel.mp4"]);
    expect(Buffer.byteLength(String(row.briefJson), "utf8")).toBeLessThanOrEqual(INVENTORY_BRIEF_MAX_BYTES);
    const parsed = JSON.parse(String(row.briefJson));
    expect(parsed.approvedProductionPack).toBeUndefined();
    expect(parsed.promptPack).toBeUndefined();
    expect(parsed.higgsfieldPromptPack).toBeUndefined();
    expect(parsed.inventoryBriefNote).toContain("reel_jobs.payload");
    expect(parsed.selectedCaption).toContain("Shaking at highway speed");
  });

  it("an unslimmable brief is REFUSED through the caller, before any row is written", async () => {
    const { db, values } = fakeDb(0);
    const monster = { ...fatBrief(), voiceoverScript: "w".repeat(70_000) };
    await expect(ensureReelDraftForJob(db, { briefId: "autopost-monster", mp4Url: "https://x/m.mp4", brief: monster })).rejects.toThrow(/INVENTORY_BRIEF_TOO_LARGE/);
    expect(values).not.toHaveBeenCalled();
  });

  it("control: when the UPDATE matches a row nothing is inserted and the serializer is not needed", async () => {
    const { db, insert } = fakeDb(1);
    const out = await ensureReelDraftForJob(db, { briefId: "existing", mp4Url: "https://x/e.mp4", brief: fatBrief() });
    expect(out).toBe("updated");
    expect(insert).not.toHaveBeenCalled();
  });
});
