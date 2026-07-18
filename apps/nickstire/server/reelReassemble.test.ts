/**
 * reassembleFromClips — the FREE recovery path, and its refusals.
 *
 * Grounded in production: three reels were unpublishable because the assembled
 * master lived on ephemeral disk, while their source clips survived on the
 * provider's CDN. Re-running ffmpeg over already-paid-for media rebuilds them at
 * zero generation cost.
 *
 * The invariant that matters most: re-assembly produces a DIFFERENT file with a
 * different hash, so the prior rendered-QA verdict and audio verdict must be
 * dropped. Inheriting them would let a judgement about a file that no longer
 * exists authorise a publish — the exact stale-evidence failure the gate exists
 * to prevent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let jobRow: Record<string, unknown> | null;
let updates: Array<Record<string, unknown>>;
let claimAffected: number;
let probeReachable: boolean;
let assembleImpl: () => Promise<{ mp4Url: string; durationSec: number; usedVo: boolean }>;

vi.mock("./services/reelRecoverability", () => ({
  probeUrl: async (url: string | null) => ({ url, reachable: probeReachable }),
}));
vi.mock("./services/reelAssembly", () => ({ assembleReel: async () => assembleImpl() }));
vi.mock("./lib/db-helper", () => ({
  db: async () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (jobRow ? [jobRow] : []) }) }) }),
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          updates.push(vals);
          // The claim is the only update that sets status to "assembling".
          return vals.status === "assembling" ? [{ affectedRows: claimAffected }] : [{ affectedRows: 1 }];
        },
      }),
    }),
  }),
}));

import { reassembleFromClips } from "./services/reelReassemble";

const beats = [{ beatNumber: 1 }, { beatNumber: 2 }];
const payload = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ storyboardBeats: beats, renderedQa: { decision: "approve" }, audioQa: { decision: "approve" }, ...extra });

beforeEach(() => {
  updates = [];
  claimAffected = 1;
  probeReachable = true;
  assembleImpl = async () => ({ mp4Url: "https://nickstire.org/generated/reels/reel-1.mp4", durationSec: 18, usedVo: false });
  jobRow = { id: 1, status: "assembled", payload: payload(), clipUrlsJson: JSON.stringify(["c1", "c2"]), mp4Url: "dead.mp4" };
});

describe("happy path", () => {
  it("rebuilds the master and reports the clips used", async () => {
    const r = await reassembleFromClips(1);
    expect(r).toMatchObject({ ok: true, clipsUsed: 2, durationSec: 18 });
  });

  it("INVALIDATES the prior QA and audio verdicts — new file, new hash, no inherited judgement", async () => {
    await reassembleFromClips(1);
    const final = updates.find((u) => u.status === "assembled" && typeof u.payload === "string")!;
    const saved = JSON.parse(final.payload as string);
    expect(saved.renderedQa).toBeUndefined();
    expect(saved.audioQa).toBeUndefined();
    expect(saved.reassembledAt).toBeTruthy();
    // The brief itself must survive — it is what was rebuilt from.
    expect(saved.storyboardBeats).toHaveLength(2);
  });

  it("claims the job BEFORE running ffmpeg", async () => {
    let statusAtAssemble = "";
    assembleImpl = async () => {
      statusAtAssemble = String(updates[updates.length - 1]?.status ?? "");
      return { mp4Url: "u", durationSec: 1, usedVo: false };
    };
    await reassembleFromClips(1);
    expect(statusAtAssemble).toBe("assembling");
  });
});

describe("refusals — every one fails closed before ffmpeg runs", () => {
  const assertNoAssemble = () => expect(updates.some((u) => u.status === "assembling")).toBe(false);

  it("refuses a job that is not 'assembled'", async () => {
    jobRow = { ...jobRow, status: "queued" };
    const r = await reassembleFromClips(1);
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toMatch(/only an 'assembled' job/);
    assertNoAssemble();
  });

  it("refuses when a source clip no longer resolves — a shorter reel is not the approved one", async () => {
    probeReachable = false;
    const r = await reassembleFromClips(1);
    expect((r as { reason: string }).reason).toMatch(/no longer resolve/);
    assertNoAssemble();
  });

  it("refuses on a beat/clip mismatch and reports both counts", async () => {
    jobRow = { ...jobRow, clipUrlsJson: JSON.stringify(["only-one"]) };
    const r = await reassembleFromClips(1);
    expect((r as { reason: string }).reason).toMatch(/2 beats vs 1 clips/);
    assertNoAssemble();
  });

  it("refuses when there are no recorded clips", async () => {
    jobRow = { ...jobRow, clipUrlsJson: "[]" };
    expect((await reassembleFromClips(1) as { reason: string }).reason).toMatch(/no source clips/);
  });

  it("refuses an unparseable clip list rather than guessing", async () => {
    jobRow = { ...jobRow, clipUrlsJson: "{not json" };
    expect((await reassembleFromClips(1) as { reason: string }).reason).toMatch(/unparseable/);
  });

  it("refuses when another process won the claim", async () => {
    claimAffected = 0;
    const r = await reassembleFromClips(1);
    expect((r as { reason: string }).reason).toMatch(/claimed this job first/);
  });

  it("refuses a missing job", async () => {
    jobRow = null;
    expect((await reassembleFromClips(99) as { reason: string }).reason).toMatch(/not found/);
  });
});

describe("failure recovery", () => {
  it("returns the job to 'assembled' when ffmpeg throws — never wedged in 'assembling'", async () => {
    assembleImpl = async () => { throw new Error("ffmpeg exited 1"); };
    const r = await reassembleFromClips(1);
    expect(r).toMatchObject({ ok: false });
    const last = updates[updates.length - 1];
    expect(last.status).toBe("assembled");
    expect(String(last.error)).toMatch(/re-assembly failed/);
  });
});
