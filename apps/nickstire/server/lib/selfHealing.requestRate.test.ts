/**
 * Request-rate monitor must not cry wolf after a crawler burst (2026-09-23)
 *
 * WHAT WAS WRONG. Railway deploy log, 2026-09-23: a Baiduspider burst for
 * stale hashed /assets/*.js chunks logged "Request spike detected: 371/min vs
 * baseline 56/min" (13:38:40Z) and "434/min vs baseline 101/min" (13:39:40Z),
 * then "Request drop detected: 5/min vs baseline 125/min (96% drop)" EVERY
 * minute 13:44-13:50Z. The baseline was a plain mean of the last 30 buckets,
 * so two burst minutes inflated it and every normal minute after read as a
 * 90%+ drop; one low minute was enough to warn.
 *
 * WHAT THIS PINS, through the real recordRequest + the real per-tick check:
 *  - the exact log shape (human 5-15/min, a 371 + 434 crawler burst, human
 *    5-15/min again) produces no request_drop;
 *  - the same burst with NO crawler signal (unknown UA, page paths) still
 *    produces no request_drop — the median baseline holds on its own;
 *  - POSITIVE CONTROL: a real collapse to 0/min during shop hours DOES log a
 *    critical request_drop once it has lasted DROP_SUSTAIN minutes — and not
 *    on the first low minute;
 *  - the same collapse after close (23:00 ET) stays quiet;
 *  - crawler UAs and /assets/* are not counted (pinned on its own: the
 *    median alone also keeps test one green, so it cannot prove the filter).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Mod = typeof import("./self-healing");
const HUMAN_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1";
const BAIDU_UA = "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)";

let mod: Mod;
let t: number;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  mod = await import("./self-healing");
});
afterEach(() => {
  vi.useRealTimers();
});

/** One minute of traffic, then the health tick's request-rate pass. */
function minute(n: number, path = "/", ua = HUMAN_UA) {
  vi.setSystemTime(t + 1_000);
  for (let i = 0; i < n; i++) mod.recordRequest(path, ua);
  t += 60_000;
  vi.setSystemTime(t);
  mod.__runRequestAnomalyCheckForTest();
}
const humans = (i: number) => 5 + ((i * 7) % 11); // deterministic 5..15/min
const quiet = (i: number) => 5 + ((i * 5) % 6); // 5..10/min — the log's "5/min" after the burst
const drops = () => mod.generateDiagnosticReport().anomalies.filter(a => a.type === "request_drop");

describe("request-rate anomaly monitor", () => {
  it("the 2026-09-23 log shape (crawler burst, then normal traffic) logs no drop", () => {
    t = Date.parse("2026-09-23T13:18:40Z"); // 09:18 ET, Wednesday — shop open
    for (let i = 0; i < 20; i++) minute(humans(i));
    minute(371, "/assets/index-DeAdBeEf.js", BAIDU_UA);
    minute(434, "/assets/vendor-C0ffee12.js", BAIDU_UA);
    for (let i = 0; i < 12; i++) minute(quiet(i));
    expect(drops()).toEqual([]);
  });

  it("the same burst with no crawler signal still logs no drop (median baseline)", () => {
    t = Date.parse("2026-09-23T13:18:40Z");
    for (let i = 0; i < 20; i++) minute(humans(i));
    minute(371, "/tires", "unknown");
    minute(434, "/services", "unknown");
    for (let i = 0; i < 12; i++) minute(quiet(i));
    expect(drops()).toEqual([]);
  });

  it("POSITIVE CONTROL: a sustained collapse to zero during shop hours alerts critical — not on minute one", () => {
    t = Date.parse("2026-09-23T14:00:00Z"); // 10:00 ET
    for (let i = 0; i < 20; i++) minute(humans(i));
    for (let i = 0; i < 4; i++) minute(0);
    expect(drops()).toEqual([]); // four quiet minutes are not yet an outage
    for (let i = 0; i < 4; i++) minute(0);
    const d = drops();
    expect(d).toHaveLength(1); // logged once at minute five, not every minute
    expect(d[0].severity).toBe("critical");
    expect(d[0].value).toBe(0);
    // Still down at minute 20: re-logged, because the outage minutes are kept
    // out of the baseline instead of teaching it that zero is normal.
    for (let i = 0; i < 12; i++) minute(0);
    expect(drops()).toHaveLength(2);
  });

  it("crawler user agents and /assets/* fetches are not counted as traffic", () => {
    vi.setSystemTime(Date.parse("2026-09-23T14:00:00Z"));
    for (let i = 0; i < 10; i++) mod.recordRequest("/", BAIDU_UA);
    for (let i = 0; i < 10; i++) mod.recordRequest("/assets/index-DeAdBeEf.js", HUMAN_UA);
    for (let i = 0; i < 3; i++) mod.recordRequest("/tires", HUMAN_UA);
    mod.recordRequest(); // callers with no request info still count
    expect(mod.generateDiagnosticReport().requestRate.currentPerMinute).toBe(4);
  });

  it("the same collapse after close (23:00 ET) stays quiet", () => {
    t = Date.parse("2026-09-24T02:40:00Z"); // 22:40 ET
    for (let i = 0; i < 20; i++) minute(humans(i));
    for (let i = 0; i < 10; i++) minute(0);
    expect(drops()).toEqual([]);
  });
});
