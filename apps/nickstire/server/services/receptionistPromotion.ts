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
 * DISARMED. AUTO_PROMOTE_ARMED is false in W2: a winner is recorded as
 * would_promote and nothing is pushed. W3 adds the live canary, automatic
 * rollback and the one-tap undo, then arms it; that PR is the announcement to
 * the manager before the first live auto-promotion can fire.
 *
 * Every outcome is one history row (autoPromote.ts appendPromotionHistory) and
 * one plain line for the run's Telegram. Prompt text never reaches a log.
 */
import { createHash, randomUUID } from "node:crypto";
import { createLogger } from "../lib/logger";
import {
  appendPromotionHistory,
  applyOverlay,
  buildOverlay,
  decideReceptionistPromotion,
  promotionHistoryKey,
  RECEPTIONIST_LOOP,
  type PromotionRecord,
  type PromotionStatus,
} from "./autoPromote";

const log = createLogger("auto-promote");

/** W3 flips this, together with the canary, rollback and undo. */
export const AUTO_PROMOTE_ARMED = false;

/** Kill switch (shop_settings kv). "true" = paused; a missing row = running; an unreadable row = paused. */
export const KILL_SWITCH_KEY = "auto_promote_paused";
/** The prompt callers heard before the latest promotion: { versionId, promptHash, prompt }. */
export const STABLE_KEY = "autopromote_receptionist_prompt_stable";
/** The promoted edit as find/replace for updateAssistant: { versionId, candidateHash, baseHash, find, replace }. */
export const OVERLAY_KEY = "autopromote_receptionist_overlay";

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
  const finish = async (claimed: string, status: PromotionStatus, reason: string | null): Promise<void> => {
    const rows = JSON.parse(claimed) as PromotionRecord[];
    rows[0] = record(status, reason);
    if (!(await deps.kvCompareAndSet(HISTORY_KEY, claimed, JSON.stringify(rows)))) {
      log.warn("[auto-promote] history moved under a claimed promotion; final status not recorded", { versionId, status });
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
  try {
    const raw = await deps.kvGet(KILL_SWITCH_KEY);
    paused = raw !== null && raw.trim().toLowerCase() === "true";
  } catch {
    paused = null;
  }

  const decision = decideReceptionistPromotion({
    paused,
    outcome: input.outcome,
    confirmed: input.accepted?.confirmed ?? false,
    parity: input.baseline.parity,
    codeEdit: input.candidateDiff?.codeEdit ?? null,
    basePrompt: input.baseline.prompt,
    candidatePrompt: input.accepted?.prompt ?? null,
    codePrompt: deps.codePrompt,
  });

  if (decision.verdict === "hold") {
    await swapHistory(historyRaw, record("held", decision.reason));
    return result("held", decision.reason, `held (${decision.reason}). The live prompt is unchanged.`);
  }
  if (!deps.armed) {
    await swapHistory(historyRaw, record("would_promote", null));
    return result("would_promote", null, `would promote ${short(candidateHash)} (passed every gate; auto-promote is not armed yet, nothing pushed).`);
  }

  // 1 · Claim. The loser of the swap acts on nothing.
  const claimed = await swapHistory(historyRaw, record("promoting", null));
  if (claimed === null) return { status: "duplicate", reason: "claimed_by_another_run", versionId: null, line: "Auto-promote: another run holds this promotion." };

  const assistantId = input.baseline.assistantId;
  const candidate = input.accepted!.prompt;
  if (!assistantId) {
    await finish(claimed, "held", "no_assistant");
    return result("held", "no_assistant", "held (the run measured no live assistant).");
  }

  // 2 · The live prompt must still be the one measured.
  const live = await readLive(deps, assistantId);
  const livePrompt = live ? systemPromptOf(live) : null;
  if (!live || livePrompt === null) {
    await finish(claimed, "held", "live_unreadable");
    return result("held", "live_unreadable", "held, the live assistant could not be read (nothing pushed).");
  }
  if (sha24(livePrompt) !== input.baseline.promptHash) {
    await finish(claimed, "held", "live_changed_since_measured");
    return result("held", "live_changed_since_measured", "held, the live prompt changed after tonight's run measured it (nothing pushed).");
  }

  // 3 · Snapshot for undo.
  await deps.kvSet(STABLE_KEY, JSON.stringify({ versionId, promptHash: input.baseline.promptHash, prompt: livePrompt, at: deps.now().toISOString() }));

  // 4 · Push the system prompt only.
  const metadata = { ...(live.metadata ?? {}), nickPromptHash: sha24(candidate), nickPromptVersion: versionId };
  let pushed: Response | null = null;
  try {
    pushed = await deps.patchAssistant(assistantId, { model: withSystemPrompt(live, candidate), metadata });
  } catch {
    pushed = null;
  }
  if (!pushed?.ok) {
    await finish(claimed, "push_failed", pushed ? `http_${pushed.status}` : "network");
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
    await finish(claimed, "readback_restored", reason);
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
  await finish(claimed, "promoted", null);
  return result("promoted", null, `PROMOTED ${short(sha24(candidate))} to the live receptionist (was ${short(input.baseline.promptHash)}), read-back verified, version ${versionId.slice(0, 8)}.`);
}

/**
 * The promoted edit, as the nightly push wrote it. null = none. Throws when the
 * row cannot be read, so the caller can say the edit may be dropped.
 */
export async function readPromotedOverlay(): Promise<{ find: string; replace: string; versionId: string } | null> {
  const raw = await promotionKv.get(OVERLAY_KEY);
  if (raw === null) return null;
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
  const applied = applyOverlay(codePrompt, overlay);
  if (applied === null) {
    log.warn("[auto-promote] overlay stale; manual push serves the code prompt", { versionId: overlay.versionId });
    return { prompt: codePrompt, warning: `The auto-promoted edit ${overlay.versionId} no longer fits the code prompt; this push serves the code prompt without it.` };
  }
  return { prompt: applied };
}

/** shop_settings kv with a real compare-and-swap (UPDATE ... WHERE value = expected; INSERT when expected is null). */
export const promotionKv = {
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
  };
}
