/**
 * The cloud standby (lot vision v2) is p4: below NattyNour's p3, so an equal-priority takeover
 * (`<=`) can never let it bounce a counting p3 off the lease (Codex on #3307).
 */
import { describe, expect, it } from "vitest";
import { cameraProducerAuthority as a } from "./cameraProducerAuthority";

const fresh = 10;
const stale = a.staleSeconds + 1;

describe("producer priority with the p4 cloud standby", () => {
  it("ranks p4 last and an unknown prefix after it", () => {
    expect(a.producerPriority("p4-cloud-abc")).toBe(4);
    expect(a.producerPriority("p3-nattynour-abc")).toBe(3);
    expect(a.producerPriority("legacy-abc")).toBe(99);
  });

  it("a p4 heartbeat cannot take a fresh p3 or p1 lease", () => {
    for (const storedId of ["p3-nattynour-a", "p1-shop-sign-a"]) {
      expect(a.heartbeatAuthorityAccepted({ incomingId: "p4-cloud-b", incomingSeq: 1, storedId, storedSeq: 9, storedAgeSeconds: fresh })).toBe(false);
    }
  });

  it("a p4 heartbeat takes the lease only after the holder has been silent past the stale line", () => {
    expect(a.heartbeatAuthorityAccepted({ incomingId: "p4-cloud-b", incomingSeq: 1, storedId: "p3-nattynour-a", storedSeq: 9, storedAgeSeconds: stale })).toBe(true);
  });

  it("p3 and p1 take the lease back from a fresh p4 at once", () => {
    for (const incomingId of ["p3-nattynour-a", "p1-shop-sign-a"]) {
      expect(a.heartbeatAuthorityAccepted({ incomingId, incomingSeq: 1, storedId: "p4-cloud-b", storedSeq: 9, storedAgeSeconds: fresh })).toBe(true);
    }
  });
});
