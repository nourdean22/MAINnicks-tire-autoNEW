/**
 * Snooze presets keep the promise the resurface cron can deliver (job
 * 2026-10-23, map F7). The only reviver is cron task-resurface, once a day at
 * 09:00 UTC (config/crons.ts). A 06:00 ET snooze is 10:00Z in summer and
 * 11:00Z in winter, AFTER that run, so "tomorrow" came back the day after
 * (about 47 hours). Presets now land at midnight ET of the target day, and the
 * copy promises "by 5 am", which the 09:00Z run meets in both EDT (05:00) and
 * EST (04:00).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { nextMondayMorning, RESURFACE_HOUR_UTC, inDaysMorning, tomorrowMorning } from "@/lib/missions/snooze-presets";

/** The first resurface run at or after `until`: the instant the task is back on the page. */
function revivedAt(untilIso: string): Date {
  const until = new Date(untilIso);
  const run = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate(), RESURFACE_HOUR_UTC));
  return run.getTime() >= until.getTime() ? run : new Date(run.getTime() + 86_400_000);
}
const etParts = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" })
    .formatToParts(d)
    .reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});

describe("snooze presets vs the resurface cron", () => {
  it("the cron schedule the presets assume is the one config/crons.ts ships", () => {
    const src = readFileSync(path.join(__dirname, "../../../config/crons.ts"), "utf8");
    const block = src.slice(src.indexOf('name: "task-resurface"'), src.indexOf('name: "task-resurface"') + 120);
    expect(block).toContain(`schedule: "0 ${RESURFACE_HOUR_UTC} * * *"`);
  });

  for (const [label, now, wantDay] of [
    ["EDT, late evening", new Date("2026-10-20T02:30:00Z"), "20"], // Mon Oct 19 22:30 EDT
    ["EST, late evening", new Date("2026-12-08T03:30:00Z"), "08"], // Mon Dec 7 22:30 EST
    ["EDT, morning", new Date("2026-10-19T13:00:00Z"), "20"], // Mon Oct 19 09:00 EDT
  ] as const) {
    it(`tomorrow is back on the next ET day by 5 am (${label})`, () => {
      const back = etParts(revivedAt(tomorrowMorning(now)));
      expect(back.day).toBe(wantDay);
      expect(Number(back.hour)).toBeLessThanOrEqual(5);
    });
  }

  it("a week out is back on that ET day by 5 am, across the November DST change", () => {
    const now = new Date("2026-10-30T23:00:00Z"); // Fri Oct 30 19:00 EDT, DST ends Nov 1
    const back = etParts(revivedAt(inDaysMorning(7, now)));
    expect(back.day).toBe("06");
    expect(Number(back.hour)).toBeLessThanOrEqual(5);
  });

  it("next Monday lands on a Monday by 5 am ET, and skips to the following Monday on a Monday", () => {
    const monday = new Date("2026-10-19T14:00:00Z");
    const back = etParts(revivedAt(nextMondayMorning(monday)));
    expect(back.weekday).toBe("Mon");
    expect(back.day).toBe("26");
    expect(Number(back.hour)).toBeLessThanOrEqual(5);
  });
});
