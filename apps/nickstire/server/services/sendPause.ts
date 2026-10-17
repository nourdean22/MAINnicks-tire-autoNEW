/**
 * Runtime pause for the env-armed customer-facing send lanes (C5.5, 2026-10-17).
 *
 * The send flags below are environment variables, so before this file the only
 * way to stop one was a Railway env edit and a redeploy. Each lane now also reads
 * a `send_pause_<lane>` row in feature_flags (inverted: TRUE = paused), toggled
 * through the existing audited featureFlags.toggle.
 *
 * Modelled on smsControl.getSmsPauseState: a 5 s cache per process, and a
 * failed read is `readable: false`, never a guess. Each lane checks at three
 * points (round 2, 2026-10-17): its start gate (cached), again before every
 * claim or send inside its loop (a FRESH read, { fresh: true }), and the delayed
 * SMS queue drain (fresh) for texts queued before the pause (confirmations,
 * declined recovery, weather, missed-call recovery). So a pause stops the NEXT
 * send of a running loop, and a run that starts within 5 s of the flip may read
 * the cached state only at its start gate. What an
 * unreadable switch means is the lane's fail class:
 *   - closed: an unattended lane (cron dials or texts with no customer asking)
 *     HOLDS when it cannot read its switch.
 *   - open: customer_confirmations answers a customer's own order action, so a
 *     DB blip must not silence it; it SENDS.
 *
 * Reel publish, autopost and the comment responder are NOT here: they are held
 * by autonomyControl's publishingKillSwitch and their own *_paused flags.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("send-pause");

export type SendPauseFailClass = "closed" | "open";

/** Who is sending. "operator" = a person pressed the button (the manual follow-up call): an UNREADABLE
 *  switch then fails open, as autonomyControl lets operators proceed. An explicit pause still holds. */
export type SendPauseActor = "operator" | "automated";

/** envFlags: each [name, value] is armed only when process.env[name] === value, the comparison the lane's code makes. */
export const SEND_PAUSE_LANES = {
  voice_outbound: {
    key: "send_pause_voice_outbound",
    failClass: "closed",
    envFlags: [["FEATURE_VOICE_RECOVERY", "1"], ["FEATURE_CONFIRMATION_CALLS", "1"], ["FEATURE_FOLLOWUP_CADENCE", "1"]],
  },
  customer_confirmations: {
    key: "send_pause_customer_confirmations",
    failClass: "open",
    envFlags: [["ENABLE_CUSTOMER_CONFIRMATIONS", "true"]],
  },
  declined_recovery: {
    key: "send_pause_declined_recovery",
    failClass: "closed",
    envFlags: [["FEATURE_DECLINED_RECOVERY", "1"]],
  },
  weather_sms: {
    key: "send_pause_weather_sms",
    failClass: "closed",
    envFlags: [["WEATHER_SMS_SEND", "1"]],
  },
  missed_call_recovery: {
    key: "send_pause_missed_call_recovery",
    failClass: "closed",
    envFlags: [["MISSED_CALL_RECOVERY_SEND", "1"]],
  },
} as const satisfies Record<string, { key: string; failClass: SendPauseFailClass; envFlags: ReadonlyArray<readonly [string, string]> }>;

export type SendPauseLane = keyof typeof SEND_PAUSE_LANES;

export interface SendPauseState {
  paused: boolean;
  /** false = the switch could not be read; shouldHold decides by fail class. */
  readable: boolean;
}

const CACHE_MS = 5_000;
const cache = new Map<SendPauseLane, { state: SendPauseState; expiresAt: number }>();

/** opts.fresh: skip the cache (and refresh it). For the per-item checks inside send loops: a cached answer
 *  lets a fast loop finish on the state it read at its start gate (Codex P1, round 2). */
export async function sendPause(lane: SendPauseLane, opts: { fresh?: boolean } = {}): Promise<SendPauseState> {
  const now = Date.now();
  const hit = cache.get(lane);
  if (!opts.fresh && hit && hit.expiresAt > now) return hit.state;
  let state: SendPauseState;
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) {
      state = { paused: false, readable: false };
    } else {
      // Raw execute for the same reason as getSmsPauseState: `key` is reserved,
      // and execute is the surface every db mock in the serial suite provides.
      const [rows] = await db.execute(sql`
        SELECT \`value\` AS v FROM feature_flags WHERE \`key\` = ${SEND_PAUSE_LANES[lane].key} LIMIT 1
      `);
      const first = Array.isArray(rows) ? (rows[0] as { v?: unknown } | undefined) : undefined;
      // Missing row = never paused (readable: we got an answer).
      state = { paused: first != null && (first.v === 1 || first.v === true || first.v === "1"), readable: true };
    }
  } catch (err) {
    log.debug("send pause read failed", { lane, error: err instanceof Error ? err.message : String(err) });
    state = { paused: false, readable: false };
  }
  cache.set(lane, { state, expiresAt: now + CACHE_MS });
  return state;
}

/** The whole decision, pure: hold when paused, or when unreadable on a fail-closed lane with no operator present. */
export function shouldHold(lane: SendPauseLane, state: SendPauseState, actor: SendPauseActor = "automated"): boolean {
  if (state.readable) return state.paused;
  if (actor === "operator") return false;
  return SEND_PAUSE_LANES[lane].failClass === "closed";
}

/**
 * The one call a chokepoint makes, before any spend or provider call.
 * null = send. Otherwise the reason the lane records on its existing skip path.
 */
export async function sendPauseHoldReason(
  lane: SendPauseLane,
  actor: SendPauseActor = "automated",
  opts: { fresh?: boolean } = {},
): Promise<string | null> {
  const state = await sendPause(lane, opts);
  const hold = shouldHold(lane, state, actor);
  if (!state.readable) {
    log.warn(`send pause switch unreadable for ${lane} (${actor}); ${hold ? "holding (fail closed)" : "sending (fail open)"}`, { lane, actor });
  }
  if (!hold) return null;
  return state.readable ? `send_pause:${lane}` : `send_pause_unreadable:${lane}`;
}

/** Whether the lane's env flag is armed, compared exactly as the lane's code compares it. */
export function envArmed(lane: SendPauseLane, env: Record<string, string | undefined> = process.env): boolean {
  return SEND_PAUSE_LANES[lane].envFlags.some(([name, value]) => env[name] === value);
}

/**
 * Contract sendSwitchesStatus v1.1 (client: the send switches card). v1.1 adds heldQueued (additive).
 * paused is null when the switch could not be read: UNKNOWN, never false.
 * heldQueued: texts in the delayed SMS queue mapped to this lane, which go out
 * when the lane is resumed; null when the queue could not be read.
 */
export interface SendSwitchesStatus {
  lanes: Array<{
    lane: SendPauseLane;
    paused: boolean | null;
    readable: boolean;
    failClass: SendPauseFailClass;
    envArmed: boolean | null;
    heldQueued: number | null;
  }>;
}

export async function readSendSwitchesStatus(
  env: Record<string, string | undefined> = process.env,
  countQueued: () => Promise<Map<SendPauseLane, number> | null> = async () => (await import("../sms")).countQueuedByLane(),
): Promise<SendSwitchesStatus> {
  const out: SendSwitchesStatus["lanes"] = [];
  const queued = await countQueued().catch(() => null);
  // Sequential on purpose: five one-row reads, and concurrent first-time dynamic
  // imports of a mocked ../db fail under vitest, which would read as UNKNOWN.
  for (const lane of Object.keys(SEND_PAUSE_LANES) as SendPauseLane[]) {
    const s = await sendPause(lane);
    out.push({
      lane,
      paused: s.readable ? s.paused : null,
      readable: s.readable,
      failClass: SEND_PAUSE_LANES[lane].failClass,
      envArmed: envArmed(lane, env),
      heldQueued: queued ? (queued.get(lane) ?? 0) : null,
    });
  }
  return { lanes: out };
}

/** Test hook: the 5 s cache would otherwise leak across serial test files. */
export function _resetSendPauseCacheForTest(): void {
  cache.clear();
}
