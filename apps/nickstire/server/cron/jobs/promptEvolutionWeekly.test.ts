/**
 * Weekly prompt evolution · doctrine tests.
 *
 * Pins: the Monday self-gate emits the whole-run-skip vocabulary (so the
 * loop-shape observer never reads six quiet days as dormancy), an accepted
 * result persists to kv + Telegram, and a gate rejection is a quiet zero,
 * never an error.
 *
 * 2026-10-09 (wiring): the job resolves the LIVE baseline first (a refusal
 * fails the run), feeds the consumed confirmation list in and merges this
 * run's spent seeds back (newest first, capped), posts one ledger receipt
 * (best-effort), writes prompt_evolution_latest as a pointer carrying the
 * receipt's experimentId and the previous proposal's status, and says
 * "offline evidence only (H2)" and "proxy lane" in Telegram with hashes, never
 * prompt text. The runner is mocked here; the real stack runs end to end in
 * services/promptEvolution.integration.test.ts.
 *
 * Review round 3 (2026-10-09): the logger is captured, so the structured
 * "[evolve] result" line (the production verification instrument) is pinned
 * for what it carries and for what it must never carry; the kv mock rejects
 * a value over the TEXT column's 65,535 bytes, as the real column does.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runPromptEvolution: vi.fn(),
  resolveLiveReceptionistBaseline: vi.fn(),
  sendTelegram: vi.fn().mockResolvedValue(true),
  postToEvidenceLedger: vi.fn().mockResolvedValue(true),
  kv: new Map<string, string>(),
  readFails: false,
  /** Keys whose NEXT read throws, once. */
  failReadOnce: new Set<string>(),
  insert: vi.fn(),
  update: vi.fn(),
  logs: [] as Array<{ level: string; message: string; meta: unknown[] }>,
}));

/** shop_settings.value is TEXT: a longer value is rejected, never truncated. */
const TEXT_MAX_BYTES = 65_535;
const assertFits = (value: string): void => {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > TEXT_MAX_BYTES) throw new Error(`Data too long for column 'value' at row 1 (${bytes} bytes, test)`);
};

vi.mock("../../lib/logger", () => ({
  createLogger: () => {
    const rec = (level: string) => (message: string, ...meta: unknown[]) => void mocks.logs.push({ level, message, meta });
    const l: Record<string, unknown> = { debug: rec("debug"), info: rec("info"), warn: rec("warn"), error: rec("error"), fatal: rec("fatal") };
    l.child = () => l;
    return l;
  },
}));

const sha24 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);

vi.mock("../../services/promptEvolution", () => ({
  runPromptEvolution: mocks.runPromptEvolution,
  promptHashOf: (p: string) => sha24(p),
}));
vi.mock("../../services/receptionistBaseline", () => ({ resolveLiveReceptionistBaseline: mocks.resolveLiveReceptionistBaseline }));
vi.mock("../../services/telegram", () => ({ sendTelegram: mocks.sendTelegram }));
vi.mock("../../services/evidenceLedger", () => ({ postToEvidenceLedger: mocks.postToEvidenceLedger }));

/** eq(shopSettings.key, k) carries k as its one Param chunk. */
const keyOf = (cond: { queryChunks?: unknown[] }): string => {
  const param = (cond?.queryChunks ?? []).find((c) => !!c && typeof (c as { value?: unknown }).value === "string") as { value: string } | undefined;
  return param ? param.value : "";
};

vi.mock("../../db", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: (cond: { queryChunks?: unknown[] }) => ({
          limit: async () => {
            if (mocks.readFails) throw new Error("db read failed (test)");
            const k = keyOf(cond);
            if (mocks.failReadOnce.delete(k)) throw new Error(`db read of ${k} failed (test)`);
            return mocks.kv.has(k) ? [{ key: k, value: mocks.kv.get(k) }] : [];
          },
        }),
      }),
    }),
    insert: () => ({ values: async (v: { key: string; value: string }) => { mocks.insert(v); assertFits(v.value); mocks.kv.set(v.key, v.value); } }),
    update: () => ({ set: (v: { value: string }) => ({ where: async (cond: { queryChunks?: unknown[] }) => { mocks.update(v); assertFits(v.value); mocks.kv.set(keyOf(cond), v.value); } }) }),
  }),
}));

import { processPromptEvolutionWeekly } from "./promptEvolutionWeekly";
import { looksSkipped } from "../../services/loopShapeContract";

const MONDAY = new Date("2026-08-03T15:00:00Z");
const LIVE_HASH = "e8dc0c8af5ad831b24767519";
const CAND_PROMPT = `${"x".repeat(300)} UNIQUE-CANDIDATE-PROMPT-TEXT`;
const CAND_HASH = sha24(CAND_PROMPT);

const gateOf = (over: Record<string, unknown> = {}) => ({
  accept: true, reason: "improved", comparable: 8, improved: 8, worsened: 0, tied: 0,
  pValue: 0.004, bestPossibleP: 0.004, baselineSelfDisagreement: 0, regressedSeeds: [] as string[],
  baseline: { passes: 0, trials: 24 }, candidate: { passes: 24, trials: 24 },
  eligible: 8, evaluatorUnavailableSeeds: [] as string[], evaluatorOutageShare: 0, outageRegressionSeeds: [] as string[], worstCaseP: 0.004,
  ...over,
});
const successOf = (over: Record<string, unknown> = {}) => ({
  veto: false, reason: "preserved", eligible: 8, comparable: 8, improved: 0, worsened: 0, tied: 8,
  pDegraded: 1, pDegradedWorstCase: 1, bestPossibleP: 0.004, margin: 0, regressedSeeds: [] as string[], newViolationSeeds: [] as string[],
  violationChecked: 8, evaluatorUnavailableSeeds: [] as string[], evaluatorOutageShare: 0, outageRegressionSeeds: [] as string[],
  baseline: { passes: 16, trials: 16, violations: 0 }, candidate: { passes: 16, trials: 16, violations: 0 },
  ...over,
});

/** A full EvolutionResult for an accepted, confirmed run; override per case. */
function resultOf(over: Record<string, unknown> = {}) {
  return {
    usableSeeds: 20, excludedVerified: 0, trainCount: 6, holdoutCount: 8,
    baselineTrain: "1/6", baselineHoldout: "2/8",
    candidateSummaries: [{ rationale: "better transfer handling", train: "5/6", promptHash: CAND_HASH, trainMargin: 4, trainUsable: true }],
    accepted: { rationale: "better transfer handling", holdout: "improved · seeds +8", prompt: CAND_PROMPT, promptHash: CAND_HASH, confirmed: true },
    gate: gateOf(),
    gates: { holdout: gateOf(), success: successOf(), confirmation: gateOf({ comparable: 5, improved: 5, pValue: 0.031 }) },
    outcome: "accepted",
    promotionStage: "offline_candidate",
    baseline: {
      source: "live_provider", assistantId: "150fe622-0b9f-4b03-b8c7-3063812717ae", promptHash: LIVE_HASH, promptChars: 27000,
      providerBehaviorHash: "abcdef0123456789abcdef01", providerBehaviorSchema: "vapi-behavior-v1",
      parity: "code_plus_lessons", parityDetail: "plus lessons", fetchedAt: "2026-08-03T15:00:00.000Z",
    },
    lanes: {
      live: { provider: "openai", model: "gpt-4o", temperature: 0.4, maxTokens: 250, toolNames: ["transferCall"] },
      replay: { model: "deepseek-v4-pro", temperature: 0, maxTokens: 700, tools: [] },
      parity: false,
      differences: ["model: live openai/gpt-4o vs replay deepseek-v4-pro", "temperature: live 0.4 vs replay 0"],
    },
    cohorts: { train: 6, holdout: 8, confirm: 5, confirmEligible: 6, confirmNeeded: 5, success: 8 },
    exclusions: { unresolvable: 0, evaluatorUnavailable: 0, consumedConfirmation: 1, consumedListUnknown: false },
    usage: { replays: 128, judgeCalls: 116, optimizerCalls: 2, durationMs: 90_000 },
    candidate: { promptHash: CAND_HASH, parentHash: LIVE_HASH, rationale: "better transfer handling" },
    candidateDiff: { startLine: 400, removedCount: 0, addedCount: 3, removed: [], added: ["", "## X", "- y"], truncated: false, codeEdit: true },
    consumedConfirmationIds: ["c1", "c2", "c3", "c4", "c5"],
    budget: { deadlineMs: 1_500_000, exhaustedAt: null },
    evaluator: { optimizerModel: "gpt-oss:120b", judgeModel: "gpt-oss:120b", ghostModel: "deepseek-v4-pro", protocolVersion: "prompt-evolution/2026-10-09" },
    ...over,
  };
}
const rejected = (over: Record<string, unknown> = {}) =>
  resultOf({ accepted: null, promotionStage: "none", gates: { holdout: null, success: null, confirmation: null }, gate: null, consumedConfirmationIds: [], ...over });

const telegramText = () => mocks.sendTelegram.mock.calls[0][0] as string;
const latest = () => JSON.parse(mocks.kv.get("prompt_evolution_latest")!);

describe("processPromptEvolutionWeekly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.kv.clear();
    mocks.logs.length = 0;
    mocks.readFails = false;
    mocks.failReadOnce.clear();
    mocks.resolveLiveReceptionistBaseline.mockResolvedValue({ promptHash: LIVE_HASH });
    mocks.postToEvidenceLedger.mockResolvedValue(true);
  });

  it("non-Monday emits the whole-run-skip vocabulary the shape observer excludes", async () => {
    const r = await processPromptEvolutionWeekly(new Date("2026-08-05T15:00:00Z")); // a Wednesday
    expect(r.recordsProcessed).toBe(0);
    expect(looksSkipped(r.details)).toBe(true);
    expect(mocks.runPromptEvolution).not.toHaveBeenCalled();
    expect(mocks.resolveLiveReceptionistBaseline).not.toHaveBeenCalled();
  });

  it("a MANUAL run on a Wednesday runs the full cycle; Telegram, the latest row and cron_log all say manual", async () => {
    mocks.runPromptEvolution.mockResolvedValue(resultOf());
    const r = await processPromptEvolutionWeekly(new Date("2026-08-05T15:00:00Z"), { trigger: "manual" }); // a Wednesday
    expect(r.recordsProcessed).toBe(1);
    expect(looksSkipped(r.details)).toBe(false);
    expect(r.details).toContain("manual run");
    expect(mocks.resolveLiveReceptionistBaseline).toHaveBeenCalledTimes(1);
    expect(mocks.runPromptEvolution).toHaveBeenCalledTimes(1);
    expect(telegramText()).toContain("PROMPT EVOLUTION (manual run · propose-only)");
    expect(telegramText()).toContain("Offline evidence only (H2); not served to customers.");
    expect(JSON.parse(mocks.kv.get("prompt_evolution_latest")!).trigger).toBe("manual");
    const line = mocks.logs.find((l) => l.message === "[evolve] result");
    expect((line?.meta[0] as { trigger?: string })?.trigger).toBe("manual");
  });

  it("a SCHEDULED run on a non-Monday still skips, even when the option object is passed explicitly", async () => {
    const r = await processPromptEvolutionWeekly(new Date("2026-08-05T15:00:00Z"), { trigger: "scheduled" });
    expect(r.recordsProcessed).toBe(0);
    expect(looksSkipped(r.details)).toBe(true);
    expect(mocks.runPromptEvolution).not.toHaveBeenCalled();
  });

  it("Monday + accepted → kv persisted, Telegram sent, recordsProcessed 1", async () => {
    mocks.runPromptEvolution.mockResolvedValue(resultOf());
    const r = await processPromptEvolutionWeekly(MONDAY);
    expect(r.recordsProcessed).toBe(1);
    expect(r.details).toContain("accepted");
    expect(mocks.insert).toHaveBeenCalled(); // kv row written
    // 9c6b591d renamed "ACCEPTED": an offline holdout pass is not a production
    // winner, and the message must say so.
    expect(mocks.sendTelegram).toHaveBeenCalledWith(expect.stringContaining("OFFLINE CANDIDATE"));
    expect(mocks.sendTelegram).toHaveBeenCalledWith(expect.stringContaining("NOT a production/business winner"));
    expect(mocks.sendTelegram).toHaveBeenCalledWith(expect.stringContaining("Offline evidence only (H2); not served to customers."));
    expect(telegramText()).toContain("PROMPT EVOLUTION (weekly · propose-only)");
    expect(JSON.parse(mocks.kv.get("prompt_evolution_latest")!).trigger).toBe("scheduled");
  });

  it("Monday + gate rejection → quiet zero with the outcome named, Telegram still informs", async () => {
    mocks.runPromptEvolution.mockResolvedValue(rejected({ outcome: "rejected-holdout" }));
    const r = await processPromptEvolutionWeekly(MONDAY);
    expect(r.recordsProcessed).toBe(0);
    expect(r.details).toContain("rejected-holdout");
    expect(mocks.sendTelegram).toHaveBeenCalledWith(expect.stringContaining("gate held"));
    expect(telegramText()).toMatch(/No proposal shipped \S outcome: rejected-holdout\./);
  });

  it("Monday + an infrastructure failure (no DB, dead LLM lane) fails the cron run — no kv row, no Telegram, never a quiet zero", async () => {
    mocks.runPromptEvolution.mockRejectedValue(new Error("only 2 usable seeds — need >= 4"));
    await expect(processPromptEvolutionWeekly(MONDAY)).rejects.toThrow("usable seeds");
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.sendTelegram).not.toHaveBeenCalled();
    expect(mocks.postToEvidenceLedger).not.toHaveBeenCalled();
  });

  it("Monday + a holdout reading → cron_log details and Telegram carry the gate's reason and numbers", async () => {
    const gate = gateOf({ accept: false, reason: "regressed-seed", comparable: 12, improved: 5, worsened: 1, tied: 6, pValue: 0.04, bestPossibleP: 1 / 4096, baselineSelfDisagreement: 3, regressedSeeds: ["call-7"], baseline: { passes: 12, trials: 36 }, candidate: { passes: 25, trials: 36 } });
    mocks.runPromptEvolution.mockResolvedValue(rejected({ gate, gates: { holdout: gate, success: null, confirmation: null }, outcome: "rejected-regression" }));
    const r = await processPromptEvolutionWeekly(MONDAY);
    expect(r.recordsProcessed).toBe(0);
    expect(r.details).toContain("gate regressed-seed +5/-1 p=0.040");
    expect(mocks.sendTelegram).toHaveBeenCalledWith(expect.stringContaining("regressed call-7"));
  });

  it("the live baseline is resolved first and passed in; a refusal fails the run before any replay, kv write or Telegram", async () => {
    mocks.runPromptEvolution.mockResolvedValue(resultOf());
    const baseline = { promptHash: LIVE_HASH, prompt: "live text" };
    mocks.resolveLiveReceptionistBaseline.mockResolvedValue(baseline);
    await processPromptEvolutionWeekly(MONDAY);
    expect(mocks.runPromptEvolution).toHaveBeenCalledWith(
      expect.objectContaining({
        baseline, seedCount: 30, candidates: 2, holdoutRepeats: 3, replayConcurrency: 2, deadlineMs: 45 * 60 * 1000,
        consumedConfirmationIds: [], onConfirmationSpend: expect.any(Function),
      }),
    );

    vi.clearAllMocks();
    mocks.kv.clear();
    mocks.resolveLiveReceptionistBaseline.mockRejectedValue(new Error("Live receptionist baseline refused: routing mismatch."));
    await expect(processPromptEvolutionWeekly(MONDAY)).rejects.toThrow(/baseline refused/);
    expect(mocks.runPromptEvolution).not.toHaveBeenCalled();
    expect(mocks.kv.size).toBe(0);
    expect(mocks.sendTelegram).not.toHaveBeenCalled();
  });

  it("consumed confirmation seeds: the stored list goes in, this run's ids are merged back newest first, capped at 500", async () => {
    const before = Array.from({ length: 499 }, (_, i) => `old-${i}`);
    mocks.kv.set("prompt_evolution_confirmation_consumed", JSON.stringify(before));
    mocks.runPromptEvolution.mockResolvedValue(resultOf({ consumedConfirmationIds: ["c1", "c2", "old-0"] }));
    await processPromptEvolutionWeekly(MONDAY);
    expect(mocks.runPromptEvolution).toHaveBeenCalledWith(expect.objectContaining({ consumedConfirmationIds: before }));
    const after = JSON.parse(mocks.kv.get("prompt_evolution_confirmation_consumed")!) as string[];
    expect(after).toHaveLength(500);
    expect(after.slice(0, 3)).toEqual(["c1", "c2", "old-0"]);
    expect(after.filter((id) => id === "old-0")).toHaveLength(1);
    expect(after[3]).toBe("old-1");

    // Control: a run that spent nothing leaves the list exactly as it was.
    vi.clearAllMocks();
    mocks.kv.set("prompt_evolution_confirmation_consumed", JSON.stringify(["keep"]));
    mocks.runPromptEvolution.mockResolvedValue(rejected({ outcome: "rejected-holdout" }));
    await processPromptEvolutionWeekly(MONDAY);
    expect(mocks.kv.get("prompt_evolution_confirmation_consumed")).toBe(JSON.stringify(["keep"]));
  });

  it("write-ahead: seeds the runner hands to onConfirmationSpend are persisted before it reads them, so a run that then throws keeps them spent", async () => {
    mocks.kv.set("prompt_evolution_confirmation_consumed", JSON.stringify(["old-1"]));
    let seenAtSpend: string | undefined;
    mocks.runPromptEvolution.mockImplementation(async (opts: { onConfirmationSpend?: (ids: readonly string[]) => Promise<void> }) => {
      await opts.onConfirmationSpend?.(["c1", "c2"]);
      seenAtSpend = mocks.kv.get("prompt_evolution_confirmation_consumed");
      throw new Error("ghost lane down mid-confirmation (test)");
    });
    await expect(processPromptEvolutionWeekly(MONDAY)).rejects.toThrow(/mid-confirmation/);
    // Persisted when the hook returned, i.e. before the first sealed replay.
    expect(JSON.parse(seenAtSpend!)).toEqual(["c1", "c2", "old-1"]);
    expect(JSON.parse(mocks.kv.get("prompt_evolution_confirmation_consumed")!)).toEqual(["c1", "c2", "old-1"]);
    expect(mocks.sendTelegram).not.toHaveBeenCalled();

    // A run that spends through the hook and then returns writes the list ONCE (no second write of the same ids).
    vi.clearAllMocks();
    mocks.kv.set("prompt_evolution_confirmation_consumed", JSON.stringify(["old-1"]));
    mocks.runPromptEvolution.mockImplementation(async (opts: { onConfirmationSpend?: (ids: readonly string[]) => Promise<void> }) => {
      await opts.onConfirmationSpend?.(["c1", "c2"]);
      return resultOf({ consumedConfirmationIds: ["c1", "c2"] });
    });
    await processPromptEvolutionWeekly(MONDAY);
    const consumedWrites = mocks.update.mock.calls.filter(([v]) => typeof v.value === "string" && v.value.startsWith("["));
    expect(consumedWrites).toHaveLength(1);
    expect(JSON.parse(mocks.kv.get("prompt_evolution_confirmation_consumed")!)).toEqual(["c1", "c2", "old-1"]);

    // Control: an unparseable list is never overwritten, through the hook either.
    vi.clearAllMocks();
    mocks.kv.set("prompt_evolution_confirmation_consumed", "{not json");
    mocks.runPromptEvolution.mockImplementation(async (opts: { onConfirmationSpend?: (ids: readonly string[]) => Promise<void> }) => {
      await opts.onConfirmationSpend?.(["c1"]);
      return rejected({ outcome: "rejected-confirmation" });
    });
    await processPromptEvolutionWeekly(MONDAY);
    expect(mocks.kv.get("prompt_evolution_confirmation_consumed")).toBe("{not json");
  });

  it("an unparseable consumed list disables confirmation (null goes in) and is never overwritten; a DB read error fails the run", async () => {
    mocks.kv.set("prompt_evolution_confirmation_consumed", "{not json");
    mocks.runPromptEvolution.mockResolvedValue(resultOf({ outcome: "accepted-unconfirmed", promotionStage: "offline_candidate_unconfirmed", consumedConfirmationIds: [], exclusions: { unresolvable: 0, evaluatorUnavailable: 0, consumedConfirmation: 6, consumedListUnknown: true }, gates: { holdout: gateOf(), success: successOf(), confirmation: null } }));
    await processPromptEvolutionWeekly(MONDAY);
    expect(mocks.runPromptEvolution).toHaveBeenCalledWith(expect.objectContaining({ consumedConfirmationIds: null }));
    expect(mocks.kv.get("prompt_evolution_confirmation_consumed")).toBe("{not json");
    expect(telegramText()).toContain("confirmation disabled: the consumed-seed list did not parse");

    // Values that PARSE but are not a list of ids are unreadable too: reading
    // them as [] would re-read every sealed seed. The runner even spends
    // through the hook here, and the stored value still stands.
    for (const bad of ['{"a":1}', "[1,2]", '"c1"']) {
      vi.clearAllMocks();
      mocks.kv.set("prompt_evolution_confirmation_consumed", bad);
      mocks.runPromptEvolution.mockImplementation(async (opts: { onConfirmationSpend?: (ids: readonly string[]) => Promise<void> }) => {
        await opts.onConfirmationSpend?.(["c1"]);
        return rejected({ outcome: "rejected-confirmation" });
      });
      await processPromptEvolutionWeekly(MONDAY);
      expect(mocks.runPromptEvolution, bad).toHaveBeenCalledWith(expect.objectContaining({ consumedConfirmationIds: null }));
      expect(mocks.kv.get("prompt_evolution_confirmation_consumed"), bad).toBe(bad);
    }
    // Control: a list of ids is read as given.
    vi.clearAllMocks();
    mocks.kv.set("prompt_evolution_confirmation_consumed", '["c9"]');
    mocks.runPromptEvolution.mockResolvedValue(rejected({ outcome: "rejected-holdout" }));
    await processPromptEvolutionWeekly(MONDAY);
    expect(mocks.runPromptEvolution).toHaveBeenCalledWith(expect.objectContaining({ consumedConfirmationIds: ["c9"] }));

    vi.clearAllMocks();
    mocks.readFails = true;
    await expect(processPromptEvolutionWeekly(MONDAY)).rejects.toThrow(/db read failed/);
    expect(mocks.runPromptEvolution).not.toHaveBeenCalled();
  });

  it("a failed read of last week's row does not fail the run: the previous proposal reads unknown; the same failure on the consumed list does fail it", async () => {
    mocks.kv.set("prompt_evolution_latest", JSON.stringify({ accepted: { promptHash: LIVE_HASH } }));
    mocks.failReadOnce.add("prompt_evolution_latest");
    mocks.runPromptEvolution.mockResolvedValue(resultOf());
    const r = await processPromptEvolutionWeekly(MONDAY);
    expect(r.recordsProcessed).toBe(1);
    expect(latest().previousProposal).toEqual({ candidatePromptHash: null, status: "unknown" });
    expect(telegramText()).toContain("Previous proposal: unknown.");
    expect(mocks.logs.some((l) => l.level === "warn" && /previous result unreadable/.test(l.message))).toBe(true);
    // Control: readable, the same row says "applied" (its hash IS the live prompt's).
    vi.clearAllMocks();
    mocks.kv.set("prompt_evolution_latest", JSON.stringify({ accepted: { promptHash: LIVE_HASH } }));
    await processPromptEvolutionWeekly(MONDAY);
    expect(latest().previousProposal.status).toBe("applied");
    // Control: the one-shot failure on the consumed list is fatal.
    vi.clearAllMocks();
    mocks.failReadOnce.add("prompt_evolution_confirmation_consumed");
    await expect(processPromptEvolutionWeekly(MONDAY)).rejects.toThrow(/db read of prompt_evolution_confirmation_consumed failed/);
    expect(mocks.runPromptEvolution).not.toHaveBeenCalled();
  });

  it("kv prompt_evolution_latest is a pointer: the result + the receipt experimentId + previous-proposal status; the receipt is posted once", async () => {
    // Last week's row is the pre-wiring shape: a proposal with no hash. Its prompt IS what the line serves now.
    mocks.kv.set("prompt_evolution_latest", JSON.stringify({ accepted: { prompt: "the live text" } }));
    mocks.resolveLiveReceptionistBaseline.mockResolvedValue({ promptHash: sha24("the live text") });
    mocks.runPromptEvolution.mockResolvedValue(resultOf({ baseline: { ...resultOf().baseline, promptHash: sha24("the live text") } }));
    const r = await processPromptEvolutionWeekly(MONDAY);
    expect(mocks.postToEvidenceLedger).toHaveBeenCalledTimes(1);
    const [body, opts] = mocks.postToEvidenceLedger.mock.calls[0];
    const experimentId = body.events[0].experiment.experimentId as string;
    expect(experimentId).toMatch(/^prompt-evolution:/);
    expect(opts.idempotencyKey).toBeTruthy();
    const row = latest();
    expect(row).toMatchObject({ experimentId, receiptDelivered: true, evidenceGrade: "H2", promotionStage: "offline_candidate" });
    expect(row.previousProposal).toEqual({ candidatePromptHash: sha24("the live text"), status: "applied" });
    expect(row.accepted.prompt).toBe(CAND_PROMPT); // the one place the full candidate lives
    expect(r.details).toContain(`receipt ${experimentId}`);
    expect(telegramText()).toContain("Previous proposal: applied");
    expect(telegramText()).toContain(`Ledger receipt ${experimentId}: recorded.`);

    // A proposal that is NOT what the line serves now reads not-applied; no proposal reads unknown.
    vi.clearAllMocks();
    mocks.kv.set("prompt_evolution_latest", JSON.stringify({ accepted: { promptHash: "ffffffffffffffffffffffff" } }));
    mocks.runPromptEvolution.mockResolvedValue(resultOf());
    await processPromptEvolutionWeekly(MONDAY);
    expect(latest().previousProposal.status).toBe("not_applied");
    vi.clearAllMocks();
    mocks.kv.set("prompt_evolution_latest", JSON.stringify({ accepted: null }));
    mocks.runPromptEvolution.mockResolvedValue(resultOf());
    await processPromptEvolutionWeekly(MONDAY);
    expect(latest().previousProposal.status).toBe("unknown");
  });

  it("a receipt that cannot be delivered never fails the run; Telegram says it was not recorded", async () => {
    mocks.postToEvidenceLedger.mockRejectedValue(new Error("ledger down"));
    mocks.runPromptEvolution.mockResolvedValue(resultOf());
    const r = await processPromptEvolutionWeekly(MONDAY);
    expect(r.recordsProcessed).toBe(1);
    expect(latest().receiptDelivered).toBe(false);
    expect(telegramText()).toMatch(/Ledger receipt prompt-evolution:\S+: NOT recorded/);
  });

  it("Telegram names every new outcome plainly, says 'proxy lane' only when the lanes differ, and carries hashes, never prompt text", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ outcome: "invalid-evaluator" }, "this run measured nothing and refuted nothing"],
      [{ outcome: "inconclusive-budget", budget: { deadlineMs: 2_700_000, exhaustedAt: "holdout" } }, "stopped at its 45-minute budget before stage holdout"],
      [{ outcome: "rejected-success-regression" }, "The gate held"],
    ];
    for (const [over, phrase] of cases) {
      vi.clearAllMocks();
      mocks.runPromptEvolution.mockResolvedValue(rejected(over));
      await processPromptEvolutionWeekly(MONDAY);
      expect(telegramText()).toContain(phrase);
    }

    vi.clearAllMocks();
    mocks.runPromptEvolution.mockResolvedValue(resultOf({ outcome: "accepted-unconfirmed", promotionStage: "offline_candidate_unconfirmed", accepted: { ...resultOf().accepted, confirmed: false }, gates: { holdout: gateOf(), success: successOf(), confirmation: null }, cohorts: { ...resultOf().cohorts, confirm: 2 } }));
    const r = await processPromptEvolutionWeekly(MONDAY);
    expect(r.recordsProcessed).toBe(1);
    const text = telegramText();
    expect(text).toContain("UNCONFIRMED: 2 sealed seed(s) available, 5 needed");
    expect(text).toContain("Lane: proxy lane.");
    expect(text).toContain(`Candidate ${CAND_HASH.slice(0, 8)}`);
    expect(text).toContain(`live prompt ${LIVE_HASH.slice(0, 8)}`);
    expect(text).not.toContain("UNIQUE-CANDIDATE-PROMPT-TEXT");
    expect(latest().accepted.prompt).toContain("UNIQUE-CANDIDATE-PROMPT-TEXT"); // control: it IS in the run

    vi.clearAllMocks();
    mocks.runPromptEvolution.mockResolvedValue(resultOf({ lanes: { ...resultOf().lanes, parity: true, differences: [] } }));
    await processPromptEvolutionWeekly(MONDAY);
    expect(telegramText()).toContain("Lane: the replay matches the live lane.");
    expect(telegramText()).not.toContain("proxy lane");
    expect(telegramText()).not.toContain("CAUTION"); // control: a code edit carries no placement warning

    // An edit in or after the served lessons block cannot be applied verbatim as a code edit; Telegram says so.
    vi.clearAllMocks();
    mocks.runPromptEvolution.mockResolvedValue(resultOf({ candidateDiff: { ...resultOf().candidateDiff, codeEdit: false } }));
    await processPromptEvolutionWeekly(MONDAY);
    expect(telegramText()).toContain("CAUTION: the edit changes or follows the learned-lessons block");

    // A confirmation that ran and could not reach significance is named as such (not as "did not run").
    vi.clearAllMocks();
    const underpowered = gateOf({ accept: false, reason: "underpowered", comparable: 4, improved: 4, pValue: 0.0625, bestPossibleP: 0.0625 });
    mocks.runPromptEvolution.mockResolvedValue(resultOf({ outcome: "accepted-unconfirmed", promotionStage: "offline_candidate_unconfirmed", accepted: { ...resultOf().accepted, confirmed: false }, gates: { holdout: gateOf(), success: successOf(), confirmation: underpowered } }));
    await processPromptEvolutionWeekly(MONDAY);
    expect(telegramText()).toContain("UNCONFIRMED: the sealed set could not reach significance");
    expect(telegramText()).not.toContain("so confirmation did not run");
  });

  it("Telegram says which prompt was measured: the live one, a diverged live one, or the repository constant", async () => {
    mocks.runPromptEvolution.mockResolvedValue(rejected({ outcome: "rejected-holdout" }));
    await processPromptEvolutionWeekly(MONDAY);
    expect(telegramText()).toContain(`Baseline: live prompt ${LIVE_HASH.slice(0, 8)} on assistant 150fe622 (code_plus_lessons).`);
    expect(telegramText()).not.toContain("diverged"); // control

    vi.clearAllMocks();
    mocks.runPromptEvolution.mockResolvedValue(rejected({ outcome: "rejected-holdout", baseline: { ...resultOf().baseline, parity: "diverged" } }));
    await processPromptEvolutionWeekly(MONDAY);
    expect(telegramText()).toContain("the live prompt has diverged from the repository prompt, so applying a proposal means reconciling the two first");

    vi.clearAllMocks();
    mocks.runPromptEvolution.mockResolvedValue(rejected({ outcome: "rejected-holdout", baseline: { ...resultOf().baseline, source: "repository", assistantId: null } }));
    await processPromptEvolutionWeekly(MONDAY);
    expect(telegramText()).toContain(`Baseline: REPOSITORY prompt ${LIVE_HASH.slice(0, 8)}, NOT the prompt callers hear.`);
  });

  it("the structured '[evolve] result' line carries the baseline and lane fields, and no log line carries prompt text", async () => {
    const BASE_TEXT = `${"y".repeat(300)} UNIQUE-BASELINE-PROMPT-TEXT`;
    mocks.resolveLiveReceptionistBaseline.mockResolvedValue({ promptHash: LIVE_HASH, prompt: BASE_TEXT });
    mocks.runPromptEvolution.mockImplementation(async (opts: { log?: (line: string) => void }) => {
      opts.log?.("holdout gate: improved (test)");
      return resultOf();
    });
    await processPromptEvolutionWeekly(MONDAY);
    const lines = mocks.logs.filter((l) => l.level === "info" && l.message === "[evolve] result");
    expect(lines).toHaveLength(1);
    const payload = lines[0].meta[0] as Record<string, unknown>;
    expect(payload.baseline).toEqual({
      source: "live_provider", assistantId: "150fe622-0b9f-4b03-b8c7-3063812717ae", promptHash: LIVE_HASH,
      providerBehaviorHash: "abcdef0123456789abcdef01", parity: "code_plus_lessons",
    });
    expect(payload.lanes).toEqual({ parity: false, differences: resultOf().lanes.differences });
    expect(payload).toMatchObject({ outcome: "accepted", promotionStage: "offline_candidate", candidateHash: CAND_HASH, experimentId: expect.stringMatching(/^prompt-evolution:/) });
    // No log line, at any level, carries either prompt's text.
    const everything = JSON.stringify(mocks.logs);
    expect(everything).not.toContain("UNIQUE-CANDIDATE-PROMPT-TEXT");
    expect(everything).not.toContain("UNIQUE-BASELINE-PROMPT-TEXT");
    // Controls: both texts were within the job's reach, and the runner's own lines do reach the logger.
    expect(latest().accepted.prompt).toContain("UNIQUE-CANDIDATE-PROMPT-TEXT");
    expect(mocks.runPromptEvolution.mock.calls[0][0].baseline.prompt).toBe(BASE_TEXT);
    expect(mocks.logs.some((l) => l.level === "info" && l.message === "[evolve] holdout gate: improved (test)")).toBe(true);
  });

  it("a receipt that cannot be BUILT never fails the run; Telegram and the kv row say there is none", async () => {
    // An input the builder rejects (no evaluator block): it throws, the job carries on.
    mocks.runPromptEvolution.mockResolvedValue(resultOf({ evaluator: undefined }));
    const r = await processPromptEvolutionWeekly(MONDAY);
    expect(r.recordsProcessed).toBe(1);
    expect(mocks.postToEvidenceLedger).not.toHaveBeenCalled();
    expect(latest()).toMatchObject({ experimentId: null, receiptDelivered: false });
    expect(telegramText()).toContain("Ledger receipt: not built (see logs).");
    expect(mocks.logs.some((l) => l.level === "warn" && l.message === "[evolve] receipt not built")).toBe(true);
  });

  it("prompt_evolution_latest stays inside its TEXT column: an oversized diff loses its line bodies (counts kept), never the candidate", async () => {
    const bigPrompt = `${Array.from({ length: 120 }, (_, i) => `- rule ${i}: ${"w".repeat(240)}`).join("\n")}\nUNIQUE-CANDIDATE-PROMPT-TEXT`;
    const fat = Array.from({ length: 80 }, (_, i) => `${"z".repeat(290)} ${i}`);
    const over = resultOf({
      accepted: { ...resultOf().accepted, prompt: bigPrompt },
      candidateDiff: { startLine: 2, removedCount: 172, addedCount: 176, removed: fat, added: fat, truncated: true, codeEdit: false },
    });
    // Positive control: the row as it stands is over the column, which rejects it.
    expect(Buffer.byteLength(JSON.stringify(over), "utf8")).toBeGreaterThan(TEXT_MAX_BYTES);
    expect(() => assertFits(JSON.stringify(over))).toThrow(/Data too long/);
    mocks.runPromptEvolution.mockResolvedValue(over);
    const r = await processPromptEvolutionWeekly(MONDAY);
    expect(r.recordsProcessed).toBe(1);
    const raw = mocks.kv.get("prompt_evolution_latest")!;
    expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(60_000);
    const row = JSON.parse(raw);
    expect(row.accepted.prompt).toBe(bigPrompt); // the candidate survives whole
    expect(row.candidateDiff).toEqual({ startLine: 2, removedCount: 172, addedCount: 176, removed: [], added: [], truncated: true, codeEdit: false });
    expect(mocks.logs.some((l) => l.level === "warn" && /over its byte budget/.test(l.message))).toBe(true);
    expect(mocks.sendTelegram).toHaveBeenCalledTimes(1);

    // Control: a row that fits keeps its diff lines verbatim and logs no warning.
    vi.clearAllMocks();
    mocks.logs.length = 0;
    mocks.runPromptEvolution.mockResolvedValue(resultOf());
    await processPromptEvolutionWeekly(MONDAY);
    expect(latest().candidateDiff).toEqual(resultOf().candidateDiff);
    expect(mocks.logs.some((l) => /over its byte budget/.test(l.message))).toBe(false);
  });
});
