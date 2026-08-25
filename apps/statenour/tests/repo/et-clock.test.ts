/**
 * The operator's wall clock, not the server's.
 *
 * THE DEFECT, 2026-08-23. His phone read 5:21 PM. Nick's reply opened
 * "Sunday night, 9:20pm. Shop's closed." and closed "Late night, Sunday. This is
 * the loop where you ruminate and degrade Monday." Exactly +4h — the ET offset.
 *
 * It is not "off by four hours", it is in the wrong FRAME. Nick's posture is
 * keyed to time of day, so it told him he was in a late-Sunday-night rumination
 * loop at five in the afternoon, and every behavioural inference downstream was
 * anchored to a state he was not in.
 *
 * MECHANISM, measured rather than guessed. Railway runs the server in UTC, so
 * `new Date().getHours()` returns 21 at 5pm ET:
 *
 *     TZ unset   local getHours 17 · Intl ET hour 17 → "afternoon"
 *     TZ=UTC     local getHours 21 · Intl ET hour 17 → "afternoon"
 *
 * The prompt's own temporal block was CORRECT and is TZ-proof — it uses explicit
 * Intl with America/New_York. The damage came from every other producer using
 * the bare form and feeding Nick a UTC clock as the operator's wall time.
 *
 * WHY A FORCED-TZ TEST AND NOT JUST ASSERTIONS. This bug exists *because*
 * something inherited its timezone from the process. A test that passes only
 * because CI happens to run in UTC — or only because a laptop happens to run in
 * ET — proves nothing about the machine that actually broke. Each case below
 * runs the real code in a child process with TZ forced to a zone that is
 * neither, so agreement cannot be an accident of where the test ran.
 *
 * AND WHY THE LINT SHIPS WITH IT. `lib/utils/datetime.ts` already exported
 * `hourET()`/`weekdayET()` and already documented the reason in a comment that
 * reads like a postmortem. It reached 108 files and stopped at 28 others. The
 * knowledge was never the missing piece — the enforcement was. Fixing the call
 * sites without `scripts/check-et-clock.mjs` would guarantee a next one.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

/** Run an expression under a forced TZ, in a real child process. */
function underTZ(tz: string, expr: string): string {
  return execFileSync(process.execPath, ["-e", `process.stdout.write(String(${expr}))`], {
    env: { ...process.env, TZ: tz },
    encoding: "utf8",
  }).trim();
}

const ET_HOUR =
  `new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"2-digit",hour12:false})` +
  `.format(new Date(Date.UTC(2026,7,23,21,21)))`;

const ZONES = ["UTC", "Asia/Tokyo", "America/Los_Angeles", "America/New_York"];

describe("ET readings survive the process timezone", () => {
  it("THE ARTEFACT: 21:21 UTC is 5pm ET, not 9pm, in EVERY zone", () => {
    // The exact moment from the incident. If any zone disagrees, the reading is
    // inheriting the process clock — which is the whole bug.
    for (const tz of ZONES) {
      const hour = Number(underTZ(tz, ET_HOUR)) % 24;
      expect(hour, `TZ=${tz} produced hour ${hour}`).toBe(17);
    }
  });

  it("the BARE form is genuinely broken — proving the test can tell them apart", () => {
    // The positive control, and it is the load-bearing one. If bare getHours()
    // returned the same value everywhere, the assertion above would be vacuous
    // and would have passed over the live defect.
    const bareUtc = Number(underTZ("UTC", "new Date(Date.UTC(2026,7,23,21,21)).getHours()"));
    const bareEt = Number(underTZ("America/New_York", "new Date(Date.UTC(2026,7,23,21,21)).getHours()"));
    expect(bareUtc, "server-side, this is what Nick was told").toBe(21);
    expect(bareEt).toBe(17);
    expect(bareUtc).not.toBe(bareEt);
  });

  it("the bucket lands in AFTERNOON under UTC, not evening", () => {
    // bucketFromHour: <18 afternoon, <22 evening. 21 crosses into evening, which
    // is what let the model narrate "9:20pm ... late night".
    const bucket = (h: number) =>
      h < 6 ? "late" : h < 11 ? "morning" : h < 14 ? "midday" : h < 18 ? "afternoon" : h < 22 ? "evening" : "late";
    for (const tz of ZONES) {
      expect(bucket(Number(underTZ(tz, ET_HOUR)) % 24), `TZ=${tz}`).toBe("afternoon");
    }
    expect(bucket(21), "the UTC reading — a different frame entirely").toBe("evening");
  });

  it("the WEEKDAY flips a day early under UTC, which has no visible symptom", () => {
    // Between 8pm and midnight ET the UTC weekday is already tomorrow, so any
    // weekday-gated automation fires a day early for four hours nightly. Unlike
    // the greeting, this produces no absurd sentence — nothing looks wrong.
    const at = "new Date(Date.UTC(2026,7,24,1,0))"; // 9pm ET Sunday = Mon 01:00Z
    expect(Number(underTZ("UTC", `${at}.getDay()`)), "UTC says Monday").toBe(1);
    expect(Number(underTZ("America/New_York", `${at}.getDay()`)), "ET says Sunday").toBe(0);
  });
});

describe("the lint makes the bare form unrepresentable", () => {
  const run = () => {
    try {
      return { code: 0, out: execFileSync(process.execPath, ["scripts/check-et-clock.mjs"], { encoding: "utf8" }) };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  };

  it("passes on the current tree", () => {
    const r = run();
    expect(r.out).toContain("no bare getHours()/getDay()");
    expect(r.code).toBe(0);
  });

  it("CANARY: it FAILS when a bare reading is reintroduced", () => {
    // Break it, assert red, restore — a gate nobody proved fires is one nobody
    // knows is connected. Written to a real tracked file because the lint walks
    // `git ls-files`, so a temp file outside the index would not be scanned and
    // the canary would pass without testing anything.
    const { readFileSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    const victim = "lib/floating-home/smart-now.ts";
    const original = readFileSync(victim, "utf8");
    try {
      writeFileSync(victim, `${original}\n// canary\nconst _h = new Date().getHours();\n`, "utf8");
      const r = run();
      expect(r.code, "the lint did not fire on a reintroduced bare getHours()").toBe(1);
      expect(r.out).toContain(victim);
      expect(r.out, "the message must name the fix, not just refuse").toContain("hourET()");
    } finally {
      writeFileSync(victim, original, "utf8");
    }
    expect(run().code, "restore failed — the tree is dirty").toBe(0);
  });

  it("every allowlist entry carries a reason", () => {
    // An unexplained exemption is how a gate becomes theatre: the next reader
    // cannot tell a deliberate UTC quantity from someone silencing a failure.
    const src = readFileSyncSafe("scripts/check-et-clock.mjs");
    const entries = [...src.matchAll(/\{\s*path:\s*"([^"]+)",\s*reason:\s*"([^"]*)"/g)];
    expect(entries.length).toBeGreaterThan(3);
    for (const [, path, reason] of entries) {
      expect(reason.length, `${path} has an empty reason`).toBeGreaterThan(20);
    }
    const bare = [...src.matchAll(/\{\s*path:\s*"[^"]+"\s*\}/g)];
    expect(bare.length, "an allowlist entry with no reason field").toBe(0);
  });
});

function readFileSyncSafe(p: string): string {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  return readFileSync(p, "utf8");
}
