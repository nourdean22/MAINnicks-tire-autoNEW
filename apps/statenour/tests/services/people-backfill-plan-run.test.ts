/**
 * People W1 --plan survives a failure (2026-10-30). The first full --plan run
 * digested 24 conversations, then a DB connect timed out and the process
 * exited with no plan file: 24 model calls lost. Now:
 *  - progress (ids, kind and times only) is saved after every conversation;
 *  - --resume <progress file> skips what is done;
 *  - a crash or a 3-failure stop returns "partial" with the saved progress,
 *    and only a complete run produces the plan file and its token.
 */
import { describe, expect, it, vi } from "vitest";

import { parseApplyArgs } from "@/lib/services/people/backfill-apply";
import { emptyProgress, parseProgress, runPlanLoop, serializeProgress } from "@/lib/services/people/backfill-plan-run";
import type { PlannedChatRow } from "@/lib/services/people/backfill-plan";

const cand = (id: string) => ({ conversationId: id, firstMatchAt: new Date("2026-06-01T10:00:00Z") });
const row = (conv: string): PlannedChatRow => ({
  personId: "p1",
  conversationId: conv,
  start: new Date("2026-06-01T10:00:00Z"),
  at: new Date("2026-06-01T11:00:00Z"),
  interactionKind: "call",
  backfillKey: `bf:chat:${conv}:p1`,
});
const skipped0 = { mentionOnly: 0, unmatched: 0, alreadyLogged: 0, duplicate: 0 };
const noPause = async () => {};

describe("runPlanLoop", () => {
  it("digests every candidate, saving progress after each one", async () => {
    const save = vi.fn();
    const out = await runPlanLoop({
      candidates: [cand("c1"), cand("c2"), cand("c3")],
      progress: emptyProgress(),
      digestOne: async (c) => ({ rows: [row(c.conversationId)], skipped: skipped0 }),
      save,
      pause: noPause,
    });
    expect(out.status).toBe("complete");
    expect(out.progress.done).toEqual(["c1", "c2", "c3"]);
    expect(out.progress.rows.map((r) => r.conversationId)).toEqual(["c1", "c2", "c3"]);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it("a thrown error mid-run keeps everything digested before it", async () => {
    const save = vi.fn();
    const out = await runPlanLoop({
      candidates: [cand("c1"), cand("c2"), cand("c3")],
      progress: emptyProgress(),
      digestOne: async (c) => {
        if (c.conversationId === "c2") throw new Error("Connection terminated due to connection timeout");
        return { rows: [row(c.conversationId)], skipped: skipped0 };
      },
      save,
      pause: noPause,
    });
    expect(out.status).toBe("partial");
    expect(out.reason).toMatch(/connection timeout/);
    expect(out.progress.done).toEqual(["c1"]);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ done: ["c1"] }));
  });

  it("resume skips the conversations already done", async () => {
    const digestOne = vi.fn(async (c: { conversationId: string }) => ({ rows: [row(c.conversationId)], skipped: skipped0 }));
    const start = { ...emptyProgress(), done: ["c1"], rows: [row("c1")] };
    const out = await runPlanLoop({ candidates: [cand("c1"), cand("c2")], progress: start, digestOne, save: vi.fn(), pause: noPause });
    expect(digestOne).toHaveBeenCalledTimes(1);
    expect(digestOne.mock.calls[0][0].conversationId).toBe("c2");
    expect(out.status).toBe("complete");
    expect(out.progress.rows.map((r) => r.conversationId)).toEqual(["c1", "c2"]);
  });

  it("stops after 3 provider failures in a row; a too-short conversation is done, not a failure", async () => {
    const out = await runPlanLoop({
      candidates: ["s", "f1", "f2", "f3", "c9"].map(cand),
      progress: emptyProgress(),
      digestOne: async (c) => (c.conversationId === "s" ? "too_short" : "failed"),
      save: vi.fn(),
      pause: noPause,
    });
    expect(out.status).toBe("partial");
    expect(out.reason).toMatch(/3 digest failures in a row/);
    expect(out.progress.done).toEqual(["s"]);
    expect(out.progress.digestFailed).toBe(3);
  });

  it("a failure that is not retried is not marked done, so a resume tries it again", async () => {
    const out = await runPlanLoop({
      candidates: [cand("f1"), cand("c2")],
      progress: emptyProgress(),
      digestOne: async (c) => (c.conversationId === "f1" ? "failed" : { rows: [], skipped: skipped0 }),
      save: vi.fn(),
      pause: noPause,
    });
    expect(out.status).toBe("partial");
    expect(out.reason).toMatch(/1 conversation could not be digested/);
    expect(out.progress.done).toEqual(["c2"]);
  });
});

describe("progress file", () => {
  it("round-trips, and holds ids, kind and times only", () => {
    const p = { ...emptyProgress(), done: ["c1"], rows: [row("c1")], digestFailed: 1, skipped: { ...skipped0, unmatched: 2 } };
    const text = serializeProgress(p);
    expect(parseProgress(text)).toEqual(p);
    expect(Object.keys(JSON.parse(text).rows[0]).sort()).toEqual(
      ["at", "backfillKey", "conversationId", "interactionKind", "personId", "start"],
    );
  });

  it("refuses a file that is not a progress file", () => {
    expect(() => parseProgress("[]")).toThrow(/progress/);
    expect(() => parseProgress(JSON.stringify({ version: 1, done: "c1", rows: [] }))).toThrow(/progress/);
  });
});

describe("parseApplyArgs --resume", () => {
  it("--plan takes an optional --resume <progress file>", () => {
    expect(parseApplyArgs(["--plan", "--out", "p.json"])).toMatchObject({ mode: "plan", out: "p.json", resume: null });
    expect(parseApplyArgs(["--plan", "--out", "p.json", "--resume", "p.json.progress.json"])).toMatchObject({
      mode: "plan",
      resume: "p.json.progress.json",
    });
    expect(() => parseApplyArgs(["--plan", "--out", "p.json", "--resume"])).toThrow(/--resume/);
  });
});
