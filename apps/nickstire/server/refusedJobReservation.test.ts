/**
 * A Reel refused before any provider call gives its generation budget back
 * (Codex review on #2933, 2026-10-08).
 *
 * enqueueReelJob reserves `reel_job_<id>` in generation_reservations, and
 * spendSinceUsd counts reserved rows as spend. The two refusals that run after
 * the claim but before generation (a condemned script, a beat declared real or
 * deterministic) used to release only the content-governor slot, so the
 * reservation sat as "spent" until the 6 h stale sweep and could turn later
 * Reels away at the daily budget. A job resumed with clips already bought keeps
 * the conservative estimate as its spend record, as every other failure does.
 *
 * Drives the real processNextReelJob through the harness of
 * reelProviderFallbackChain.test.ts and asserts the ledger transition itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbState = vi.hoisted(() => ({
  jobRow: null as null | { id: number; payload: string; status: string; attempts: number; clipUrlsJson: string | null },
  updateCalls: [] as Array<{ set: Record<string, unknown> }>,
}));

vi.mock("../drizzle/schema", () => ({ reelJobs: {} }));

vi.mock("./db", () => ({
  getDb: async () => ({
    select: (proj?: Record<string, unknown>) => {
      const isPayloadOnly = Boolean(proj) && Object.keys(proj as object).length === 1 && "payload" in (proj as object);
      const value = () =>
        !dbState.jobRow ? [] : isPayloadOnly ? [{ payload: dbState.jobRow.payload }] : [dbState.jobRow];
      return {
        from: () => ({
          where: () => {
            const p = Promise.resolve(value());
            return Object.assign(p, {
              orderBy: () => Object.assign(Promise.resolve(value()), { limit: () => Promise.resolve(value()) }),
              limit: () => Promise.resolve(value()),
            });
          },
        }),
      };
    },
    update: () => ({
      set: (setObj: Record<string, unknown>) => ({
        where: () => {
          dbState.updateCalls.push({ set: setObj });
          if (dbState.updateCalls.length === 1) return Promise.resolve([{ affectedRows: 1 }]);
          return Promise.resolve([{}]);
        },
      }),
    }),
  }),
}));

vi.mock("./storage", () => ({
  assertDurableStorageForGeneration: () => {},
  storagePut: async () => "https://cdn.example/clip.mp4",
}));

const submitVeoRequest = vi.hoisted(() => vi.fn());
vi.mock("./services/veoStudio", () => ({
  submitVeoRequest,
  pollVeoOperation: async () => { throw new Error("should not be reached"); },
  downloadAndRehostVeoVideo: async () => { throw new Error("should not be reached"); },
  veoCredentialsPresent: () => true,
}));

const ledger = vi.hoisted(() => ({
  release: vi.fn(async () => {}),
  fail: vi.fn(async () => {}),
  settle: vi.fn(async () => {}),
}));
vi.mock("./services/generationLedger", () => ({
  release: ledger.release,
  fail: ledger.fail,
  settle: ledger.settle,
  reelClipCostUsd: () => 1.5,
}));

vi.mock("./services/telegram", () => ({ sendTelegram: vi.fn(async () => {}) }));

import { processNextReelJob } from "./services/reelPipeline";

const ENV_KEYS = ["REEL_GENERATION_ENABLED", "REEL_VIDEO_PROVIDER"];
const saved: Record<string, string | undefined> = {};

function job(payload: Record<string, unknown>, clipUrls: string[] | null = null) {
  dbState.jobRow = {
    id: 7,
    payload: JSON.stringify({ topic: "tread depth", ...payload }),
    status: "queued",
    attempts: 0,
    clipUrlsJson: clipUrls ? JSON.stringify(clipUrls) : null,
  };
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.REEL_GENERATION_ENABLED = "true";
  process.env.REEL_VIDEO_PROVIDER = "veo";
  dbState.updateCalls = [];
  submitVeoRequest.mockReset();
  ledger.release.mockClear();
  ledger.fail.mockClear();
  ledger.settle.mockClear();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("a refusal before any provider call releases the generation reservation", () => {
  it("a beat declared real, nothing generated yet: released, not counted as spend", async () => {
    job({ storyboardBeats: [{ beatNumber: 1, visual: "REAL: gauge on the inner tread", source: "real" }] });
    const res = await processNextReelJob();
    expect(res.status).toBe("failed");
    expect(submitVeoRequest).not.toHaveBeenCalled();
    expect(ledger.release).toHaveBeenCalledWith("reel_job_7");
    expect(ledger.fail).not.toHaveBeenCalled();
  });

  it("a condemned script, nothing generated yet: released the same way", async () => {
    job({
      voiceoverScript: "That little Check Engine light isn't just a suggestion. In Ohio, it's an automatic fail for your E-Check.",
      storyboardBeats: [{ beatNumber: 1, visual: "a dashboard" }],
    });
    const res = await processNextReelJob();
    expect(res.status).toBe("failed");
    expect(submitVeoRequest).not.toHaveBeenCalled();
    expect(ledger.release).toHaveBeenCalledWith("reel_job_7");
    expect(ledger.fail).not.toHaveBeenCalled();
  });

  it("a resumed job that already bought clips keeps the estimate as its spend record (fail, not release)", async () => {
    job(
      {
        storyboardBeats: [
          { beatNumber: 1, visual: "a tire" },
          { beatNumber: 2, visual: "REAL: the customer's tread", source: "real" },
        ],
      },
      ["https://cdn.example/beat1.mp4"],
    );
    const res = await processNextReelJob();
    expect(res.status).toBe("failed");
    expect(submitVeoRequest).not.toHaveBeenCalled();
    expect(ledger.fail).toHaveBeenCalledWith("reel_job_7");
    expect(ledger.release).not.toHaveBeenCalled();
  });

  it("CONTROL: an ordinary beat is not refused, and nothing is released before generation", async () => {
    job({ storyboardBeats: [{ beatNumber: 1, visual: "a tire" }] });
    submitVeoRequest.mockRejectedValue(new Error("ECONNRESET"));
    const res = await processNextReelJob();
    expect(res.status).toBe("queued");
    expect(submitVeoRequest).toHaveBeenCalled();
    expect(ledger.release).not.toHaveBeenCalled();
  });
});
