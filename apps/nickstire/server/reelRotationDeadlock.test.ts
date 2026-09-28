/**
 * The deadlock that produced the whole unpublishable backlog, tested by
 * EXECUTION rather than by matching source text.
 *
 * `setApprovedPackProgress` was the only writer of the rotation cursor and is
 * called exclusively inside dailyReelPost's successful-publish branch, so the
 * rotation advanced only when a reel actually reached Instagram:
 *
 *   cursor frozen -> tomorrow regenerates the SAME pack's topic -> the new reel
 *   duplicates the last attempt -> originality refuses it as a repost ->
 *   nothing publishes -> cursor stays frozen.
 *
 * Measured in production 2026-09-07: frozen at index 1
 * (`2026-08-16-check-engine-light`) since the last successful post on
 * 2026-08-29. Jobs 1740001, 1770005 and 1830003 are all that one topic.
 *
 * WHY THIS FILE WAS REWRITTEN. v1 asserted that particular strings appeared in
 * dailyReelPost.ts. Review on #2167 pointed out — correctly, and citing
 * AGENTS.md "assert BEHAVIOUR, never presence" — that such a test stays green
 * if the database write never persists or the helper returns early. The logic
 * now lives in services/approvedReelPackRotation as a pure decision plus a thin
 * writer, and both are executed here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_REEL_SLATE_CURSOR_KEY,
  ACTIVE_REEL_SLATE_KEY,
  APPROVED_REEL_PACK_SLUGS,
  nextRotationIndexAfterRefusal,
  resolveApprovedPackProgressTarget,
} from "./services/approvedReelPackRotation";

const PACK_0 = APPROVED_REEL_PACK_SLUGS[0];
const PACK_1 = APPROVED_REEL_PACK_SLUGS[1];

describe("the decision — exercised, not inspected", () => {
  it("advances past the pack the refused reel came from", () => {
    expect(nextRotationIndexAfterRefusal(PACK_1, 1, PACK_1)).toBe(2);
    expect(nextRotationIndexAfterRefusal(PACK_0, 0, PACK_0)).toBe(1);
  });

  it("holds when the job came from no pack — miner and manifest jobs own no slot", () => {
    expect(nextRotationIndexAfterRefusal(null, 1, PACK_1)).toBeNull();
    expect(nextRotationIndexAfterRefusal(undefined, 1, PACK_1)).toBeNull();
    expect(nextRotationIndexAfterRefusal("", 1, PACK_1)).toBeNull();
  });

  it("holds when the rotation is exhausted or the cursor was malformed", () => {
    // resolveApprovedPackRotationIndex returns null for both, and neither is
    // guessed at — the miner is the authority once the rotation runs out.
    expect(nextRotationIndexAfterRefusal(PACK_1, null, PACK_1)).toBeNull();
  });

  it("holds when the cursor moved while the reel rendered", () => {
    // Advancing here would skip an untouched pack. Same posture as the success
    // path's concurrency guard.
    expect(nextRotationIndexAfterRefusal(PACK_1, 0, PACK_0)).toBeNull();
    expect(nextRotationIndexAfterRefusal(PACK_1, 5, undefined)).toBeNull();
  });

  it("advances AT MOST ONCE per pack — the property that keeps ~100 pulses/day safe", () => {
    // Pulse 1: cursor points at the job's pack, so it moves.
    const afterFirst = nextRotationIndexAfterRefusal(PACK_1, 1, PACK_1);
    expect(afterFirst).toBe(2);
    // Pulse 2: same refused job, but the cursor now points elsewhere. Without
    // this the drain would burn the entire 32-pack rotation in a single day.
    expect(nextRotationIndexAfterRefusal(PACK_1, afterFirst!, APPROVED_REEL_PACK_SLUGS[afterFirst!])).toBeNull();
  });
});

describe("queue provenance — mid-render Strategy changes cannot consume the wrong cursor", () => {
  const revision = "2026-09-27T20:00:00.000Z";
  const active = {
    configured: true,
    slugs: [PACK_1, PACK_0],
    cursor: 0,
    updatedAt: revision,
    malformed: false,
  };

  it("advances the active-slate cursor only when the job carries the same slate revision", () => {
    expect(resolveApprovedPackProgressTarget(PACK_1, 7, active, "active_slate", revision)).toEqual({
      pool: "active_slate",
      currentIndex: 0,
      nextIndex: 1,
      expectedSlug: PACK_1,
    });
    expect(resolveApprovedPackProgressTarget(PACK_1, 7, active, "active_slate", "older-revision")).toBeNull();
  });

  it("holds an active-slate job if the operator cleared the slate while it rendered", () => {
    expect(resolveApprovedPackProgressTarget(
      PACK_1,
      7,
      { configured: false, slugs: [], cursor: null, updatedAt: null, malformed: false },
      "active_slate",
      revision,
    )).toBeNull();
  });

  it("a full-library job never consumes a newly enabled slate even when both point at the same slug", () => {
    expect(resolveApprovedPackProgressTarget(PACK_1, 1, active, "full_approved_library", null)).toEqual({
      pool: "full_approved_library",
      currentIndex: 1,
      nextIndex: 2,
      expectedSlug: PACK_1,
    });
  });

  it("legacy approved-pack jobs remain full-library jobs after the feature is enabled", () => {
    expect(resolveApprovedPackProgressTarget(PACK_1, 1, active)).toEqual({
      pool: "full_approved_library",
      currentIndex: 1,
      nextIndex: 2,
      expectedSlug: PACK_1,
    });
  });
});

/**
 * The writer, against a fake database. This is what a source-matching test
 * could not do: prove the row is actually written, with the right value, and
 * that the one-post-per-day key is never touched.
 */
let dbAvailable = true;
const writes: Array<{ values: Record<string, unknown>; update: Record<string, unknown> }> = [];
let storedCursor: string | null = "1";
let activeSlugs: string[] | null = null;
let activeCursor: string | null = null;
let activeRevision = "2026-09-27T20:00:00.000Z";

const database = {
  select: (projection?: Record<string, unknown>) => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          // readActiveReelSlate projects the key; the full-library cursor read
          // does not. Keep the two durable cursors independently observable.
          if (projection && "key" in projection) {
            if (!activeSlugs) return [];
            return [
              { key: ACTIVE_REEL_SLATE_KEY, value: JSON.stringify({ version: 1, slugs: activeSlugs }), updatedAt: new Date(activeRevision), updatedBy: "owner" },
              ...(activeCursor === null ? [] : [{ key: ACTIVE_REEL_SLATE_CURSOR_KEY, value: activeCursor, updatedAt: new Date(activeRevision), updatedBy: "owner" }]),
            ];
          }
          return storedCursor === null ? [] : [{ value: storedCursor }];
        },
      }),
    }),
  }),
  insert: () => ({
    values: (values: Record<string, unknown>) => ({
      onDuplicateKeyUpdate: async ({ set }: { set: Record<string, unknown> }) => {
        writes.push({ values, update: set });
        if (values.key === ACTIVE_REEL_SLATE_CURSOR_KEY) activeCursor = String(set.value);
        if (values.key === "reel_approved_pack_rotation_index") storedCursor = String(set.value);
      },
    }),
  }),
};

vi.mock("./db", () => ({ getDb: async () => (dbAvailable ? database : null) }));

describe("the write — proven to persist", () => {
  beforeEach(() => {
    writes.length = 0;
    storedCursor = "1";
    activeSlugs = null;
    activeCursor = null;
    activeRevision = "2026-09-27T20:00:00.000Z";
    dbAvailable = true;
  });

  it("writes the next index when the cursor points at the refused job's pack", async () => {
    const { advanceRotationPastRefusedPack } = await import("./services/approvedReelPackRotation");
    const result = await advanceRotationPastRefusedPack({
      jobId: 1740003, jobPackSlug: PACK_1, reason: "repost of published post 123",
    });
    expect(result).toBe(2);
    expect(writes).toHaveLength(1);
    expect(writes[0].values.key).toBe("reel_approved_pack_rotation_index");
    expect(writes[0].update.value).toBe("2");
    expect(storedCursor).toBe("2");
  });

  it("advances ONLY the active-slate cursor when the refused job came from the overlay", async () => {
    storedCursor = "7";
    activeSlugs = [PACK_1, PACK_0];
    activeCursor = "0";
    const { advanceRotationPastRefusedPack } = await import("./services/approvedReelPackRotation");
    const result = await advanceRotationPastRefusedPack({
      jobId: 42,
      jobPackSlug: PACK_1,
      jobPackPool: "active_slate",
      jobSlateRevision: activeRevision,
      reason: "terminal slate refusal",
    });
    expect(result).toBe(1);
    expect(writes).toHaveLength(1);
    expect(writes[0].values.key).toBe(ACTIVE_REEL_SLATE_CURSOR_KEY);
    expect(activeCursor).toBe("1");
    expect(storedCursor).toBe("7");
  });

  it("keeps a pre-slate full-library job on the full-library cursor after Strategy is enabled", async () => {
    storedCursor = "1";
    activeSlugs = [PACK_1, PACK_0];
    activeCursor = "0";
    const { advanceRotationPastRefusedPack } = await import("./services/approvedReelPackRotation");
    const result = await advanceRotationPastRefusedPack({
      jobId: 43,
      jobPackSlug: PACK_1,
      jobPackPool: "full_approved_library",
      reason: "terminal legacy/full-library refusal",
    });
    expect(result).toBe(2);
    expect(writes).toHaveLength(1);
    expect(writes[0].values.key).toBe("reel_approved_pack_rotation_index");
    expect(storedCursor).toBe("2");
    expect(activeCursor).toBe("0");
  });

  it("writes NOTHING when an active-slate job belongs to an older slate revision", async () => {
    storedCursor = "7";
    activeSlugs = [PACK_1, PACK_0];
    activeCursor = "0";
    const { advanceRotationPastRefusedPack } = await import("./services/approvedReelPackRotation");
    const result = await advanceRotationPastRefusedPack({
      jobId: 44,
      jobPackSlug: PACK_1,
      jobPackPool: "active_slate",
      jobSlateRevision: "2026-09-27T19:00:00.000Z",
      reason: "stale slate refusal",
    });
    expect(result).toBeNull();
    expect(writes).toHaveLength(0);
    expect(storedCursor).toBe("7");
    expect(activeCursor).toBe("0");
  });

  it("NEVER stamps reel_autopost_last_date — that would spend the day's post slot", async () => {
    const { advanceRotationPastRefusedPack } = await import("./services/approvedReelPackRotation");
    await advanceRotationPastRefusedPack({ jobId: 1, jobPackSlug: PACK_1, reason: "x" });
    for (const w of writes) {
      expect(w.values.key).not.toBe("reel_autopost_last_date");
      expect(JSON.stringify(w)).not.toContain("reel_autopost_last_date");
    }
  });

  it("writes NOTHING when the cursor already moved on", async () => {
    storedCursor = "5";
    const { advanceRotationPastRefusedPack } = await import("./services/approvedReelPackRotation");
    const result = await advanceRotationPastRefusedPack({
      jobId: 1, jobPackSlug: PACK_1, reason: "cursor moved",
    });
    expect(result).toBeNull();
    expect(writes).toHaveLength(0);
    expect(storedCursor).toBe("5");
  });

  it("writes NOTHING for a job that came from no pack", async () => {
    const { advanceRotationPastRefusedPack } = await import("./services/approvedReelPackRotation");
    expect(await advanceRotationPastRefusedPack({ jobId: 1, jobPackSlug: null, reason: "miner job" })).toBeNull();
    expect(writes).toHaveLength(0);
  });

  it("writes NOTHING when the cursor is malformed — a bad value is never guessed at", async () => {
    storedCursor = "not-a-number";
    const { advanceRotationPastRefusedPack } = await import("./services/approvedReelPackRotation");
    expect(await advanceRotationPastRefusedPack({ jobId: 1, jobPackSlug: PACK_1, reason: "x" })).toBeNull();
    expect(writes).toHaveLength(0);
  });

  it("writes NOTHING when there is no database", async () => {
    dbAvailable = false;
    const { advanceRotationPastRefusedPack } = await import("./services/approvedReelPackRotation");
    expect(await advanceRotationPastRefusedPack({ jobId: 1, jobPackSlug: PACK_1, reason: "x" })).toBeNull();
    expect(writes).toHaveLength(0);
  });
});

describe("every TERMINAL refusal routes through it, and no transient one does", () => {
  /**
   * These four are wiring assertions and are honestly labelled as such: the
   * call sites live inside a 1,100-line cron handler whose runtime path needs a
   * database, a rendered asset and a live Instagram call. The BEHAVIOUR they
   * delegate to is executed above; this only proves the delegation exists at
   * the right branches.
   *
   * The disclosure site was added after review on #2167 pointed out that a
   * disclosure veto is computed from the persisted caption and on-screen text,
   * so it re-derives identically on retry and pinned the rotation exactly the
   * way a repost did.
   */
  const SRC = new URL("./cron/jobs/dailyReelPost.ts", import.meta.url);

  it("fires on all four terminal verdicts", async () => {
    const src = await (await import("node:fs/promises")).readFile(SRC, "utf8");
    const calls = src.split("await advancePastRefusedPack(").slice(1).map((s) => s.slice(0, 80));
    expect(calls).toHaveLength(4);
    const joined = calls.join(" | ");
    expect(joined).toContain("repost of");
    expect(joined).toContain("condemned script (content)");
    expect(joined).toContain("claim audit veto");
    expect(joined).toContain("disclosure veto");
  });

  it("does NOT fire while awaiting human approval — that hold is the system working", async () => {
    const src = await (await import("node:fs/promises")).readFile(SRC, "utf8");
    const idx = src.indexOf("held: awaiting human approval");
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, idx - 1400), idx)).not.toContain("advancePastRefusedPack");
  });

  it("does NOT fire on a rendered-QA hold — auto-repair can still clear it", async () => {
    const src = await (await import("node:fs/promises")).readFile(SRC, "utf8");
    const idx = src.indexOf("held by rendered-QA gate");
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, idx - 1400), idx)).not.toContain("advancePastRefusedPack");
  });

  it("the absence assertions are not vacuous — the same window around a terminal refusal DOES contain it", async () => {
    const src = await (await import("node:fs/promises")).readFile(SRC, "utf8");
    const idx = src.indexOf("duplicates ${dupe.label}");
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, idx - 1400), idx)).toContain("advancePastRefusedPack");
  });
});
