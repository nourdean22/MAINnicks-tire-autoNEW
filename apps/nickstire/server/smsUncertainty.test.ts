/**
 * Gateway-timeout uncertainty — a message we handed to the gateway and got no
 * answer for must never be re-sent automatically.
 *
 * The defect this pins: the timeout path deliberately persists `sending`
 * ("delivery uncertain, avoids double-send"), and a separate stale sweep
 * requeued EVERY outbound `sending` row older than 10 minutes with no way to
 * tell the two apart. Recovery, rehydrate and drain all run in the same 60s
 * tick, so each gateway timeout produced exactly one duplicate customer text.
 *
 * Why these are source-level assertions: both halves are raw SQL executed
 * against TiDB, so there is no pure function to call. A source scan is the only
 * thing that catches a future edit dropping the exclusion — which is precisely
 * how this class of bug returns.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { GATEWAY_TIMEOUT_UNCERTAIN } from "./sms";

const SRC = readFileSync("server/sms.ts", "utf8");

/** The `UPDATE ... SET status = 'queued'` sweep, isolated from the rest. */
function requeueSweep(): string {
  const start = SRC.indexOf("UPDATE sms_messages SET status = 'queued'");
  expect(start, "the requeue sweep must still exist").toBeGreaterThan(-1);
  return SRC.slice(start, start + 400);
}

describe("gateway-timeout uncertainty · never auto-resend", () => {
  it("uses a failure_reason marker, NOT a new status value", () => {
    // sms_messages.status is a mysqlEnum and TiDB runs STRICT_TRANS_TABLES:
    // an out-of-enum write is REJECTED and THE ROW IS LOST. Adding an
    // "uncertain" status would have destroyed the very rows it protects, on a
    // path that is already a failure path.
    expect(GATEWAY_TIMEOUT_UNCERTAIN).toBe("gateway_timeout_delivery_uncertain");
    // failure_reason is varchar(255) — confirm we are nowhere near it.
    expect(GATEWAY_TIMEOUT_UNCERTAIN.length).toBeLessThan(255);

    const schema = readFileSync("drizzle/schema.ts", "utf8");
    const statusLine = schema
      .split("\n")
      .find((l) => l.includes('mysqlEnum("status"') && l.includes('"received"'));
    expect(statusLine, "sms_messages.status should still be the enum this guard assumes").toBeTruthy();
    expect(statusLine).not.toContain("uncertain");
  });

  it("the timeout path stamps the marker on the persisted row", () => {
    const timeoutBlock = SRC.slice(SRC.indexOf("if (gw.timedOut)"), SRC.indexOf("if (gw.timedOut)") + 900);
    expect(timeoutBlock).toContain("GATEWAY_TIMEOUT_UNCERTAIN");
    // It must still persist as `sending` — the row is genuinely in-flight-unknown.
    expect(timeoutBlock).toContain('"sending"');
  });

  it("the 10-minute requeue sweep EXCLUDES marked rows", () => {
    const sweep = requeueSweep();
    expect(sweep).toContain("failure_reason");
    expect(sweep).toContain("GATEWAY_TIMEOUT_UNCERTAIN");
  });

  it("the requeue sweep still targets ordinary crash-orphaned rows", () => {
    // The exclusion must not have narrowed the sweep out of usefulness: a
    // crash-orphaned `sending` row with no marker still has to be recovered.
    const sweep = requeueSweep();
    expect(sweep).toContain("status = 'sending'");
    expect(sweep).toContain("INTERVAL 10 MINUTE");
    expect(sweep).toMatch(/failure_reason IS NULL/);
  });

  it("the 48h terminal sweep is NOT excluded — uncertain rows must not sit in-flight forever", () => {
    // Deliberate asymmetry: 48h -> 'failed' is terminal and sends nothing, so
    // it should still apply. Only the REQUEUE (which resends) is excluded.
    const idx = SRC.indexOf("UPDATE sms_messages SET status = 'failed'");
    expect(idx).toBeGreaterThan(-1);
    const ancient = SRC.slice(idx, idx + 300);
    expect(ancient).toContain("INTERVAL 48 HOUR");
    expect(ancient).not.toContain("GATEWAY_TIMEOUT_UNCERTAIN");
  });
});
