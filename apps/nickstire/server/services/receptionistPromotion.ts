/**
 * Receptionist auto-promotion (job 2026-10-31-self-learning-nickstire, W2).
 *
 * After each nightly prompt experiment, a candidate that passed the offline
 * gate AND the sealed confirmation, and clears autoPromote.ts's floors, is
 * pushed to the live receptionist with no tap. Nour, 2026-10-30: "it should me
 * autonomys self learning getting smarter and smarter ... every day". The
 * manager's rule: autonomous and daily, behind the gate.
 *
 * THE PUSH (manager ruling 2026-10-31). Never updateAssistant: it rebuilds the
 * whole config from code + lessons, so an automatic push through it would also
 * ship every merged change that is still waiting for Nour's Push Config tap
 * (prompt edits, the transfer plan). Here only the system message changes:
 *   1. claim  compare-and-swap on the history row; a loser acts on nothing;
 *   2. read   GET the live assistant; its system prompt must still be the one
 *             the run measured (hash), else nothing is pushed;
 *   3. snapshot the live prompt to kv (STABLE_KEY), for undo;
 *   4. PATCH  { model: live.model with the system message replaced, metadata };
 *             Vapi replaces the whole model object, so every other model field
 *             is sent back exactly as read (docs.vapi.ai, read 2026-10-31);
 *   5. read-back GET; a system prompt that is not the candidate is restored
 *             from the snapshot at once.
 * On success the edit is written as an overlay (OVERLAY_KEY) that
 * updateAssistant applies to the code prompt, so Nour's next manual push keeps
 * it instead of silently reverting it.
 *
 * ARMED IN CODE, OFF IN THE DATA. AUTO_PROMOTE_ARMED is true since W3 (the
 * canary, automatic rollback and the one-tap undo exist), but the kill switch
 * row starts missing, which reads as paused: nothing goes live until Nour taps
 * RESUME SELF-LEARNING once in /admin > VAPI (ruling 2026-10-31, so the first
 * live auto-promotion is announced before it can fire). Before the claim the
 * gate also holds a promotion still in flight, a candidate that was rolled
 * back or undone before, and a baseline too thin for the canary to judge.
 *
 * Every outcome is one history row (autoPromote.ts appendPromotionHistory) and
 * one plain line for the run's Telegram. Prompt text never reaches a log.
 */
import { createHash, randomUUID } from "node:crypto";
import { createLogger } from "../lib/logger";
import { CANARY, evaluateCanary, type CallCounts } from "./receptionistCanary";
import {
  appendPromotionHistory,
  applyOverlay,
  buildOverlay,
  decideReceptionistPromotion,
  openPromotion,
  promotionHistoryKey,
  promotionInFlight,
  takenBackBefore,
  RECEPTIONIST_LOOP,
  type PromotionRecord,
  type PromotionStatus,
} from "./autoPromote";

const log = createLogger("auto-promote");

/** Armed in W3 (2026-10-31), with the canary, automatic rollback and Nour's undo in place. */
const AUTO_PROMOTE_ARMED = true;

/** Kill switch (shop_settings kv). false/0/no/off/running = running; a missing row (never switched on), anything else or an unreadable row = paused. */
const KILL_SWITCH_KEY = "auto_promote_paused";
/** The prompt callers heard before the latest promotion: { versionId, promptHash, prompt }. */
const STABLE_KEY = "autopromote_receptionist_prompt_stable";
/** The promoted edit as find/replace for updateAssistant: { versionId, candidateHash, baseHash, find, replace }. */
const OVERLAY_KEY = "autopromote_receptionist_overlay";

const HISTORY_KEY = promotionHistoryKey(RECEPTIONIST_LOOP);

export interface PromotionDeps {
  armed: boolean;
  /** ASSISTANT_SYSTEM_PROMPT (services/vapi.ts). */
  codePrompt: string;
  now: () => Date;
  kvGet: (key: string) => Promise<string | null>;
  kvSet: (key: string, value: string) => Promise<void>;
  /** Writes `next` only when the stored value is still `expected` (null = no row). true = this caller won. */
  kvCompareAndSet: (key: string, expected: string | null, next: string) => Promise<boolean>;
  getAssistant: (assistantId: string) => Promise<Response>;
  patchAssistant: (assistantId: string, body: { model: Record<string, unknown>; metadata: Record<string, unknown> }) => Promise<Response>;
  /** W3 canary reads: evaluated calls that heard the promoted prompt, and the assistant's calls before it. null = the read failed. */
  canaryCounts: (q: { assistantId: string; promptHash: string; promotedAt: string; baselineDays: number }) => Promise<{ before: CallCounts | null; after: CallCounts | null }>;
}

/** The slice of a nightly run this needs (EvolutionResult + the full live baseline). */
export interface PromotionInput {
  outcome: string;
  accepted: { prompt: string; promptHash: string; confirmed: boolean } | null;
  candidateDiff: { codeEdit: boolean | null } | null;
  baseline: { assistantId: string | null; prompt: string; promptHash: string; parity: string };
}

export interface PromotionResult {
  status: PromotionStatus | "duplicate";
  reason: string | null;
  versionId: string | null;
  /** One plain line for the run's Telegram summary. */
  line: string;
}

const sha24 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);
const short = (h: string | null) => (h ? h.slice(0, 8) : "none");

interface LiveAssistant {
  model?: { messages?: Array<{ role?: string; content?: unknown }> } & Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

function systemPromptOf(a: LiveAssistant): string | null {
  const msg = a.model?.messages?.find((m) => m.role === "system");
  return typeof msg?.content === "string" ? msg.content : null;
}

/** live.model with the system message's content replaced; every other field as read. */
function withSystemPrompt(a: LiveAssistant, prompt: string): Record<string, unknown> {
  const messages = (a.model?.messages ?? []).map((m) => (m.role === "system" ? { ...m, content: prompt } : m));
  return { ...a.model, messages };
}

async function readLive(deps: PromotionDeps, assistantId: string): Promise<LiveAssistant | null> {
  try {
    const res = await deps.getAssistant(assistantId);
    if (!res.ok) return null;
    return (await res.json()) as LiveAssistant;
  } catch {
    return null;
  }
}

export async function promoteReceptionistCandidate(input: PromotionInput, deps: PromotionDeps): Promise<PromotionResult> {
  const versionId = randomUUID();
  const candidateHash = input.accepted?.promptHash ?? null;
  const record = (status: PromotionStatus, reason: string | null): PromotionRecord => ({
    versionId,
    at: deps.now().toISOString(),
    loop: RECEPTIONIST_LOOP,
    status,
    reason,
    baseHash: input.baseline.promptHash,
    candidateHash,
  });

  // Every write to the history is a swap against what was read, so two runners
  // never both believe they recorded the same night.
  const historyRaw = await deps.kvGet(HISTORY_KEY);
  const swapHistory = async (expected: string | null, rec: PromotionRecord): Promise<string | null> => {
    const next = appendPromotionHistory(expected, rec);
    if (next === null) return null;
    return (await deps.kvCompareAndSet(HISTORY_KEY, expected, next)) ? next : null;
  };
  const finish = async (status: PromotionStatus, reason: string | null): Promise<void> => {
    if (!(await settleClaim(deps, versionId, "promoting", record(status, reason)))) {
      log.warn("[auto-promote] claimed promotion row not found; final status not recorded", { versionId, status });
    }
  };
  const result = (status: PromotionResult["status"], reason: string | null, line: string): PromotionResult => {
    log.info("[auto-promote] receptionist", { versionId, status, reason, baseHash: input.baseline.promptHash, candidateHash });
    return { status, reason, versionId, line: `Auto-promote: ${line}` };
  };

  if (historyRaw !== null && appendPromotionHistory(historyRaw, record("held", null)) === null) {
    return result("held", "history_unreadable", "held, the promotion history row does not parse (nothing pushed; check kv).");
  }

  let paused: boolean | null;
  let switchRow: string | null = null;
  try {
    switchRow = await deps.kvGet(KILL_SWITCH_KEY);
    paused = parsePaused(switchRow);
  } catch {
    paused = null;
  }
  // A fresh deploy never promotes on its own: until Nour taps RESUME once, the
  // row is missing and every night holds (ruling 2026-10-31, the first live
  // promotion is announced before it can fire).
  if (paused === true && switchRow === null) {
    await swapHistory(historyRaw, record("held", "not_switched_on"));
    return result("held", "not_switched_on", "held, self-learning is not switched on (tap RESUME SELF-LEARNING in /admin > VAPI to let gated winners go live).");
  }

  const rows = historyRaw === null ? [] : (JSON.parse(historyRaw) as PromotionRecord[]);
  const decision = decideReceptionistPromotion({
    paused,
    outcome: input.outcome,
    confirmed: input.accepted?.confirmed ?? false,
    parity: input.baseline.parity,
    codeEdit: input.candidateDiff?.codeEdit ?? null,
    basePrompt: input.baseline.prompt,
    candidatePrompt: input.accepted?.prompt ?? null,
    codePrompt: deps.codePrompt,
    canaryOpen: openPromotion(rows) !== null,
    promotionInFlight: promotionInFlight(rows),
    candidateTakenBack: takenBackBefore(rows, candidateHash),
  });

  if (decision.verdict === "hold") {
    await swapHistory(historyRaw, record("held", decision.reason));
    return result("held", decision.reason, `held (${decision.reason}). The live prompt is unchanged.`);
  }
  if (!deps.armed) {
    await swapHistory(historyRaw, record("would_promote", null));
    return result("would_promote", null, `would promote ${short(candidateHash)} (passed every gate; auto-promote is not armed yet, nothing pushed).`);
  }

  // The canary needs a baseline to judge against; without one it would roll the
  // edit back unconditionally the next night, so it never goes live. A failed
  // read holds too (never read as zero, never as enough).
  if (input.baseline.assistantId) {
    let before: CallCounts | null = null;
    try {
      before = (await deps.canaryCounts({ assistantId: input.baseline.assistantId, promptHash: candidateHash ?? "", promotedAt: deps.now().toISOString(), baselineDays: CANARY.baselineDays })).before;
    } catch {
      before = null;
    }
    const why = before === null ? "canary_baseline_unreadable" : before.evaluated < CANARY.minBaseline ? "canary_unmeasurable" : null;
    if (why) {
      await swapHistory(historyRaw, record("held", why));
      const detail = before === null ? "the call history could not be read" : `${before.evaluated} evaluated calls in ${CANARY.baselineDays} days, the canary needs ${CANARY.minBaseline}`;
      return result("held", why, `held (${why}: ${detail}). The live prompt is unchanged.`);
    }
  }

  // 1 · Claim. The loser of the swap acts on nothing.
  const claimed = await swapHistory(historyRaw, record("promoting", null));
  if (claimed === null) return { status: "duplicate", reason: "claimed_by_another_run", versionId: null, line: "Auto-promote: another run holds this promotion." };

  const assistantId = input.baseline.assistantId;
  const candidate = input.accepted!.prompt;
  if (!assistantId) {
    await finish("held", "no_assistant");
    return result("held", "no_assistant", "held (the run measured no live assistant).");
  }

  // 2 · The live prompt must still be the one measured.
  const live = await readLive(deps, assistantId);
  const livePrompt = live ? systemPromptOf(live) : null;
  if (!live || livePrompt === null) {
    await finish("held", "live_unreadable");
    return result("held", "live_unreadable", "held, the live assistant could not be read (nothing pushed).");
  }
  if (sha24(livePrompt) !== input.baseline.promptHash) {
    await finish("held", "live_changed_since_measured");
    return result("held", "live_changed_since_measured", "held, the live prompt changed after tonight's run measured it (nothing pushed).");
  }

  // 3 · Snapshot for undo.
  await deps.kvSet(
    STABLE_KEY,
    JSON.stringify({ versionId, assistantId, promptHash: input.baseline.promptHash, candidateHash: sha24(candidate), prompt: livePrompt, at: deps.now().toISOString() }),
  );

  // 4 · Push the system prompt only.
  // The webhook copies metadata.nickBehaviorHash into every call's evidence, so
  // it must change with the prompt: derived from the hash updateAssistant
  // stamped (kept as nickBehaviorHashBase) and the new prompt text's hash.
  const baseBehavior = typeof live.metadata?.nickBehaviorHash === "string" ? live.metadata.nickBehaviorHash : "none";
  const metadata = {
    ...(live.metadata ?? {}),
    nickBehaviorHash: sha24(`${baseBehavior}|prompt:${sha24(candidate)}`),
    nickBehaviorHashBase: baseBehavior,
    nickPromptHash: sha24(candidate),
    nickPromptVersion: versionId,
  };
  let pushed: Response | null = null;
  try {
    pushed = await deps.patchAssistant(assistantId, { model: withSystemPrompt(live, candidate), metadata });
  } catch {
    pushed = null;
  }
  if (!pushed?.ok) {
    await finish("push_failed", pushed ? `http_${pushed.status}` : "network");
    return result("push_failed", pushed ? `http_${pushed.status}` : "network", "the push was refused; the live prompt is unchanged.");
  }

  // 5 · Read back; anything but the candidate is restored from the snapshot.
  const after = await readLive(deps, assistantId);
  const afterPrompt = after ? systemPromptOf(after) : null;
  if (afterPrompt === null || sha24(afterPrompt) !== sha24(candidate)) {
    const restored = await deps
      .patchAssistant(assistantId, { model: withSystemPrompt(live, livePrompt), metadata: { ...(live.metadata ?? {}) } })
      .then((r) => r.ok)
      .catch(() => false);
    const reason = restored ? "readback_mismatch" : "readback_mismatch_restore_failed";
    await finish("readback_restored", reason);
    return result(
      "readback_restored",
      reason,
      restored
        ? "the push did not read back as the candidate; the previous prompt was restored."
        : "the push did not read back as the candidate AND the restore failed: check the receptionist now.",
    );
  }

  const overlay = buildOverlay(input.baseline.prompt, candidate);
  if (overlay) {
    await deps.kvSet(OVERLAY_KEY, JSON.stringify({ versionId, candidateHash: sha24(candidate), baseHash: input.baseline.promptHash, ...overlay, at: deps.now().toISOString() }));
  }
  await finish("promoted", null);
  return result("promoted", null, `PROMOTED ${short(sha24(candidate))} to the live receptionist (was ${short(input.baseline.promptHash)}), read-back verified, version ${versionId.slice(0, 8)}.`);
}

/**
 * The promoted edit, as the nightly push wrote it. null = none. Throws when the
 * row cannot be read, so the caller can say the edit may be dropped.
 */
async function readPromotedOverlay(): Promise<{ find: string; replace: string; versionId: string } | null> {
  const raw = await promotionKv.get(OVERLAY_KEY);
  // A rollback writes "null": the edit is gone, nothing to carry.
  if (raw === null || raw.trim() === "" || raw.trim() === "null") return null;
  const parsed = JSON.parse(raw) as { find?: unknown; replace?: unknown; versionId?: unknown };
  if (typeof parsed.find !== "string" || typeof parsed.replace !== "string" || typeof parsed.versionId !== "string") {
    throw new Error("overlay row does not parse");
  }
  return { find: parsed.find, replace: parsed.replace, versionId: parsed.versionId };
}

/**
 * For updateAssistant (a manual Push Latest Config): the code prompt with the
 * promoted edit applied, so a manual push never silently reverts it. When the
 * code moved and the edit no longer fits once, code wins and the warning says so.
 * Never throws: an unreadable overlay pushes the code prompt with a warning.
 */
export async function applyPromotedOverlay(codePrompt: string): Promise<{ prompt: string; warning?: string }> {
  let overlay: Awaited<ReturnType<typeof readPromotedOverlay>>;
  try {
    overlay = await readPromotedOverlay();
  } catch (err) {
    log.warn("[auto-promote] overlay unreadable; manual push serves the code prompt", { error: err instanceof Error ? err.message : String(err) });
    return { prompt: codePrompt, warning: "The auto-promoted edit could not be read; this push serves the code prompt without it." };
  }
  if (!overlay) return { prompt: codePrompt };
  // Nour copied the edit into the code (the propose-only path): nothing to add, nothing stale.
  if (overlay.replace && codePrompt.replace(/\r\n/g, "\n").includes(overlay.replace)) return { prompt: codePrompt };
  const applied = applyOverlay(codePrompt, overlay);
  if (applied === null) {
    log.warn("[auto-promote] overlay stale; manual push serves the code prompt", { versionId: overlay.versionId });
    return { prompt: codePrompt, warning: `The auto-promoted edit ${overlay.versionId} no longer fits the code prompt; this push serves the code prompt without it.` };
  }
  return { prompt: applied };
}

/** shop_settings kv with a real compare-and-swap (UPDATE ... WHERE value = expected; INSERT when expected is null). */
const promotionKv = {
  async get(key: string): Promise<string | null> {
    const { getDb } = await import("../db");
    const { eq } = await import("drizzle-orm");
    const { shopSettings } = await import("../../drizzle/schema");
    const d = await getDb();
    if (!d) throw new Error("database unavailable");
    const rows = await d.select().from(shopSettings).where(eq(shopSettings.key, key)).limit(1);
    return rows[0]?.value ?? null;
  },
  async set(key: string, value: string): Promise<void> {
    const { getDb } = await import("../db");
    const { eq } = await import("drizzle-orm");
    const { shopSettings } = await import("../../drizzle/schema");
    const d = await getDb();
    if (!d) throw new Error("database unavailable");
    const existing = await d.select({ id: shopSettings.id }).from(shopSettings).where(eq(shopSettings.key, key)).limit(1);
    if (existing.length > 0) await d.update(shopSettings).set({ value, updatedBy: "system" }).where(eq(shopSettings.key, key));
    else await d.insert(shopSettings).values({ key, value, label: `Auto-promote: ${key}`, category: "general", updatedBy: "system" });
  },
  async compareAndSet(key: string, expected: string | null, next: string): Promise<boolean> {
    const { getDb } = await import("../db");
    const { and, eq } = await import("drizzle-orm");
    const { shopSettings } = await import("../../drizzle/schema");
    const d = await getDb();
    if (!d) throw new Error("database unavailable");
    if (expected === null) {
      try {
        await d.insert(shopSettings).values({ key, value: next, label: `Auto-promote: ${key}`, category: "general", updatedBy: "system" });
        return true;
      } catch (err) {
        // The unique key on `key`: another runner inserted first.
        const { isDuplicateKeyError } = await import("../lib/dbErrors");
        if (isDuplicateKeyError(err)) return false;
        throw err;
      }
    }
    const res = await d
      .update(shopSettings)
      .set({ value: next, updatedBy: "system" })
      .where(and(eq(shopSettings.key, key), eq(shopSettings.value, expected)));
    const header = (Array.isArray(res) ? res[0] : res) as { affectedRows?: number };
    return header?.affectedRows === 1;
  },
};

/** The real dependencies: shop_settings kv, the live Vapi assistant, the code prompt. */
export async function productionPromotionDeps(): Promise<PromotionDeps> {
  const vapi = await import("./vapi");
  return {
    armed: AUTO_PROMOTE_ARMED,
    codePrompt: vapi.ASSISTANT_SYSTEM_PROMPT,
    now: () => new Date(),
    kvGet: promotionKv.get,
    kvSet: promotionKv.set,
    kvCompareAndSet: promotionKv.compareAndSet,
    getAssistant: vapi.fetchAssistantById,
    patchAssistant: vapi.patchAssistantPromptOnly,
    canaryCounts: readCanaryCounts,
  };
}

/** The won-call outcomes, as the offline success cohort reads them (promptEvolution.ts). */
const SUCCESS_OUTCOMES = ["hard_conversion", "walk_in_directed", "resolved_info"] as const;

/**
 * Evaluated calls on the assistant: AFTER = calls whose evidence names the
 * promoted prompt; BEFORE = the baseline window before the promotion. Ages are
 * computed in SQL (TiDB DATETIME comes back shifted on ET). A failed read is
 * null, never a zero.
 */
async function readCanaryCounts(q: { assistantId: string; promptHash: string; promotedAt: string; baselineDays: number }): Promise<{ before: CallCounts | null; after: CallCounts | null }> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const d = await getDb();
  if (!d) return { before: null, after: null };
  const sinceSec = Math.max(0, Math.floor((Date.now() - new Date(q.promotedAt).getTime()) / 1000));
  const untilSec = sinceSec + q.baselineDays * 86_400;
  const success = sql.join(SUCCESS_OUTCOMES.map((o) => sql`${o}`), sql`, `);
  const read = async (where: ReturnType<typeof sql>): Promise<CallCounts | null> => {
    try {
      const [rows] = (await d.execute(sql`
        SELECT COUNT(*) AS evaluated,
               COALESCE(SUM(CASE WHEN eval_outcome IN (${success}) THEN 1 ELSE 0 END), 0) AS success
        FROM vapi_call_logs
        WHERE eval_outcome IS NOT NULL
          AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.behavior.assistantId')) = ${q.assistantId}
          AND ${where}
      `)) as unknown as [Array<{ evaluated: unknown; success: unknown }>];
      const row = rows?.[0];
      if (!row) return null;
      return { evaluated: Number(row.evaluated), success: Number(row.success) };
    } catch (err) {
      log.warn("[auto-promote] canary read failed", { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  };
  return {
    after: await read(sql`JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.behavior.promptHash')) = ${q.promptHash}`),
    before: await read(sql`TIMESTAMPDIFF(SECOND, createdAt, NOW()) > ${sinceSec} AND TIMESTAMPDIFF(SECOND, createdAt, NOW()) <= ${untilSec}`),
  };
}

// ── W3: the canary, automatic rollback and Nour's undo ─────────────────────

export interface CanaryCheckResult {
  status: "watching" | "unknown" | "canary_passed" | "rolled_back" | "rollback_failed" | "duplicate" | "held";
  reason: string | null;
  /** One plain line for the run's Telegram summary. */
  line: string;
}

export interface UndoResult {
  status: "undone" | "rollback_failed" | "duplicate" | "nothing_to_undo" | "held";
  reason: string | null;
  line: string;
}

/** The stable snapshot the promotion wrote: the prompt callers heard before it. */
interface StableSnapshot {
  versionId: string;
  assistantId: string;
  promptHash: string;
  prompt: string;
}

function parseStable(raw: string | null): StableSnapshot | null {
  if (raw === null) return null;
  try {
    const s = JSON.parse(raw) as Partial<StableSnapshot>;
    return typeof s.versionId === "string" && typeof s.assistantId === "string" && typeof s.promptHash === "string" && typeof s.prompt === "string"
      ? (s as StableSnapshot)
      : null;
  } catch {
    return null;
  }
}

function parseHistory(raw: string | null): PromotionRecord[] | null {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PromotionRecord[]) : null;
  } catch {
    return null;
  }
}

/**
 * Replace this run's claim row (found by versionId and claim status) with its
 * end state. Other rows may have been prepended since the claim (a held night,
 * a pause), so it re-reads and swaps, a few times, instead of assuming row 0.
 */
async function settleClaim(deps: PromotionDeps, versionId: string, claimStatus: PromotionStatus, rec: PromotionRecord): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await deps.kvGet(HISTORY_KEY);
    const rows = parseHistory(raw);
    const at = rows ? rows.findIndex((r) => r.versionId === versionId && r.status === claimStatus) : -1;
    if (!rows || at < 0) return false;
    rows[at] = rec;
    if (await deps.kvCompareAndSet(HISTORY_KEY, raw, JSON.stringify(rows))) return true;
  }
  return false;
}

/**
 * Take the open promotion back: claim (compare-and-swap a rolling_back row; a
 * loser acts on nothing), restore the stable snapshot when the live prompt is
 * still the promoted one, else reverse the edit on whatever is live (a manual
 * push happened since, and the rest of that push stays), read back, clear the
 * overlay so the next manual push does not bring the edit back.
 */
async function rollBack(deps: PromotionDeps, status: "rolled_back" | "undone", reason: string): Promise<{ status: "rolled_back" | "undone" | "rollback_failed" | "duplicate" | "nothing_to_undo" | "held"; reason: string | null; line: string }> {
  const raw = await deps.kvGet(HISTORY_KEY);
  const rows = parseHistory(raw);
  if (rows === null) return { status: "held", reason: "history_unreadable", line: "Auto-promote: the history row does not parse; nothing rolled back (check kv)." };
  const open = openPromotion(rows);
  if (!open) return { status: "nothing_to_undo", reason: null, line: "Auto-promote: nothing is promoted right now." };
  const row = (s: PromotionStatus, why: string | null): PromotionRecord => ({ ...open, at: deps.now().toISOString(), status: s, reason: why });

  const claimNext = appendPromotionHistory(raw, row("rolling_back", reason));
  if (claimNext === null || !(await deps.kvCompareAndSet(HISTORY_KEY, raw, claimNext))) {
    return { status: "duplicate", reason: "claimed_by_another_run", line: "Auto-promote: another rollback holds this promotion." };
  }
  const finish = async (s: PromotionStatus, why: string | null): Promise<void> => {
    if (!(await settleClaim(deps, open.versionId, "rolling_back", row(s, why)))) {
      log.warn("[auto-promote] claimed rollback row not found; final status not recorded", { versionId: open.versionId, status: s });
    }
  };
  const failed = async (why: string, line: string) => {
    await finish("rollback_failed", why);
    // The next manual push must not bring the edit back.
    await deps.kvSet(OVERLAY_KEY, "null");
    log.warn("[auto-promote] rollback failed", { versionId: open.versionId, why });
    return { status: "rollback_failed" as const, reason: why, line: `Auto-promote: ROLLBACK FAILED (${why}). ${line} Check the receptionist now.` };
  };

  const stable = parseStable(await deps.kvGet(STABLE_KEY));
  if (!stable || stable.versionId !== open.versionId) return failed("snapshot_missing", "The stable snapshot does not match the promotion.");
  const live = await readLive(deps, stable.assistantId);
  const livePrompt = live ? systemPromptOf(live) : null;
  if (!live || livePrompt === null) return failed("live_unreadable", "The live assistant could not be read.");

  let target: string | null;
  if (sha24(livePrompt) === open.candidateHash) {
    target = stable.prompt;
  } else {
    // A manual push since: take only the learned edit back out of the live text.
    let overlay: { find: string; replace: string } | null = null;
    try {
      overlay = await readOverlayVia(deps);
    } catch {
      overlay = null;
    }
    target = overlay ? applyOverlay(livePrompt, { find: overlay.replace, replace: overlay.find }) : null;
    if (target === null) return failed("edit_not_found_live", "The live prompt changed and the learned edit could not be found in it.");
  }

  const meta: Record<string, unknown> = { ...(live.metadata ?? {}) };
  const base = typeof meta.nickBehaviorHashBase === "string" ? meta.nickBehaviorHashBase : null;
  delete meta.nickPromptHash;
  delete meta.nickPromptVersion;
  delete meta.nickBehaviorHashBase;
  if (base && target === stable.prompt && sha24(livePrompt) === open.candidateHash) meta.nickBehaviorHash = base;
  else if (typeof meta.nickBehaviorHash === "string") meta.nickBehaviorHash = sha24(`${meta.nickBehaviorHash}|prompt:${sha24(target)}`);

  const ok = await deps
    .patchAssistant(stable.assistantId, { model: withSystemPrompt(live, target), metadata: meta })
    .then((r) => r.ok)
    .catch(() => false);
  if (!ok) return failed("push_refused", "Vapi refused the rollback push.");
  const after = await readLive(deps, stable.assistantId);
  const afterPrompt = after ? systemPromptOf(after) : null;
  if (afterPrompt === null || sha24(afterPrompt) !== sha24(target)) return failed("readback_mismatch", "The rollback did not read back.");

  await deps.kvSet(OVERLAY_KEY, "null");
  await finish(status, reason);
  log.info("[auto-promote] rolled back", { versionId: open.versionId, status, reason, restoredHash: sha24(target) });
  const verb = status === "undone" ? "UNDONE by Nour" : `ROLLED BACK (${reason})`;
  return { status, reason, line: `Auto-promote: ${verb}: ${short(open.candidateHash)} is off the live receptionist, ${short(sha24(target))} serves again, read-back verified.` };
}

/** The overlay row through the injected kv (rollback runs on the same deps as the push). */
async function readOverlayVia(deps: PromotionDeps): Promise<{ find: string; replace: string } | null> {
  const raw = await deps.kvGet(OVERLAY_KEY);
  if (raw === null || raw.trim() === "" || raw.trim() === "null") return null;
  const o = JSON.parse(raw) as { find?: unknown; replace?: unknown };
  return typeof o.find === "string" && typeof o.replace === "string" ? { find: o.find, replace: o.replace } : null;
}

/**
 * Nightly, before the experiment: read the open promotion's canary and act on
 * it. null = nothing promoted. A failed read keeps the canary open (UNKNOWN).
 */
export async function checkReceptionistCanary(deps: PromotionDeps): Promise<CanaryCheckResult | null> {
  const raw = await deps.kvGet(HISTORY_KEY);
  const rows = parseHistory(raw);
  if (rows === null) return { status: "held", reason: "history_unreadable", line: "Canary: the history row does not parse (check kv)." };
  const open = openPromotion(rows);
  if (!open || !open.candidateHash) return null;
  const stable = parseStable(await deps.kvGet(STABLE_KEY));
  let counts: { before: CallCounts | null; after: CallCounts | null } = { before: null, after: null };
  if (stable) {
    try {
      counts = await deps.canaryCounts({ assistantId: stable.assistantId, promptHash: open.candidateHash, promotedAt: open.at, baselineDays: CANARY.baselineDays });
    } catch {
      counts = { before: null, after: null };
    }
  }
  const v = evaluateCanary({ now: deps.now(), promotedAt: new Date(open.at), before: counts.before, after: counts.after });
  const tally = counts.after ? `${counts.after.success}/${counts.after.evaluated} won since` : "unread";
  const baseTally = counts.before ? `${counts.before.success}/${counts.before.evaluated} before` : "unread";
  if (v.verdict === "unknown") return { status: "unknown", reason: v.reason, line: `Canary: ${short(open.candidateHash)} could not be measured tonight (read failed); it stays live and open.` };
  if (v.verdict === "watching") return { status: "watching", reason: null, line: `Canary: ${short(open.candidateHash)} watching, ${tally} vs ${baseTally} (needs ${CANARY.minCalls}).` };
  if (v.verdict === "passed") {
    const next = appendPromotionHistory(raw, { ...open, at: deps.now().toISOString(), status: "canary_passed", reason: `z=${v.z.toFixed(2)}` });
    if (next === null || !(await deps.kvCompareAndSet(HISTORY_KEY, raw, next))) return { status: "duplicate", reason: "claimed_by_another_run", line: "Canary: another run is acting on this promotion." };
    return { status: "canary_passed", reason: null, line: `Canary: ${short(open.candidateHash)} PASSED, ${tally} vs ${baseTally}; it stays.` };
  }
  const r = await rollBack(deps, "rolled_back", `canary_${v.reason}`);
  return { status: r.status === "nothing_to_undo" ? "held" : r.status === "undone" ? "rolled_back" : r.status, reason: r.reason, line: `${r.line} (${tally} vs ${baseTally})` };
}

/** Nour's one-tap undo: the same rollback, recorded as his. */
export async function undoReceptionistPromotion(deps: PromotionDeps): Promise<UndoResult> {
  const r = await rollBack(deps, "undone", "operator");
  return { status: r.status === "rolled_back" ? "undone" : r.status, reason: r.reason, line: r.line };
}

// ── W3: the /admin card (VAPI panel) ───────────────────────────────────────

/**
 * Runs only on an explicit "false" / "0" / "no" / "off" / "running" (what the
 * RESUME tap writes). A missing row (never switched on) or anything else is
 * paused: fail closed (ruling 2026-10-31).
 */
function parsePaused(raw: string | null): boolean {
  return raw === null || !/^(?:false|0|no|off|running)$/i.test(raw.trim());
}

export interface AutoPromoteStatus {
  armed: boolean;
  /** null = the kill switch row could not be read (the nightly gate then holds). */
  paused: boolean | null;
  /** The promotion whose canary is open; null when none. Hashes only, never prompt text. */
  open: { versionId: string; at: string; candidateHash: string | null; baseHash: string } | null;
  /** Newest first, at most 6. null = the history row could not be read or parsed. */
  recent: Array<{ at: string; status: PromotionStatus; reason: string | null; candidateHash: string | null }> | null;
}

/** For the admin card: three states, never two. An unreadable row is null, never an empty list. */
export async function readAutoPromoteStatus(): Promise<AutoPromoteStatus> {
  let paused: boolean | null;
  try {
    paused = parsePaused(await promotionKv.get(KILL_SWITCH_KEY));
  } catch {
    paused = null;
  }
  let rows: PromotionRecord[] | null;
  try {
    rows = parseHistory(await promotionKv.get(HISTORY_KEY));
  } catch {
    rows = null;
  }
  const open = rows ? openPromotion(rows) : null;
  return {
    armed: AUTO_PROMOTE_ARMED,
    paused,
    open: open ? { versionId: open.versionId, at: open.at, candidateHash: open.candidateHash, baseHash: open.baseHash } : null,
    recent: rows ? rows.slice(0, 6).map((r) => ({ at: r.at, status: r.status, reason: r.reason, candidateHash: r.candidateHash })) : null,
  };
}

/** Nour's pause switch (kv, never a Railway variable). Pausing stops new promotions; a live one stays until its canary or his undo. */
export async function setAutoPromotePaused(paused: boolean): Promise<{ paused: boolean }> {
  await promotionKv.set(KILL_SWITCH_KEY, paused ? "true" : "false");
  log.info("[auto-promote] pause switch set", { paused });
  return { paused };
}
