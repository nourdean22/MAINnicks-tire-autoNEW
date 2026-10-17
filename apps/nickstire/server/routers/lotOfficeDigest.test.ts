/**
 * Office intelligence reads (contract office-digest v1):
 * - lot.conversations rows carry the validated `facts`, not only a count.
 * - lot.officeDigest summarises the last N clock hours from gists + fact kind/value pairs only,
 *   with honest NO_ACTIVITY / THIN / DONE / FAILED states and an in-process memo that never
 *   duplicates an LLM call under the 60 s client poll.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const execute = vi.fn();
vi.mock("../lib/db-helper", () => ({
  db: async () => ({ execute }),
  dbTyped: async () => ({ execute }),
  requireDb: async () => ({ execute }),
}));

vi.mock("../services/officeVisual", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/officeVisual")>()),
  officeVisualColumnReady: vi.fn(async () => false),
  conversationEpisodeColumnReady: vi.fn(async () => true),
}));

const llm = vi.hoisted(() => vi.fn());
vi.mock("../_core/llm", async (orig) => ({ ...(await orig<Record<string, unknown>>()), invokeLLM: llm }));

import { lotRouter } from "./lot";
import type { TrpcContext } from "../_core/context";
import { __resetOfficeDigestMemo } from "../services/officeDigest";

function caller() {
  return lotRouter.createCaller({
    user: { id: 1, openId: "admin", email: "a@b.com", name: "A", loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext);
}

const H = 490_000; // an epoch hour index (2025-11-24 16:00Z); any integer works
const HOUR_MS = 3_600_000;

type Ep = { episodeId: string; hourIdx: number; durationSeconds?: number; gist?: string | null; facts?: unknown };

/** Route the router's two reads: the SQL clock, then the episode rows. */
function dbWith(episodes: Ep[], nowHour = H) {
  execute.mockImplementation(async (q: unknown) => {
    const text = JSON.stringify(q);
    if (text.includes("AS nowHour")) return [[{ nowHour }], []];
    return [episodes.map((e) => ({ durationSeconds: 30, gist: null, facts: null, ...e })), []];
  });
}

function llmReturns(digest: string, topics: string[] = ["brakes"]) {
  return { model: "test-model", choices: [{ message: { content: JSON.stringify({ digest, topics }) } }] };
}

const fact = (kind: string, value: string, evidenceText = "verbatim words", confidence: unknown = 0.9) =>
  ({ kind, value, evidenceSegment: 0, evidenceText, confidence });

beforeEach(() => {
  vi.clearAllMocks();
  __resetOfficeDigestMemo();
  llm.mockResolvedValue(llmReturns("Customer asked about brake work."));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("lot.conversations facts", () => {
  it("returns validated facts (max 12, evidenceText cut to 240) and keeps factCount as stored", async () => {
    const stored = [
      ...Array.from({ length: 13 }, (_, i) => fact("QUOTE", `$${i}0 for a plug`, "x".repeat(300))),
      { kind: "QUOTE" },               // malformed: no value
      "not an object",                 // malformed
      fact("TIRE_SIZE", "205/55R16", "two oh five", "high"), // non-numeric confidence -> null
    ];
    execute.mockResolvedValue([[{
      episodeId: "ep-1", source: "office", transcriptStatus: "DONE", durationSeconds: 40,
      facts: JSON.stringify(stored), summary: null, gist: "Customer asked about a plug",
    }], []]);

    const r = await caller().conversations();
    if (!r.ok) throw new Error("expected ok");
    const row = r.conversations[0];
    expect(row.factCount).toBe(16);
    expect(row.facts).toHaveLength(12);
    expect(row.facts[0]).toEqual({ kind: "QUOTE", value: "$00 for a plug", evidenceText: "x".repeat(240), confidence: 0.9 });
    expect(row.facts.every((f) => typeof f.value === "string" && f.value.length > 0)).toBe(true);
  });

  it("skips malformed entries and keeps a non-numeric confidence as null", async () => {
    execute.mockResolvedValue([[{
      episodeId: "ep-2", source: "office", facts: [{ kind: "QUOTE" }, 7, fact("TIRE_SIZE", "205/55R16", "two oh five", "high")],
    }], []]);
    const r = await caller().conversations();
    if (!r.ok) throw new Error("expected ok");
    expect(r.conversations[0].facts).toEqual([{ kind: "TIRE_SIZE", value: "205/55R16", evidenceText: "two oh five", confidence: null }]);
  });
});

describe("lot.officeDigest", () => {
  it("returns newest-first clock hours with NO_ACTIVITY / THIN / DONE, calling the LLM only for DONE", async () => {
    dbWith([
      { episodeId: "a", hourIdx: H, durationSeconds: 40, gist: "Customer asked when the brakes will be done", facts: [fact("PROMISE", "brakes by 3pm", "SECRET-VERBATIM")] },
      { episodeId: "b", hourIdx: H, durationSeconds: 20 },
      { episodeId: "c", hourIdx: H - 1, durationSeconds: 15 },
    ]);

    const r = await caller().officeDigest({ hours: 3 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.hours.map((h) => h.hourStartMs)).toEqual([H * HOUR_MS, (H - 1) * HOUR_MS, (H - 2) * HOUR_MS]);
    expect(r.hours.map((h) => h.hourEndMs)).toEqual([(H + 1) * HOUR_MS, H * HOUR_MS, (H - 1) * HOUR_MS]);
    expect(r.hours.map((h) => h.isCurrent)).toEqual([true, false, false]);
    expect(r.hours.map((h) => h.status)).toEqual(["DONE", "THIN", "NO_ACTIVITY"]);
    expect(r.hours[0]).toMatchObject({ episodes: 2, talkSeconds: 60, factCount: 1, digest: "Customer asked about brake work.", topics: ["brakes"], error: null });
    expect(r.hours[1]).toMatchObject({ episodes: 1, talkSeconds: 15, factCount: 0, digest: null, topics: [], error: null });
    expect(r.hours[2]).toMatchObject({ episodes: 0, talkSeconds: 0, factCount: 0, digest: null });
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("feeds the LLM gists and fact kind/value only, never evidence text, at temperature 0 with a schema", async () => {
    dbWith([{ episodeId: "a", hourIdx: H, gist: "Customer asked when the brakes will be done", facts: [fact("PROMISE", "brakes by 3pm", "SECRET-VERBATIM")] }]);
    await caller().officeDigest({ hours: 1 });
    const params = llm.mock.calls[0][0];
    const prompt = JSON.stringify(params.messages);
    expect(prompt).toContain("Customer asked when the brakes will be done");
    expect(prompt).toContain("PROMISE");
    expect(prompt).toContain("brakes by 3pm");
    expect(prompt).not.toContain("SECRET-VERBATIM");
    expect(params.temperature).toBe(0);
    expect(params.outputSchema?.schema).toBeTruthy();
  });

  it("excludes selftest captures and buckets in SQL", async () => {
    dbWith([]);
    await caller().officeDigest();
    const episodeQuery = execute.mock.calls.map((c) => JSON.stringify(c[0])).find((t) => !t.includes("AS nowHour")) ?? "";
    expect(episodeQuery).toContain("source <> 'selftest'");
    expect(episodeQuery).toContain("COALESCE(startedAt, createdAt)");
  });

  it("defaults to 6 hours and refuses more than 12", async () => {
    dbWith([]);
    const r = await caller().officeDigest();
    if (!r.ok) throw new Error("expected ok");
    expect(r.hours).toHaveLength(6);
    await expect(caller().officeDigest({ hours: 13 })).rejects.toThrow();
  });

  it("an LLM failure is FAILED with an error that carries no customer text", async () => {
    dbWith([{ episodeId: "a", hourIdx: H - 1, gist: "Customer said the brakes squeal" }]);
    llm.mockRejectedValue(new Error("provider echoed: Customer said the brakes squeal"));
    const r = await caller().officeDigest({ hours: 2 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.hours[1].status).toBe("FAILED");
    expect(r.hours[1].digest).toBeNull();
    expect(r.hours[1].error).toBeTruthy();
    expect(r.hours[1].error).not.toContain("brakes");
  });

  it("an LLM answer without a digest is FAILED, not DONE", async () => {
    dbWith([{ episodeId: "a", hourIdx: H - 1, gist: "Customer asked about tires" }]);
    llm.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ digest: "  ", topics: [] }) } }] });
    const r = await caller().officeDigest({ hours: 2 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.hours[1].status).toBe("FAILED");
  });

  it("a failed DB read is { ok: false }, never an empty hours list", async () => {
    execute.mockRejectedValue(new Error("connect ETIMEDOUT"));
    const r = await caller().officeDigest();
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toBeTruthy();
    expect(r).not.toHaveProperty("hours");
  });

  describe("memo", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-17T15:00:00Z"));
    });

    it("computes a completed hour once", async () => {
      dbWith([{ episodeId: "a", hourIdx: H - 1, gist: "g" }]);
      await caller().officeDigest({ hours: 2 });
      vi.setSystemTime(new Date("2026-10-17T16:00:00Z"));
      const r = await caller().officeDigest({ hours: 2 });
      if (!r.ok) throw new Error("expected ok");
      expect(r.hours[1].status).toBe("DONE");
      expect(llm).toHaveBeenCalledTimes(1);
    });

    it("current hour: same set is reused; a changed set waits 10 minutes; then recomputes", async () => {
      dbWith([{ episodeId: "a", hourIdx: H, gist: "g1" }]);
      await caller().officeDigest({ hours: 1 });
      expect(llm).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date("2026-10-17T15:20:00Z"));
      await caller().officeDigest({ hours: 1 }); // same set, 20 min later
      expect(llm).toHaveBeenCalledTimes(1);

      const t0 = new Date("2026-10-17T15:20:00Z").getTime();
      llm.mockResolvedValue(llmReturns("second digest"));
      dbWith([{ episodeId: "a", hourIdx: H, gist: "g1" }, { episodeId: "b", hourIdx: H, gist: "g2" }]);
      // the first compute was at 15:00, so a change at 15:20 is past the window: recompute now
      let r = await caller().officeDigest({ hours: 1 });
      expect(llm).toHaveBeenCalledTimes(2);
      if (!r.ok) throw new Error("expected ok");
      expect(r.hours[0].digest).toBe("second digest");

      dbWith([{ episodeId: "a", hourIdx: H, gist: "g1" }, { episodeId: "b", hourIdx: H, gist: "g2" }, { episodeId: "c", hourIdx: H, gist: "g3" }]);
      vi.setSystemTime(t0 + 9 * 60_000 + 59_000);
      r = await caller().officeDigest({ hours: 1 }); // changed again inside 10 min: stale result, no call
      expect(llm).toHaveBeenCalledTimes(2);
      if (!r.ok) throw new Error("expected ok");
      expect(r.hours[0].digest).toBe("second digest");
      expect(r.hours[0].episodes).toBe(3);

      vi.setSystemTime(t0 + 10 * 60_000);
      await caller().officeDigest({ hours: 1 });
      expect(llm).toHaveBeenCalledTimes(3);
    });

    it("a gist that arrives later for the same episode counts as a change", async () => {
      dbWith([{ episodeId: "a", hourIdx: H - 1, gist: "g1" }, { episodeId: "b", hourIdx: H - 1, gist: null }]);
      await caller().officeDigest({ hours: 2 });
      dbWith([{ episodeId: "a", hourIdx: H - 1, gist: "g1" }, { episodeId: "b", hourIdx: H - 1, gist: "g2" }]);
      await caller().officeDigest({ hours: 2 });
      expect(llm).toHaveBeenCalledTimes(2);
    });

    it("a FAILED hour is retried at most once per 5 minutes", async () => {
      dbWith([{ episodeId: "a", hourIdx: H - 1, gist: "g" }]);
      llm.mockRejectedValueOnce(new Error("timeout"));
      let r = await caller().officeDigest({ hours: 2 });
      if (!r.ok) throw new Error("expected ok");
      expect(r.hours[1].status).toBe("FAILED");

      vi.setSystemTime(new Date("2026-10-17T15:04:59Z"));
      r = await caller().officeDigest({ hours: 2 });
      if (!r.ok) throw new Error("expected ok");
      expect(r.hours[1].status).toBe("FAILED");
      expect(llm).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date("2026-10-17T15:05:00Z"));
      r = await caller().officeDigest({ hours: 2 });
      if (!r.ok) throw new Error("expected ok");
      expect(r.hours[1].status).toBe("DONE");
      expect(llm).toHaveBeenCalledTimes(2);
    });

    it("concurrent callers share one in-flight LLM call", async () => {
      dbWith([{ episodeId: "a", hourIdx: H, gist: "g" }]);
      let release: (v: unknown) => void = () => {};
      llm.mockImplementation(() => new Promise((res) => { release = res; }));
      const p1 = caller().officeDigest({ hours: 1 });
      const p2 = caller().officeDigest({ hours: 1 });
      await vi.waitFor(() => expect(llm).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 10));
      release(llmReturns("shared"));
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(llm).toHaveBeenCalledTimes(1);
      if (!r1.ok || !r2.ok) throw new Error("expected ok");
      expect(r1.hours[0].digest).toBe("shared");
      expect(r2.hours[0].digest).toBe("shared");
    });
  });
});
