/**
 * The lot band's freshness is the VEHICLE-TRUTH camera's healthy frames, not any
 * producer's heartbeat. 2026-10-02 production: sign CAMERA_OFFLINE (last healthy frame
 * ~6h old) while the office PTZ kept heartbeating — MAX(receivedAt) over every camera
 * called the lot "fresh". Source assertions, like gscAggregationSemantics.test.ts: the
 * failure guarded is a formula shipping wrong, which is visible in the text.
 */
import { describe, expect, it } from "vitest";
import { EXPECTED_CAMERAS } from "@shared/cameras";
import { readCode } from "../testUtils/sourceAssertions";

const src = readCode("server/services/shopState.ts");

describe("shop-state lot freshness", () => {
  it("no longer takes MAX(receivedAt) over every camera", () => {
    expect(src).not.toMatch(/SELECT MAX\(receivedAt\) AS lastHeartbeatAt FROM camera_runtime`/);
  });

  it("is restricted to vehicle-truth cameras and bounded by the last healthy frame", () => {
    expect(src).toMatch(/c\.role === "vehicle_truth"/);
    expect(src).toMatch(/MIN\(LEAST\(receivedAt, COALESCE\(lastHealthyFrameAt, receivedAt\)\)\)/);
    expect(src).toMatch(/WHERE camera IN \(/);
  });

  it("the registry still names at least one vehicle-truth camera (else the read is empty -> offline)", () => {
    expect(EXPECTED_CAMERAS.filter((c) => c.role === "vehicle_truth").length).toBeGreaterThan(0);
  });
});
