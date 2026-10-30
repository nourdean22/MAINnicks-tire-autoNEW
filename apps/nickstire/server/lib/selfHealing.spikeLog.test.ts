/**
 * "Request spike detected" logs once per spike, not once per minute (railway-audit, 2026-10-30)
 *
 * Railway logs, 07:14-12:55Z on 2026-10-30: 37 "Request spike detected" warnings in 23
 * episodes; consecutive spike minutes each logged again at the same severity. A warning that
 * repeats every minute hides the next new one.
 *
 * Pins, through the real recordRequest + the real per-tick check, counting the logger's
 * stdout lines:
 *  - two spike minutes in a row at the same severity log ONE warning;
 *  - POSITIVE CONTROL: a spike after a normal minute logs again (a new episode);
 *  - an escalation from warning to critical inside one episode logs again;
 *  - the spike anomaly is still RECORDED every minute (the health report is unchanged).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Mod = typeof import("./self-healing");
const HUMAN_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1";

let mod: Mod;
let t: number;
let lines: string[];

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  lines = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
  mod = await import("./self-healing");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function minute(n: number) {
  vi.setSystemTime(t + 1_000);
  for (let i = 0; i < n; i++) mod.recordRequest("/", HUMAN_UA);
  t += 60_000;
  vi.setSystemTime(t);
  mod.__runRequestAnomalyCheckForTest();
}
const humans = (i: number) => 8 + (i % 5); // 8..12/min, median 10
const spikeWarns = () => lines.filter((l) => l.includes("Request spike detected")).length;
const spikes = () => mod.generateDiagnosticReport().anomalies.filter((a) => a.type === "request_spike");

describe("request spike warning: once per episode", () => {
  beforeEach(() => {
    t = Date.parse("2026-10-30T14:00:00Z");
    for (let i = 0; i < 20; i++) minute(humans(i));
  });

  it("two spike minutes in a row at the same severity log one warning, and both are recorded", () => {
    minute(50);
    minute(55);
    expect(spikeWarns()).toBe(1);
    expect(spikes()).toHaveLength(2);
  });

  it("POSITIVE CONTROL: a spike after a normal minute is a new episode and logs again", () => {
    minute(50);
    minute(10);
    minute(52);
    expect(spikeWarns()).toBe(2);
  });

  it("an escalation from warning to critical inside one episode logs again", () => {
    minute(50); // ~5x: warning
    minute(200); // >10x: critical
    expect(spikeWarns()).toBe(2);
  });
});
