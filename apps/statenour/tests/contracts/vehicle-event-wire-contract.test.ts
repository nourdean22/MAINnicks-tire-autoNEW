/**
 * The RECEIVER half of the camera wire contract.
 *
 * `camera-bridge/visitd/contract.py` renders every vehicle event; this schema decides whether
 * the cloud accepts it. Until now nothing compared the two, and both sides were individually
 * well-tested and green while production dropped every single event.
 *
 * THE OUTAGE THIS GATE IS FOR (2026-09-10). A completed visit -- a car that genuinely arrived
 * and left -- came back `400 Invalid vehicle event payload`, and so did every other event, for
 * hours. Zod's `.optional()` accepts a MISSING KEY. It does not accept `null`. Python's `None`
 * serialises to JSON null, so every field the producer had nothing to say about arrived as a
 * value this schema actively rejects. Somebody had hit it before and patched exactly one field
 * -- `trackId` is still the only `.nullable()` in the whole schema -- which fixed one symptom
 * and left the shape, so it came back on a state that happens to null different fields.
 *
 * A cross-language assertion needs Python and Node in one process and no CI job here has that.
 * So the halves are joined by a checked-in fixture instead:
 *
 *   - `camera-bridge/tests/test_wire_contract.py` fails when the PRODUCER drifts from it.
 *   - THIS FILE fails when the SCHEMA stops accepting it.
 *
 * Regenerate the fixture with `python tests/fixtures/make_wire_payloads.py` from
 * `camera-bridge/`, and read the diff: a change there is a change to what this schema will be
 * asked to accept.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { VehicleEventSchema } from "@/lib/services/vehicle-event-contract";

const FIXTURE = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "camera-bridge",
  "tests",
  "fixtures",
  "wire_payloads.json",
);

function payloads(): Record<string, unknown> {
  const raw = fs.readFileSync(FIXTURE, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("every payload the camera producer really sends is accepted", () => {
  it("finds a fixture worth checking", () => {
    // The positive control. A fixture that failed to load, or one that the producer had
    // quietly emptied, would make every assertion below pass vacuously forever.
    const cases = payloads();
    expect(Object.keys(cases).length).toBeGreaterThanOrEqual(5);
    expect(cases).toHaveProperty("left_with_everything_optional_absent");
  });

  it.each(Object.keys(payloads()))("accepts %s", (name) => {
    const result = VehicleEventSchema.safeParse(payloads()[name]);
    expect(
      result.success ? null : JSON.stringify(result.error?.flatten().fieldErrors),
      `the producer sends this shape today and this schema rejects it, which means the ` +
        `cloud would drop the event entirely — the exact 2026-09-10 outage`,
    ).toBeNull();
  });

  it("the completed-visit payload is the one that broke, and it is covered", () => {
    // Named explicitly rather than left to the general rule. The 400 reproduced on LEFT and
    // not on an arrival, because LEFT nulls a different set of fields; a fixture holding only
    // happy-path arrivals would have stayed green straight through the outage.
    const left = payloads()["left_with_everything_optional_absent"] as {
      data: Record<string, unknown>;
    };
    expect(left.data.state).toBe("LEFT");
    expect(left.data).not.toHaveProperty("zone");
    expect(left.data).not.toHaveProperty("zoneName");
    expect(left.data.stationary).toBe(false);
    expect(left.data.confidence).toBe(0);
    expect(VehicleEventSchema.safeParse(left).success).toBe(true);
  });
});

describe("the gate can actually fail", () => {
  // THE CANARY. Without these, a schema loosened to `.passthrough()` on everything — or a
  // fixture that stopped containing the interesting cases — would leave this file green and
  // measuring nothing. Each one reproduces a shape the receiver must keep rejecting.

  it("rejects a null where the producer used to send one", () => {
    const good = payloads()["left_with_everything_optional_absent"] as {
      data: Record<string, unknown>;
    };
    const withNull = { ...good, data: { ...good.data, zone: null } };
    const result = VehicleEventSchema.safeParse(withNull);
    expect(
      result.success,
      "`.optional()` must keep rejecting null. If this passes, the schema was loosened and " +
        "the producer's null-stripping is no longer load-bearing — say so on purpose.",
    ).toBe(false);
  });

  it("rejects a null inside the plate block", () => {
    const good = payloads()["confirmed_arrival_with_plate"] as {
      data: Record<string, unknown>;
    };
    const plate = { ...(good.data.plate as Record<string, unknown>), text: null };
    const result = VehicleEventSchema.safeParse({
      ...good,
      data: { ...good.data, plate },
    });
    expect(result.success).toBe(false);
  });

  it("still accepts a null inside metadata, deliberately", () => {
    // The exemption, asserted so it cannot be "tidied up". `metadata` is typed
    // `z.record(z.string(), z.unknown())`, and its nulls are MEANINGFUL:
    // `frigateEndTime: null` says the event has not ended, which is a different claim from
    // the key being absent.
    const good = payloads()["confirmed_arrival_with_plate"] as {
      data: Record<string, unknown>;
    };
    const metadata = {
      ...(good.data.metadata as Record<string, unknown>),
      frigateEndTime: null,
    };
    const result = VehicleEventSchema.safeParse({
      ...good,
      data: { ...good.data, metadata },
    });
    expect(result.success).toBe(true);
  });
});
