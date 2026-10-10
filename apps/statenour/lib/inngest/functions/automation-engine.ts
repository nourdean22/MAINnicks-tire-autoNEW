/**
 * Arms the automation engine — hourly, after a rewrite and a reword.
 *
 * WHY HOURLY. Every trigger type is evaluated in ET inside the engine
 * (`getCurrentSlot`-style hour comparison, `todayET` fingerprints), so the
 * dispatcher only has to guarantee it LOOKS every hour. That makes DST a
 * non-issue by construction: at 15:00 and 16:00 UTC the ET hour differs across
 * the year, and an hourly tick is correct in both. A cron pinned to specific
 * UTC hours would have needed the two-candidate trick the 11am rhythm uses.
 *
 * WHY THIS IS SAFE TO ARM NOW, and it was NOT before:
 *
 *   · The executor can actually run the stored actions. Previously every fire
 *     built a DeviceCommand from `action.deviceId`/`action.command`, fields no
 *     stored action has, against two NOT NULL columns with an FK — it threw
 *     every time.
 *   · Repeats are suppressed by fingerprint. 20 of 22 devices have been OFFLINE
 *     since 2026-04-06..14, and at the stored 1-hour cooldown a level-triggered
 *     engine would send 24 messages a day about April. A rule now fires when
 *     its MATCH SET changes.
 *   · The three time rules were reworded in prod on 2026-08-26 (backup:
 *     `_bak_automation_rules_reword_20260826`). They used to ASSERT conditions
 *     their triggers never check — "No new leads today" fired at 6pm on a day
 *     with twenty. They now say what a timer can honestly say. The rule NAME is
 *     part of the sent message, so the names were reworded too.
 *
 * EXPECTED FIRST RUN: one "Camera offline alert" — ten cameras dead since April
 * — then silence until that set changes. Then three scheduled prompts a day at
 * 8am, 2pm and 6pm ET.
 *
 * TWO OFF SWITCHES, neither needing a deploy: disable the rule row
 * (`automation_rules.enabled = false`), or set this cron's manifest entry to
 * mode "retired".
 *
 * THE AUTONOMOUS ENGINE RIDES THIS TICK (2026-10-10). Its rules gate on ET
 * hours too, and its only dispatcher was the 03:00 UTC evening fan-out, which
 * never reaches a daytime gate. The tick calls the ROUTE, not
 * runAutonomousActions directly: the route is the engine's one caller and
 * carries the NICK_AUTONOMY gate, its own /system/crons kill switch, the
 * approval-gate pre-flight and the CronJobLog row (failed, naming the rules,
 * when one errors). Every fire writes its AutonomousAction row first and the
 * loop skips a (rule, target) with a row in the last 20h or since ET midnight,
 * so hourly cannot repeat a send within an ET day. A dispatch failure marks this tick `degraded` rather than
 * throwing, so it neither retries the engine nor pages hourly.
 */
import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { dispatchChild } from "./mega-fanout";
import { automationEngine } from "@/lib/brain/automation-engine";
import { logger } from "@/lib/logger";

const log = logger.withSurface("inngest/automation-engine");
const inngest = getInngest();

const AUTONOMOUS_ROUTE = "/api/cron/autonomous-engine";

export const automationEngineTick = inngest.createFunction(
  {
    id: "automation-engine", // must equal the manifest name - check:crons enforces both directions
    name: "Automation engine · hourly rule evaluation",
    triggers: [{ cron: "0 * * * *" }],
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    // First, so a failing run-rules step cannot starve it (a completed step is
    // memoized across that step's retries).
    const autonomous = await step.run("autonomous-engine", async (): Promise<{
      ok: boolean;
      status?: number;
      error?: string;
    }> => {
      const cronSecret = (process.env.CRON_SECRET ?? "").trim();
      if (!cronSecret) return { ok: false, error: "CRON_SECRET unset" };
      try {
        const r = await dispatchChild(AUTONOMOUS_ROUTE, cronSecret);
        return { ok: true, status: r.status };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    const results = await step.run("run-rules", () => automationEngine.run());

    // Logged every tick including the empty one. "nothing fired" is the common
    // and CORRECT outcome once fingerprints settle, and silence in the log
    // would be indistinguishable from a function that never ran - the exact
    // condition this engine sat in for its whole life.
    const notified = results.reduce((n, r) => n + r.notified, 0);
    const unsupported = results.flatMap((r) => r.unsupported);
    log.info("automation_tick", {
      fired: results.length,
      notified,
      failed: results.filter((r) => !r.success).length,
      unsupported: unsupported.slice(0, 5),
      autonomous,
    });

    return {
      fired: results.length,
      notified,
      unsupported: unsupported.length,
      autonomous,
      // CronLifecycleMiddleware files a declared degradation as `partial`.
      ...(autonomous.ok
        ? {}
        : { degraded: true, degradedReason: `autonomous-engine dispatch: ${autonomous.error}` }),
    };
  },
);
