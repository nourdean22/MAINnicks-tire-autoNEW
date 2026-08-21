/**
 * ScanFinish NT-013 (historical): Veo had NO fallback at all — a Veo failure
 * just retried Veo up to MAX_ATTEMPTS then terminal-failed the whole job.
 * PAUSE_PROVIDER-class verdicts go terminal on the FIRST attempt regardless of
 * MAX_ATTEMPTS (nextStatusFor).
 *
 * 2026-08-20 · Higgsfield stock-fallback remediation reversed the "escape
 * hatch" this file used to prove: REEL_FALLBACK_TO_TEMPLATE_STOCK forcing one
 * more attempt onto the free local lane, which published stock footage
 * indistinguishable from a paid render (7 reels reached Instagram this way).
 * Operator decision: silence over stock. This now proves the replacement —
 * a terminal paid-provider failure routes to `needs_regen` (non-publishable,
 * loudly alerted, left for real regeneration), and the flag is defunct.
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
const settleMock = vi.hoisted(() => vi.fn(async () => {}));
// Provider-aware, not a flat 0 — a flat rate would hide exactly the
// settlement bug this file's second describe block exists to catch (a
// resumed PAID clip billed as free once the run's active provider becomes
// template_stock).
vi.mock("./services/generationLedger", () => ({
  fail: failMock,
  settle: settleMock,
  reelClipCostUsd: (p: string) => (p === "template_stock" ? 0 : 1.5),
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
  settleMock.mockClear();
  sendTelegram.mockClear();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("a terminal paid-provider failure routes to needs_regen — no silent stock rescue", () => {
  // 2026-08-20 · Higgsfield stock-fallback remediation. This describe REPLACES
  // the old "job-level fallback" suite that asserted a terminally-failed paid
  // job was force-rescued onto the free template-stock lane and published. The
  // operator reversed that (silence over stock): the job is now marked
  // needs_regen — non-publishable, surfaced, regenerated — and the ledger is
  // still settled (spend may have partially burned).

  it("marks needs_regen instead of rescuing to stock (PAUSE_PROVIDER verdict)", async () => {
    submitVeoRequest.mockRejectedValue(new Error("quota exceeded"));

    const res = await processNextReelJob();

    expect(res.status).toBe("needs_regen");
    const finalSet = dbState.updateCalls.at(-1)!.set;
    expect(finalSet.status).toBe("needs_regen");
    expect(finalSet.payload).toBeUndefined(); // no forceProvider rewrite anymore
    // Terminal → the reservation IS settled (unlike the old open-reservation rescue).
    expect(failMock).toHaveBeenCalledTimes(1);
    // Loud, fire-and-forget: the operator must know the same day.
    await vi.waitFor(() => expect(sendTelegram).toHaveBeenCalledTimes(1));
    expect(sendTelegram.mock.calls[0][0]).toMatch(/REEL PROVIDER DOWN — reel NOT published/);
  });

  it("the defunct REEL_FALLBACK_TO_TEMPLATE_STOCK flag no longer changes anything — still needs_regen", async () => {
    // The flag is dead; whether set or unset, a terminal paid failure fails loudly.
    for (const v of ["true", "", "1"]) {
      dbState.updateCalls.length = 0;
      failMock.mockClear();
      if (v) process.env.REEL_FALLBACK_TO_TEMPLATE_STOCK = v;
      else delete process.env.REEL_FALLBACK_TO_TEMPLATE_STOCK;
      submitVeoRequest.mockRejectedValue(new Error("quota exceeded"));
      const res = await processNextReelJob();
      expect(res.status).toBe("needs_regen");
    }
  });

  it("template_stock ITSELF failing goes genuinely terminal (failed) — it is not a paid provider", async () => {
    process.env.REEL_VIDEO_PROVIDER = "template_stock";
    dbState.jobRow!.payload = brief();
    dbState.jobRow!.attempts = 2; // 3rd of MAX_ATTEMPTS → terminal
    generateTemplateStockClip.mockRejectedValue(new Error("ffmpeg exited with code 1"));

    const res = await processNextReelJob();

    expect(res.status).toBe("failed"); // NOT needs_regen — template_stock has nowhere lower to fall
    expect(dbState.updateCalls.at(-1)!.set.payload).toBeUndefined();
    expect(failMock).toHaveBeenCalledTimes(1);
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("a retryable (non-terminal) verdict is untouched — normal requeue, no needs_regen", async () => {
    submitVeoRequest.mockRejectedValue(new Error("ECONNRESET"));

    const res = await processNextReelJob();

    expect(res.status).toBe("queued");
    const finalSet = dbState.updateCalls.at(-1)!.set;
    expect(finalSet.attempts).toBe(1);
    expect(finalSet.payload).toBeUndefined();
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(failMock).not.toHaveBeenCalled();
  });
});
