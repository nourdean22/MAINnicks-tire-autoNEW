/**
 * Terminal-failure reservation release — the live 660001 incident class: a
 * failed job's orphaned governor slot blocked every reel enqueue for its full
 * 24h window until released by hand.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { releaseFailedJobReservation } from "./services/reelPipeline";

const released: string[] = [];
vi.mock("./services/contentGovernor", () => ({
  releaseReservation: vi.fn(async (id: string) => { released.push(id); }),
}));

afterEach(() => { released.length = 0; vi.clearAllMocks(); });

describe("releaseFailedJobReservation", () => {
  it("releases the slot recorded on the payload when a job terminally fails", async () => {
    await releaseFailedJobReservation(JSON.stringify({ contentReservationId: "resv_abc123" }), 660001);
    expect(released).toEqual(["resv_abc123"]);
  });

  it("no reservation id -> no release call (pre-governor jobs)", async () => {
    await releaseFailedJobReservation(JSON.stringify({ topic: "x" }), 1);
    expect(released).toEqual([]);
  });

  it("unparseable payload never throws into the failure path (best-effort, loud)", async () => {
    await expect(releaseFailedJobReservation("{not json", 2)).resolves.toBeUndefined();
    expect(released).toEqual([]);
  });
});
