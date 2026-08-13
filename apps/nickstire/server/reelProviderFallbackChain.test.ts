/**
 * ScanFinish NT-013: Veo had NO fallback at all — a Veo failure just retried
 * Veo up to MAX_ATTEMPTS then terminal-failed the whole job, publishing
 * nothing that day. Higgsfield's inline per-beat degrade never covered it
 * (that branch does not exist for Veo), and PAUSE_PROVIDER-class verdicts go
 * terminal on the FIRST attempt regardless of MAX_ATTEMPTS (nextStatusFor),
 * so Higgsfield itself was exposed too whenever the inline check declined to
 * degrade (e.g. a RECONCILE_BEFORE_RETRY exhaustion — the 2026-08-07 hung-
 * session incident reached this exact terminal path).
 *
 * This proves the job-level escape hatch: when nextStatusFor's own verdict
 * says a job is terminal, REEL_FALLBACK_TO_TEMPLATE_STOCK=true forces ONE
 * more attempt onto the free local lane instead of terminal-failing —
 * same tradeoff, same opt-in flag as the existing inline Higgsfield degrade.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

const generateTemplateStockClip = vi.hoisted(() => vi.fn());
vi.mock("./services/templateStockStudio", () => ({ generateTemplateStockClip }));

const failMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./services/generationLedger", () => ({
  fail: failMock,
  settle: vi.fn(async () => {}),
  reelClipCostUsd: () => 0,
}));

const sendTelegram = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./services/telegram", () => ({ sendTelegram }));

import { processNextReelJob } from "./services/reelPipeline";

function brief(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    topic: "bald tires",
    storyboardBeats: [{ beatNumber: 1, visual: "a tire" }],
    ...extra,
  });
}

const ENV_KEYS = ["REEL_GENERATION_ENABLED", "REEL_VIDEO_PROVIDER", "REEL_FALLBACK_TO_TEMPLATE_STOCK"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.REEL_GENERATION_ENABLED = "true";
  process.env.REEL_VIDEO_PROVIDER = "veo";
  dbState.jobRow = { id: 1, payload: brief(), status: "queued", attempts: 0, clipUrlsJson: null };
  dbState.updateCalls = [];
  submitVeoRequest.mockReset();
  generateTemplateStockClip.mockReset();
  failMock.mockClear();
  sendTelegram.mockClear();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("job-level fallback when a paid provider exhausts its own retries", () => {
  it("forces the free lane instead of terminal-failing (flag ON, PAUSE_PROVIDER verdict)", async () => {
    process.env.REEL_FALLBACK_TO_TEMPLATE_STOCK = "true";
    submitVeoRequest.mockRejectedValue(new Error("quota exceeded"));

    const res = await processNextReelJob();

    expect(res.status).toBe("queued");
    // Last update call is the terminal-classification write (claim is call #1).
    const finalSet = dbState.updateCalls.at(-1)!.set;
    expect(finalSet.status).toBe("queued");
    expect(finalSet.attempts).toBe(0);
    const revived = JSON.parse(finalSet.payload as string);
    expect(revived.forceProvider).toBe("template_stock");
    // Not actually terminal — the ledger reservation must stay open.
    expect(failMock).not.toHaveBeenCalled();
    // Fire-and-forget (`void import(...).then(...)`) by design — a dead
    // Telegram must never hold up the job — so it lands a beat after return.
    await vi.waitFor(() => expect(sendTelegram).toHaveBeenCalledTimes(1));
    expect(sendTelegram.mock.calls[0][0]).toMatch(/FREE local lane/);
  });

  it("stays terminal when the flag is OFF — no silent behavior change", async () => {
    delete process.env.REEL_FALLBACK_TO_TEMPLATE_STOCK;
    submitVeoRequest.mockRejectedValue(new Error("quota exceeded"));

    const res = await processNextReelJob();

    expect(res.status).toBe("failed");
    const finalSet = dbState.updateCalls.at(-1)!.set;
    expect(finalSet.payload).toBeUndefined(); // no forceProvider written
    expect(failMock).toHaveBeenCalledTimes(1);
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("does not loop when template_stock ITSELF is the one that ran out of retries", async () => {
    process.env.REEL_FALLBACK_TO_TEMPLATE_STOCK = "true";
    process.env.REEL_VIDEO_PROVIDER = "template_stock";
    dbState.jobRow!.payload = brief();
    // Simulate the 3rd (of MAX_ATTEMPTS=3) attempt, so an ordinary retryable
    // error still exhausts into terminal per nextStatusFor's own arithmetic.
    dbState.jobRow!.attempts = 2;
    generateTemplateStockClip.mockRejectedValue(new Error("ffmpeg exited with code 1"));

    const res = await processNextReelJob();

    // template_stock has no lower fallback — must go genuinely terminal.
    expect(res.status).toBe("failed");
    const finalSet = dbState.updateCalls.at(-1)!.set;
    expect(finalSet.payload).toBeUndefined();
    expect(failMock).toHaveBeenCalledTimes(1);
  });

  it("a retryable (non-terminal) verdict is untouched — no forced fallback, normal requeue", async () => {
    process.env.REEL_FALLBACK_TO_TEMPLATE_STOCK = "true";
    submitVeoRequest.mockRejectedValue(new Error("ECONNRESET"));

    const res = await processNextReelJob();

    expect(res.status).toBe("queued");
    const finalSet = dbState.updateCalls.at(-1)!.set;
    // A normal retry, not a forced one: attempts increments, no forceProvider.
    expect(finalSet.attempts).toBe(1);
    expect(finalSet.payload).toBeUndefined();
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(failMock).not.toHaveBeenCalled();
  });
});
