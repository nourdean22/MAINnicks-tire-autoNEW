/**
 * Prove at boot that this container can actually resolve the shop's timezone.
 *
 * WHY THIS EXISTS
 * Every wall-clock-gated automation here compares a computed "ET hour" against a
 * target hour: the daily reel post, the 8AM-8PM TCPA sending window, the
 * best-posting-hour optimiser, quiet hours. All of them route through
 * `toLocaleString(..., { timeZone: BUSINESS.timezone })`.
 *
 * That call does NOT throw when the runtime has no IANA timezone database. Node
 * silently falls back to UTC, so `America/New_York` returns UTC and every one of
 * those comparisons is wrong by the current offset (4 or 5 hours) — while every
 * log line still says "ET" and every job still reports success.
 *
 * WHAT THIS DOES NOT DO
 * It does not correct the time. A hardcoded offset would be worse than the bug:
 * the SAME conversion records `hourOfDay` in the Instagram analytics pipeline,
 * so the data feeding the "best hour to post" model would be skewed by the
 * offset while the poster silently compensated for it, and the two errors would
 * hide each other. If the tz data is missing, the image needs fixing (full-icu /
 * tzdata) — this just refuses to let that go unnoticed.
 *
 * An audit claimed the production container is 4 hours off. On a machine WITH tz
 * data the computation is correct (verified: computed hour == real ET hour), and
 * the failure direction of a missing database would be +4, not −4 — so the
 * claim's direction was likely backwards. Rather than guess about a container
 * this code cannot inspect from a dev box, this reports what is actually true
 * wherever it runs.
 */
import { BUSINESS } from "@shared/business";
import { createLogger } from "./logger";

const log = createLogger("lib:timezoneAssert");

/** US Eastern is UTC−5 (EST) or UTC−4 (EDT). Anything else means broken tz data. */
const VALID_OFFSETS_HOURS = [-5, -4];

export interface TimezoneCheck {
  ok: boolean;
  timezone: string;
  offsetHours: number;
  detail: string;
}

/**
 * The shop's current wall-clock hour (0-23) in business time.
 *
 * Every send/call window gate compares against this, so it MUST fail closed: an
 * unparseable hour has to land on a value the callers' range checks REJECT, not
 * on NaN. `NaN < 15 || NaN >= 18` evaluates to `false`, so a bare `parseInt`
 * silently OPENS a quiet-hours guard instead of holding it shut. Two inlined
 * copies of this logic did exactly that (confirmationCalls, voiceRecovery) while
 * the two named copies fell back to 0 and held. 0 is midnight, which sits
 * outside every business window here, so it is the correct closed value.
 *
 * `hour12: false` can also emit "24" rather than "00" just past midnight on some
 * engines, hence the `% 24`.
 */
export function getBusinessHour(now: Date = new Date()): number {
  const part =
    new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS.timezone,
      hour: "2-digit",
      hour12: false,
    })
      .formatToParts(now)
      .find((p) => p.type === "hour")?.value ?? "0";
  const n = parseInt(part, 10);
  return Number.isFinite(n) ? n % 24 : 0;
}

/**
 * Compute the runtime's current UTC offset for the business timezone.
 *
 * Uses the difference between the same instant formatted as UTC and as the
 * target zone, which is exactly the quantity every wall-clock gate depends on.
 */
export function checkBusinessTimezone(now: Date = new Date()): TimezoneCheck {
  const tz = BUSINESS.timezone;
  try {
    const hourIn = (timeZone: string) =>
      Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).format(now));

    const utcHour = hourIn("UTC");
    const localHour = hourIn(tz);

    // Wrap into (−12, +12] so a day boundary between the two zones does not
    // read as a ±20-hour offset.
    let offsetHours = localHour - utcHour;
    if (offsetHours > 12) offsetHours -= 24;
    if (offsetHours < -12) offsetHours += 24;

    const ok = VALID_OFFSETS_HOURS.includes(offsetHours);
    return {
      ok,
      timezone: tz,
      offsetHours,
      detail: ok
        ? `${tz} resolves to UTC${offsetHours} — correct`
        : `${tz} resolves to UTC${offsetHours >= 0 ? "+" : ""}${offsetHours}, expected -4 or -5. ` +
          `The container is missing IANA timezone data, so every wall-clock-gated job ` +
          `(daily reel post, 8AM-8PM SMS window, best-posting-hour) is off by ${Math.abs(offsetHours)}h ` +
          `while still reporting success. Fix the image (full-icu / tzdata) — do NOT add an offset in code.`,
    };
  } catch (err) {
    return {
      ok: false,
      timezone: tz,
      offsetHours: 0,
      detail: `timezone resolution threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Run the check at boot and make a failure impossible to miss. Never throws —
 * a broken clock should degrade the schedule, not prevent the site from serving.
 */
export async function assertBusinessTimezoneAtBoot(): Promise<TimezoneCheck> {
  const result = checkBusinessTimezone();
  if (result.ok) {
    log.info(`timezone OK — ${result.detail}`);
    return result;
  }

  log.error(`TIMEZONE MISCONFIGURED — ${result.detail}`);
  try {
    const { sendTelegramMessage } = await import("../services/telegram");
    await sendTelegramMessage(`🕐 TIMEZONE BROKEN ON BOOT\n\n${result.detail}`, "critical");
  } catch (err) {
    log.warn("could not send timezone alert", { error: err instanceof Error ? err.message : String(err) });
  }
  return result;
}
