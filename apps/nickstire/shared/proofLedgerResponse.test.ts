/**
 * The proof workflow must go red when the evidence ledger refuses its post
 * (2026-10-02: three days of HTTP 500 behind green runs). Pins the judge the
 * poster exits on, including the 200-with-rejections envelope.
 */
import { describe, expect, it } from "vitest";
import { ledgerFailure } from "../scripts/proof/ledger-response.mjs";

describe("ledgerFailure", () => {
  it("a clean 2xx with nothing rejected is success", () => {
    expect(ledgerFailure(200, { ok: true, data: { ok: true, eventsWritten: 2, rejected: [] } })).toBeNull();
  });

  it("a non-2xx is a failure naming the status and the error", () => {
    expect(ledgerFailure(500, { ok: false, error: "column event_version does not exist" })).toBe(
      "HTTP 500: column event_version does not exist",
    );
    expect(ledgerFailure(401, null)).toBe("HTTP 401");
  });

  it("HTTP 200 with rejected rows inside the envelope is still a failure", () => {
    const r = ledgerFailure(200, {
      ok: true,
      data: { ok: false, rejected: [{ kind: "event", index: 1, error: "payload.customer.phone: pii" }] },
    });
    expect(r).toBe("1 row(s) rejected; first: event[1] payload.customer.phone: pii");
  });
});
