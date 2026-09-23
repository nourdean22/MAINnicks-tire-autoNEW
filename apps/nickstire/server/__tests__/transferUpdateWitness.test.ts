/**
 * transfer-update witness (2026-09-23).
 *
 * The census found 946 transfer attempts and a provider verdict on only 103.
 * Vapi's `transfer-update` event was subscribed but ignored, so an attempt
 * whose call then ended some other way (the customer hung up during the ring)
 * left no record. These pin the pure half: the witness is read from the state
 * trail, it makes the call's transfer artifact worth persisting, and the stored
 * metadata never carries the destination number.
 */
import { describe, expect, it } from "vitest";
import {
  readTransferArtifact,
  sawTransferUpdate,
  transferArtifactWorthPersisting,
  transferUpdateMetadata,
} from "../lib/transferArtifact";

describe("sawTransferUpdate", () => {
  it("is true only when the trail holds a transfer_attempted state", () => {
    expect(sawTransferUpdate([{ state: "greeted" }, { state: "transfer_attempted" }])).toBe(true);
    expect(sawTransferUpdate([{ state: "greeted" }, { state: "tool_called" }])).toBe(false);
    expect(sawTransferUpdate([])).toBe(false);
  });

  it("an assistant-to-assistant handoff is not an attempt to reach a person", () => {
    expect(sawTransferUpdate([{ state: "transfer_attempted", metadata: { destinationType: "assistant" } }])).toBe(false);
    expect(sawTransferUpdate([{ state: "transfer_attempted", metadata: { destinationType: "number" } }])).toBe(true);
    // Kind unknown (malformed event): still an attempt — never drop one silently.
    expect(sawTransferUpdate([{ state: "transfer_attempted", metadata: { destinationType: null } }])).toBe(true);
  });
});

describe("transferArtifactWorthPersisting with the live witness", () => {
  const noArtifact = readTransferArtifact(undefined);

  it("persists an attempt the ended reason hides (customer hung up during the ring)", () => {
    // Positive control first: without the witness this call is invisible.
    expect(transferArtifactWorthPersisting(noArtifact, "customer-ended-call")).toBe(false);
    expect(transferArtifactWorthPersisting(noArtifact, "customer-ended-call", true)).toBe(true);
  });

  it("still skips a call that never tried to hand off", () => {
    expect(transferArtifactWorthPersisting(noArtifact, "customer-ended-call", false)).toBe(false);
  });

  it("an attempt with no provider artifact stays verdict unknown, never connected", () => {
    expect(noArtifact.verdict).toBe("unknown");
  });
});

describe("transferUpdateMetadata", () => {
  it("keeps the destination kind and drops the number", () => {
    const meta = transferUpdateMetadata({
      type: "transfer-update",
      destination: { type: "number", number: "+12165550142" },
    });
    expect(meta).toEqual({ eventType: "transfer-update", destinationType: "number" });
    expect(JSON.stringify(meta)).not.toContain("555");
  });

  it("is total on a malformed event", () => {
    expect(transferUpdateMetadata(null)).toEqual({ eventType: "transfer-update", destinationType: null });
    expect(transferUpdateMetadata({ destination: "x" })).toEqual({ eventType: "transfer-update", destinationType: null });
  });
});
