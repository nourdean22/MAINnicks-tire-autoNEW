/**
 * server/lib/visitMarks.ts -- the operator's marks against the camera's clocks (audit N1).
 * Every case names the floor-board reading that would be wrong without it.
 */
import { describe, expect, it } from "vitest";
import { deriveVisitMarkState } from "./visitMarks";

const T0 = Date.UTC(2026, 9, 8, 14, 0, 0); // 10:00 ET
const min = (n: number) => n * 60_000;
const NOW = T0 + min(90);

describe("deriveVisitMarkState", () => {
  it("an unmarked car is UNKNOWN on every mark field, not zero", () => {
    const s = deriveVisitMarkState({ bayEnteredAtMs: null, departedAtMs: null }, [], NOW);
    expect(s).toMatchObject({
      latest: null,
      customerWaiting: false,
      notAJob: false,
      serviceStartedAtMs: null,
      serviceStartedBy: null,
      serviceDoneAtMs: null,
      serviceMinutes: null,
      pickupPending: false,
      pickupWaitMinutes: null,
      markCount: 0,
    });
  });

  it("a car worked on in the lot starts service at the mark, with no bay entry", () => {
    const s = deriveVisitMarkState(
      { bayEnteredAtMs: null, departedAtMs: null },
      [{ mark: "SERVICE_STARTED", markedAtMs: T0 + min(10), note: null }],
      NOW,
    );
    expect(s.serviceStartedAtMs).toBe(T0 + min(10));
    expect(s.serviceStartedBy).toBe("mark");
    expect(s.serviceMinutes).toBe(80);
    expect(s.pickupPending).toBe(false);
  });

  it("the camera's bay entry wins when it is earlier than the mark; the mark wins when earlier", () => {
    const camera = deriveVisitMarkState(
      { bayEnteredAtMs: T0 + min(5), departedAtMs: null },
      [{ mark: "SERVICE_STARTED", markedAtMs: T0 + min(20), note: null }],
      NOW,
    );
    expect(camera.serviceStartedAtMs).toBe(T0 + min(5));
    expect(camera.serviceStartedBy).toBe("camera");
    const mark = deriveVisitMarkState(
      { bayEnteredAtMs: T0 + min(30), departedAtMs: null },
      [{ mark: "SERVICE_STARTED", markedAtMs: T0 + min(20), note: null }],
      NOW,
    );
    expect(mark.serviceStartedAtMs).toBe(T0 + min(20));
    expect(mark.serviceStartedBy).toBe("mark");
  });

  it("done and still on the property is pickup pending, measured from the done mark", () => {
    const s = deriveVisitMarkState(
      { bayEnteredAtMs: T0, departedAtMs: null },
      [{ mark: "SERVICE_DONE", markedAtMs: T0 + min(45), note: "keys on the counter" }],
      NOW,
    );
    expect(s.serviceDoneAtMs).toBe(T0 + min(45));
    expect(s.serviceMinutes).toBe(45);
    expect(s.pickupPending).toBe(true);
    expect(s.pickupWaitMinutes).toBe(45);
    expect(s.latest).toEqual({ mark: "SERVICE_DONE", atMs: T0 + min(45), note: "keys on the counter" });
  });

  it("a departed car is no longer pickup pending and its pickup wait freezes at departure", () => {
    const s = deriveVisitMarkState(
      { bayEnteredAtMs: T0, departedAtMs: T0 + min(60) },
      [{ mark: "SERVICE_DONE", markedAtMs: T0 + min(45), note: null }],
      NOW,
    );
    expect(s.pickupPending).toBe(false);
    expect(s.pickupWaitMinutes).toBe(15);
    expect(s.serviceMinutes).toBe(45);
  });

  it("SERVICE_STARTED after SERVICE_DONE reopens the job: not done, not pickup pending", () => {
    const s = deriveVisitMarkState(
      { bayEnteredAtMs: T0, departedAtMs: null },
      [
        { mark: "SERVICE_DONE", markedAtMs: T0 + min(30), note: null },
        { mark: "SERVICE_STARTED", markedAtMs: T0 + min(40), note: null },
      ],
      NOW,
    );
    expect(s.serviceDoneAtMs).toBeNull();
    expect(s.pickupPending).toBe(false);
    // Service started at the bay entry (camera), still running.
    expect(s.serviceStartedAtMs).toBe(T0);
    expect(s.serviceMinutes).toBe(90);
  });

  it("NOT_A_JOB removes every service clock while the car stays an occupancy fact", () => {
    const s = deriveVisitMarkState(
      { bayEnteredAtMs: T0, departedAtMs: null },
      [
        { mark: "SERVICE_STARTED", markedAtMs: T0 + min(2), note: null },
        { mark: "NOT_A_JOB", markedAtMs: T0 + min(3), note: "parts delivery" },
      ],
      NOW,
    );
    expect(s.notAJob).toBe(true);
    expect(s.serviceStartedAtMs).toBeNull();
    expect(s.serviceMinutes).toBeNull();
    expect(s.pickupPending).toBe(false);
    expect(s.latest?.mark).toBe("NOT_A_JOB");
  });

  it("customer waiting holds until the car leaves", () => {
    const marks = [{ mark: "CUSTOMER_WAITING", markedAtMs: T0 + min(1), note: null }];
    expect(deriveVisitMarkState({ bayEnteredAtMs: null, departedAtMs: null }, marks, NOW).customerWaiting).toBe(true);
    expect(deriveVisitMarkState({ bayEnteredAtMs: null, departedAtMs: T0 + min(50) }, marks, NOW).customerWaiting).toBe(false);
  });

  it("an unknown mark string from a newer vocabulary is ignored, never an error", () => {
    const s = deriveVisitMarkState(
      { bayEnteredAtMs: null, departedAtMs: null },
      [
        { mark: "PAID", markedAtMs: T0 + min(5), note: null },
        { mark: "SERVICE_STARTED", markedAtMs: T0 + min(1), note: null },
      ],
      NOW,
    );
    expect(s.markCount).toBe(1);
    expect(s.latest?.mark).toBe("SERVICE_STARTED");
  });

  it("marks arriving out of order are read in time order", () => {
    const s = deriveVisitMarkState(
      { bayEnteredAtMs: null, departedAtMs: null },
      [
        { mark: "SERVICE_DONE", markedAtMs: T0 + min(50), note: null },
        { mark: "SERVICE_STARTED", markedAtMs: T0 + min(10), note: null },
      ],
      NOW,
    );
    expect(s.serviceStartedAtMs).toBe(T0 + min(10));
    expect(s.serviceDoneAtMs).toBe(T0 + min(50));
    expect(s.serviceMinutes).toBe(40);
    expect(s.latest?.mark).toBe("SERVICE_DONE");
  });
});
