/**
 * Abandoned-form recovery — eligibility rule + Map-fallback behavior
 * (Wave E, 2026-07-12 durability change).
 *
 * The DB persistence path is integration-level (real MySQL), so these
 * tests pin the two things unit tests CAN lock deterministically:
 *   1. isEligibleForRecovery — the exact age-window / phone / attempted
 *      rule shared by the Map drain and the DB scan.
 *   2. The Map-fallback path (db() → null, i.e. pre-0079-migration or DB
 *      down): savePartialForm → processAbandonedForms must reproduce the
 *      pre-persistence behavior exactly — one send per eligible partial,
 *      no re-send after markFormCompleted, no double-send on a re-run.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ orchestrate: vi.fn() }));

// db() → null forces the in-memory fallback path (no table needed).
vi.mock("../lib/db-helper", () => ({ db: vi.fn().mockResolvedValue(null) }));
vi.mock("../services/smsOrchestrator", () => ({
  orchestrateSms: (...a: unknown[]) => h.orchestrate(...a),
}));

import {
  isEligibleForRecovery,
  savePartialForm,
  markFormCompleted,
  processAbandonedForms,
  __resetPartialsForTest,
} from "../services/abandonedForms";

const T0 = 1_780_000_000_000; // fixed base instant
const MIN = 60 * 1000;

describe("isEligibleForRecovery", () => {
  const base = { phone: "2165551234", recoveryAttempted: false, createdAtMs: T0 };

  it("eligible in the 30 min – 2 h window with a phone and no prior attempt", () => {
    expect(isEligibleForRecovery(base, T0 + 45 * MIN)).toBe(true);
    expect(isEligibleForRecovery(base, T0 + 30 * MIN)).toBe(true); // lower edge inclusive
    expect(isEligibleForRecovery(base, T0 + 120 * MIN)).toBe(true); // upper edge inclusive
  });

  it("not eligible when too recent (< 30 min) or too cold (> 2 h)", () => {
    expect(isEligibleForRecovery(base, T0 + 29 * MIN)).toBe(false);
    expect(isEligibleForRecovery(base, T0 + 121 * MIN)).toBe(false);
  });

  it("not eligible without a phone (can't text)", () => {
    expect(isEligibleForRecovery({ ...base, phone: null }, T0 + 45 * MIN)).toBe(false);
    expect(isEligibleForRecovery({ ...base, phone: "" }, T0 + 45 * MIN)).toBe(false);
  });

  it("not eligible once recovery was already attempted (one-shot)", () => {
    expect(isEligibleForRecovery({ ...base, recoveryAttempted: true }, T0 + 45 * MIN)).toBe(false);
  });
});

describe("processAbandonedForms — Map fallback path (db unavailable)", () => {
  beforeEach(() => {
    __resetPartialsForTest(); // isolate the shared module-level Map
    h.orchestrate.mockReset();
    h.orchestrate.mockResolvedValue({ status: "sent" });
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("texts an eligible partial exactly once, then never again", async () => {
    savePartialForm({ sessionId: "s-elig", formType: "tire_order", name: "Sam", phone: "2165551234" });

    vi.setSystemTime(T0 + 45 * MIN); // inside the window
    const first = await processAbandonedForms();
    expect(first.recordsProcessed).toBe(1);
    expect(h.orchestrate).toHaveBeenCalledTimes(1);
    expect(h.orchestrate).toHaveBeenCalledWith(expect.objectContaining({
      type: "abandoned_form_recovery",
      phone: "2165551234",
      formType: "tire_order",
    }));

    // Re-run in the same window must NOT re-text (recoveryAttempted dedup).
    vi.setSystemTime(T0 + 50 * MIN);
    const second = await processAbandonedForms();
    expect(second.recordsProcessed).toBe(0);
    expect(h.orchestrate).toHaveBeenCalledTimes(1);
  });

  it("does not text a partial with no phone", async () => {
    savePartialForm({ sessionId: "s-nophone", formType: "booking", name: "NoPhone" });
    vi.setSystemTime(T0 + 45 * MIN);
    const r = await processAbandonedForms();
    expect(r.recordsProcessed).toBe(0);
    expect(h.orchestrate).not.toHaveBeenCalled();
  });

  it("does not text a partial that is still too recent", async () => {
    savePartialForm({ sessionId: "s-fresh", formType: "lead", phone: "2165550000" });
    vi.setSystemTime(T0 + 10 * MIN); // < 30 min
    const r = await processAbandonedForms();
    expect(r.recordsProcessed).toBe(0);
    expect(h.orchestrate).not.toHaveBeenCalled();
  });

  it("markFormCompleted removes the partial so no recovery fires", async () => {
    savePartialForm({ sessionId: "s-done", formType: "tire_order", phone: "2165552222" });
    markFormCompleted("s-done");
    vi.setSystemTime(T0 + 45 * MIN);
    const r = await processAbandonedForms();
    expect(r.recordsProcessed).toBe(0);
    expect(h.orchestrate).not.toHaveBeenCalled();
  });

  it("a re-blur does not reset the age window (createdAt is preserved)", async () => {
    savePartialForm({ sessionId: "s-reblur", formType: "quote", phone: "2165553333" });
    vi.setSystemTime(T0 + 20 * MIN);
    savePartialForm({ sessionId: "s-reblur", formType: "quote", phone: "2165553333", name: "Later" }); // re-blur
    // Original createdAt = T0, so at T0+45min it is eligible despite the
    // re-blur at T0+20min. If the re-blur reset createdAt, it'd be only
    // 25 min old here and NOT fire.
    vi.setSystemTime(T0 + 45 * MIN);
    const r = await processAbandonedForms();
    expect(r.recordsProcessed).toBe(1);
  });
});
