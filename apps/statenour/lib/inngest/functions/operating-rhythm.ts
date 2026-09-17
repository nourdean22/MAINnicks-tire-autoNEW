/**
 * The 11am ET mid-morning check — a finished feature that had never run.
 *
 * `lib/brain/operating-rhythm.ts` `executeRhythm` is complete and defended:
 * slot-gated, kill-switched, idempotent per slot/day, retry-safe on a Telegram
 * outage. It had ZERO callers since it was written — every other mention of the
 * name in the repo is inside its own file (twelve logError context strings and
 * the export). The flag that gates it, `autopilot_flags.adhd_operating_rhythm`,
 * reads TRUE in prod: the operator turned it on and nothing ever asked.
 *
 * THE SCHEDULE IS `0 15,16 * * *`, AND THE TWO HOURS ARE THE POINT.
 * `getCurrentSlot()` gates on the ET hour (11 -> "mid_morning"). One fixed UTC
 * time cannot hold 11am ET across DST: `0 15` is 11am EDT in summer and 10am
 * EST in winter, at which point the gate returns null and the feature silently
 * retires itself every November — the exact frame-drift class the clock work
 * spent this session removing.
 *
 * So it fires at BOTH candidate hours and lets the ET-anchored gate pick the
 * real one. The other tick is a cheap no-op ("Not a rhythm slot hour"), and a
 * double send is impossible either way: executeRhythm checks
 * rhythmAlreadyPushed(slot, day) before sending and only marks pushed after
 * Telegram accepts, so an outage stays retryable while a success cannot repeat.
 *
 * NO SLOT ARGUMENT IS PASSED, deliberately. Passing "mid_morning" would bypass
 * the gate and send a message headed "MID-MORNING CHECK - 11:00 AM" at whatever
 * hour the trigger happened to fire. The gate is the feature.
 *
 * TWO WAYS TO STOP IT, neither needing a deploy: set
 * `autopilot_flags.adhd_operating_rhythm = false`, or flip this cron's entry in
 * config/crons.ts to mode "retired".
 */
import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { executeRhythm } from "@/lib/brain/operating-rhythm";
import { logger } from "@/lib/logger";
import { recordSelfRow } from "../self-row";

const log = logger.withSurface("inngest/operating-rhythm");
const inngest = getInngest();

export const operatingRhythm = inngest.createFunction(
  {
    id: "operating-rhythm", // must equal the manifest name - check:crons enforces both directions
    name: "Operating rhythm · 11am ET mid-morning check",
    triggers: [{ cron: "0 15,16 * * *" }],
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    await recordSelfRow(step, "operating-rhythm");
    const result = await step.run("execute-rhythm", () => executeRhythm());

    // Logged at info either way. "did not send" is the COMMON outcome — one of
    // the two daily ticks is always the wrong ET hour — and a silent no-op
    // would be indistinguishable from a function that never ran.
    log.info("operating_rhythm_tick", {
      slot: result.slot,
      sent: result.sent,
      reason: result.sent ? null : result.message.slice(0, 80),
    });

    return { slot: result.slot, sent: result.sent, reason: result.message.slice(0, 120) };
  },
);
