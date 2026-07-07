/**
 * event-triggers · "Event-driven proactivity" · v-truth (2026-06-03)
 *
 * Today proactivity is cron-polled (nick-action-proposal at 8am UTC →
 * proposeNickActions → AutonomousAction(pending) rows). That means an
 * urgent operator signal that lands at 9am waits ~23h for the next
 * poll. This Inngest EVENT-triggered function closes that lag: it
 * reacts to an urgent brain-bus signal in SECONDS and writes ONE
 * pending proposal into the /qa approval queue immediately.
 *
 * FAIL-CLOSED · this NEVER executes or sends anything. It writes a
 * single AutonomousAction(approval="pending") row — exactly the same
 * shape the 8am proposer writes — and stops. The operator approves
 * via /qa (Telegram) or /system/approvals; only THEN does the
 * autonomous-engine execute the deferred side effect. Mirrors the
 * proposer's contract (see app/api/cron/nick-action-proposal/route.ts).
 *
 * GATE · self-gates on NICK_EVENT_TRIGGERS (default-OFF). Flag off =
 * the function returns a no-op without touching the DB. Independent of
 * the NICK_AUTONOMY gate on the poll proposer — this is the real-time
 * lane; the operator opts into it separately on Railway.
 *
 * EVENT · listens for `nick/urgent.signal`, sent from the brain-bus
 * emit site when a drift alert fires (emitDriftFired) — a drift alert
 * IS an urgent operator signal the bus already produces. See the
 * registration recipe in the PR notes for the one-line `inngest.send`
 * to add alongside that emit.
 *
 * IDEMPOTENCY · idempotencyKey = `nick_event::<ruleId>::<date>` so a
 * retried event (Inngest retries on transient failure) or two emits in
 * the same day collapse to ONE pending row (AutonomousAction has a
 * partial-unique on idempotencyKey; the create is wrapped so a
 * collision is a clean no-op).
 *
 * Per kaizen + karpathy · simplest thing that adds the real-time lane:
 * no new table, reuses the AutonomousAction(pending) contract, one
 * event listener. Adding richer event sources later is additive (more
 * `inngest.send` sites + a switch on event.data.signal).
 */

import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("inngest/event-triggers");
const inngest = getInngest();

/** Event name the brain-bus emit site sends. Kept as a const so the
 *  producer side (recipe) and this consumer reference one string. */
export const URGENT_SIGNAL_EVENT = "nick/urgent.signal";

/**
 * Payload contract for `nick/urgent.signal`. The producer (brain-bus
 * emit) fills this from the drift alert it's already constructing.
 */
export interface UrgentSignalData {
  /** Stable id of the source signal (e.g. drift ruleId) for dedupe. */
  signalId: string;
  /** Short kind tag · "drift" today; switch on this as sources grow. */
  signal: string;
  /** One-line "what fired" for the queue row's trigger column. */
  trigger: string;
  /** Operator-facing rationale rendered in /qa + /system/approvals. */
  rationale: string;
}

/**
 * Write the pending proposal. Returns the created row id, or null when
 * gated off / deduped / payload invalid — never throws for those
 * (only a real DB error propagates, so Inngest retries it).
 */
async function proposeFromSignal(data: UrgentSignalData): Promise<string | null> {
  const { getFlag } = await import("@/lib/feature-flags");
  if (!getFlag("NICK_EVENT_TRIGGERS")?.isOn) {
    log.info("event_trigger_gated_off", { signal: data.signal });
    return null;
  }

  // Defensive · a malformed event must not write a junk row.
  if (!data.signalId || !data.trigger) {
    log.warn("event_trigger_bad_payload", { signal: data.signal });
    return null;
  }

  const { prisma } = await import("@/lib/prisma");
  const today = new Date().toISOString().slice(0, 10);
  const idempotencyKey = `nick_event::${data.signalId}::${today}`.slice(0, 64);

  try {
    const row = await prisma.autonomousAction.create({
      data: {
        ruleName: `nick_event_${data.signal}`,
        trigger: data.trigger.slice(0, 240),
        actionType: "review_signal",
        targetType: "signal",
        targetId: data.signalId,
        payload: {
          rationale: data.rationale,
          signal: data.signal,
          source: "event-trigger",
          queueDate: today,
        } as never,
        // FAIL-CLOSED · pending = waits for /qa approval; nothing runs.
        approval: "pending",
        idempotencyKey,
      },
      select: { id: true },
    });
    log.info("event_trigger_proposed", { id: row.id, signal: data.signal, idempotencyKey });
    return row.id;
  } catch (err) {
    // P2002 = the same signal already queued today (Inngest retry or a
    // duplicate emit). That's the idempotent happy path, not a failure.
    if ((err as { code?: string }).code === "P2002") {
      log.info("event_trigger_deduped", { idempotencyKey });
      return null;
    }
    throw err; // real DB error · let Inngest retry.
  }
}

export const nickEventTriggers = inngest.createFunction(
  {
    id: "nick-event-triggers",
    name: "Nick event-driven proactivity · urgent signal → /qa queue",
    retries: 2,
    triggers: [{ event: URGENT_SIGNAL_EVENT }],
    onFailure: onInngestFailure,
  },
  async ({ event, step }) => {
    const data = event.data as UrgentSignalData;
    const proposedId = await step.run("propose-from-signal", () =>
      proposeFromSignal(data),
    );

    return {
      proposed: proposedId !== null,
      proposedId,
      signal: data?.signal ?? null,
    };
  },
);
