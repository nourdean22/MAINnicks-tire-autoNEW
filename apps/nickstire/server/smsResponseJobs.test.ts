/**
 * The durable inbound-response spine's correctness rests on two pure decisions:
 *   1. the idempotency key — a provider redelivery MUST map to the same job, or
 *      the customer gets two replies to one text;
 *   2. the terminal-status mapping — a completed orchestration is NEVER retried,
 *      or a customer who was answered gets answered again on the next sweep.
 * Both are tested here without a DB. The DB-bound claim/enqueue paths are the
 * standard guarded-UPDATE idiom already proven in startDelayedQueueProcessor.
 */
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ orchestrate: vi.fn() }));

// getDb() → null forces the degraded path (table not migrated yet / DB down).
vi.mock("./db", () => ({ getDb: vi.fn().mockResolvedValue(null) }));
vi.mock("./services/smsOrchestrator", () => ({
  orchestrateSms: (...a: unknown[]) => h.orchestrate(...a),
}));

import { responseIdempotencyKey, terminalStatusFor, handleInboundResponse } from "./services/smsResponseJobs";

describe("responseIdempotencyKey — a redelivery must dedupe to one job", () => {
  it("is deterministic for the same provider message id", () => {
    const a = responseIdempotencyKey({ conversationId: 1, phone: "+12165550100", providerMsgId: "SM123", body: "hi" });
    const b = responseIdempotencyKey({ conversationId: 1, phone: "+12165550100", providerMsgId: "SM123", body: "hi" });
    expect(a).toBe(b);
    expect(a).toBe("resp:SM123");
  });

  it("distinguishes different provider message ids", () => {
    const a = responseIdempotencyKey({ conversationId: 1, phone: "+1", providerMsgId: "SM1", body: "hi" });
    const b = responseIdempotencyKey({ conversationId: 1, phone: "+1", providerMsgId: "SM2", body: "hi" });
    expect(a).not.toBe(b);
  });

  it("falls back to a deterministic (conversation, body) hash when no provider id", () => {
    const a = responseIdempotencyKey({ conversationId: 7, phone: "+1", body: "225/50R17" });
    const b = responseIdempotencyKey({ conversationId: 7, phone: "+1", body: "225/50R17" });
    expect(a).toBe(b);
    expect(a.startsWith("resp:conv:7:")).toBe(true);
  });

  it("gives different fallback keys for different bodies in the same conversation", () => {
    const a = responseIdempotencyKey({ conversationId: 7, phone: "+1", body: "two used tires" });
    const b = responseIdempotencyKey({ conversationId: 7, phone: "+1", body: "a full set" });
    expect(a).not.toBe(b);
  });

  it("never exceeds the varchar(191) unique-key width", () => {
    const key = responseIdempotencyKey({ conversationId: 1, phone: "+1", providerMsgId: "S".repeat(500), body: "x" });
    expect(key.length).toBeLessThanOrEqual(191);
  });
});

describe("jobStatusFor — a completed run never re-orchestrates; humans get a durable obligation", () => {
  it.each(["sent", "queued", "delivered", "sending", "replied"])("%s → responded", (status) => {
    expect(terminalStatusFor({ status })).toBe("responded");
  });

  it("failed → failed (send layer owns delivery retry, not a re-orchestration)", () => {
    expect(terminalStatusFor({ status: "failed" })).toBe("failed");
  });

  it.each(["skipped", "blocked", "expired", "cancelled", "approved", "received"])(
    "%s → suppressed (genuinely no reply owed)",
    (status) => {
      expect(terminalStatusFor({ status })).toBe("suppressed");
    },
  );

  // ROS-058: these used to collapse to 'suppressed' — proving the AI chose not
  // to send while proving NOTHING about a human answering. Now they transfer
  // the obligation to a human with an SLA.
  it("a draft awaiting an operator → human_pending, never suppressed", () => {
    expect(terminalStatusFor({ status: "drafted" })).toBe("human_pending");
  });

  it("an explicit human-approval decision → human_pending", () => {
    expect(terminalStatusFor({ status: "drafted", shouldAutoSend: false, requiresHumanApproval: true })).toBe("human_pending");
  });

  it("requiresHumanApproval forces human_pending even on an odd status", () => {
    expect(terminalStatusFor({ status: "compiled", requiresHumanApproval: true })).toBe("human_pending");
  });
});

describe("handleInboundResponse — an inbound is NEVER dropped, even with no DB", () => {
  it("degrades to direct orchestrateSms when the job table is unavailable", async () => {
    h.orchestrate.mockClear();
    h.orchestrate.mockResolvedValue({ id: 1, status: "sent", shouldAutoSend: true });
    await handleInboundResponse({ conversationId: 42, phone: "+12165550100", providerMsgId: "SM9", body: "how much for an oil change?" });
    // With getDb()→null the durable enqueue can't happen; the customer must
    // still be answered by the exact pre-spine path.
    expect(h.orchestrate).toHaveBeenCalledTimes(1);
    expect(h.orchestrate).toHaveBeenCalledWith({
      type: "inbound_sms",
      phone: "+12165550100",
      body: "how much for an oil change?",
      conversationId: 42,
    });
  });
});
