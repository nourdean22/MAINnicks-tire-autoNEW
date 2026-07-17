/**
 * Selective repair (milestone 9) — regenerate exactly the failing beat,
 * never the package. Trajectory-tested with the policy boundary, ledger,
 * and persistence seams captured.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { buildRepairPrompt } from "./services/selectiveRepair";

afterEach(() => {
  vi.doUnmock("./db");
  vi.doUnmock("./services/higgsfieldStudio");
  vi.resetModules();
});

describe("buildRepairPrompt", () => {
  it("keeps the original prompt as base truth and narrows only the change", () => {
    const p = buildRepairPrompt("Macro shot of a frost-covered battery, gold rim light.", {
      code: "SUBJECT_CONTINUITY",
      preserve: ["camera angle", "lighting"],
      change: ["restore the approved terminal design"],
    });
    expect(p).toContain("Macro shot of a frost-covered battery");
    expect(p).toContain("KEEP IDENTICAL: camera angle; lighting.");
    expect(p).toContain("CHANGE ONLY: restore the approved terminal design.");
    expect(buildRepairPrompt("x", { preserve: [], change: [] })).toContain("KEEP IDENTICAL: everything not named below");
  });
});

function repairDb(jobRow: Record<string, unknown>) {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const tableName = (t: Record<string, unknown>) =>
    "policyJson" in t ? "policy" : "reasoningCodes" in t ? "audit" : "actionId" in t ? "ledger" : "payload" in t ? "reel_jobs" : "other";
  const db = {
    select: () => ({
      from: (t: Record<string, unknown>) => {
        const rows = tableName(t) === "reel_jobs" ? [jobRow] : [];
        const thenable = (r: unknown[]) => {
          const p = Promise.resolve(r) as Promise<unknown[]> & Record<string, unknown>;
          p.limit = () => Promise.resolve(r);
          p.orderBy = () => { const q = Promise.resolve(r) as Promise<unknown[]> & Record<string, unknown>; q.limit = () => Promise.resolve(r); return q; };
          return p;
        };
        return { where: () => thenable(rows), orderBy: () => thenable(rows), limit: () => Promise.resolve(rows) };
      },
    }),
    insert: (t: Record<string, unknown>) => ({ values: (v: Record<string, unknown>) => { inserts.push({ __table: tableName(t), ...v }); return Promise.resolve({}); } }),
    update: (t: Record<string, unknown>) => ({ set: (v: Record<string, unknown>) => ({ where: () => { updates.push({ __table: tableName(t), ...v }); return Promise.resolve({}); } }) }),
  };
  return { db, inserts, updates };
}

const baseJob = (over: Record<string, unknown> = {}) => ({
  id: 7,
  status: "assembled",
  clipUrlsJson: JSON.stringify(["https://c/1.mp4", "https://c/2.mp4", "https://c/3.mp4"]),
  payload: JSON.stringify({
    genomeId: "genome_x",
    storyboardBeats: [
      { beatNumber: 1, startSecond: 0, endSecond: 4 },
      { beatNumber: 2, startSecond: 4, endSecond: 8 },
      { beatNumber: 3, startSecond: 8, endSecond: 12 },
    ],
    promptPack: [
      { beatNumber: 1, prompt: "beat one prompt" },
      { beatNumber: 2, prompt: "beat two prompt", negativePrompt: "no humans" },
      { beatNumber: 3, prompt: "beat three prompt" },
    ],
    renderedQa: {
      decision: "repair",
      findings: [{ beatNumber: 2, code: "HUMAN_PRESENT", description: "hand visible", preserve: ["lighting"], change: ["remove the hand"], severity: "block" }],
    },
    repairs: [],
  }),
  ...over,
});

describe("repairReelBeat trajectory", () => {
  it("replaces ONLY the failing clip, records the repair, reserves+settles, and returns the job to assembly", async () => {
    const { db, inserts, updates } = repairDb(baseJob());
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(db) }));
    const gen = vi.fn().mockResolvedValue("https://c/2-repaired.mp4");
    vi.doMock("./services/higgsfieldStudio", () => ({ generateReelClipVideo: gen }));
    vi.resetModules();
    const { repairReelBeat } = await import("./services/selectiveRepair");

    const res = await repairReelBeat({ jobId: 7, beatNumber: 2 });

    expect(res.attempt).toBe(1);
    expect(gen).toHaveBeenCalledTimes(1);
    expect(gen.mock.calls[0][0].prompt).toContain("beat two prompt");
    expect(gen.mock.calls[0][0].prompt).toContain("CHANGE ONLY: remove the hand.");
    expect(gen.mock.calls[0][0].negativePrompt).toBe("no humans");

    const jobUpdate = updates.find((u) => u.__table === "reel_jobs");
    expect(jobUpdate).toBeTruthy();
    const clips = JSON.parse(jobUpdate!.clipUrlsJson as string);
    expect(clips).toEqual(["https://c/1.mp4", "https://c/2-repaired.mp4", "https://c/3.mp4"]);
    expect(jobUpdate!.status).toBe("assets_ready");
    const payload = JSON.parse(jobUpdate!.payload as string);
    expect(payload.repairs).toHaveLength(1);
    expect(payload.repairs[0]).toMatchObject({ beatNumber: 2, attempt: 1, findingCode: "HUMAN_PRESENT", previousClipUrl: "https://c/2.mp4" });
    expect(payload.renderedQa.staleAfterRepair).toBe(true);

    expect(inserts.some((i) => i.__table === "ledger" && i.actionId === "repair_7_beat2_a1")).toBe(true);
    const ledgerSettle = updates.find((u) => u.__table === "ledger" && u.status === "settled");
    expect(ledgerSettle).toBeTruthy();
    expect(inserts.some((i) => i.__table === "audit")).toBe(true);
  });

  it("the repair cap denies the third attempt from the JOB'S OWN history — no provider call", async () => {
    const capped = baseJob({
      payload: JSON.stringify({
        ...JSON.parse(baseJob().payload as string),
        repairs: [
          { beatNumber: 2, attempt: 1, findingCode: "X", previousClipUrl: null, newClipUrl: "a", repairedAt: "t" },
          { beatNumber: 1, attempt: 1, findingCode: "Y", previousClipUrl: null, newClipUrl: "b", repairedAt: "t" },
        ],
      }),
    });
    const { db } = repairDb(capped);
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(db) }));
    const gen = vi.fn();
    vi.doMock("./services/higgsfieldStudio", () => ({ generateReelClipVideo: gen }));
    vi.resetModules();
    const { repairReelBeat } = await import("./services/selectiveRepair");

    await expect(repairReelBeat({ jobId: 7, beatNumber: 2 })).rejects.toThrow(/REPAIR_CAP/);
    expect(gen).not.toHaveBeenCalled();
  });

  it("a provider failure fails the reservation and leaves the job untouched", async () => {
    const { db, updates } = repairDb(baseJob());
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(db) }));
    vi.doMock("./services/higgsfieldStudio", () => ({ generateReelClipVideo: vi.fn().mockRejectedValue(new Error("provider down")) }));
    vi.resetModules();
    const { repairReelBeat } = await import("./services/selectiveRepair");

    await expect(repairReelBeat({ jobId: 7, beatNumber: 2 })).rejects.toThrow("provider down");
    expect(updates.find((u) => u.__table === "reel_jobs")).toBeUndefined();
    expect(updates.some((u) => u.__table === "ledger" && u.status === "failed")).toBe(true);
  });

  it("refuses incomplete clip sets and unknown beats with clear reasons", async () => {
    const partial = baseJob({ clipUrlsJson: JSON.stringify(["only-one.mp4"]) });
    const { db } = repairDb(partial);
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(db) }));
    vi.doMock("./services/higgsfieldStudio", () => ({ generateReelClipVideo: vi.fn() }));
    vi.resetModules();
    const { repairReelBeat } = await import("./services/selectiveRepair");
    await expect(repairReelBeat({ jobId: 7, beatNumber: 2 })).rejects.toThrow(/complete clip set/);
    await expect(repairReelBeat({ jobId: 7, beatNumber: 9 })).rejects.toThrow(/not in job/);
  });
});
