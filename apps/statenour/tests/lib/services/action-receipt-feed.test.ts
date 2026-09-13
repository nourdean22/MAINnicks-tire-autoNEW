import { describe, it, expect } from "vitest";
import {
  auditEntryToReceipt,
  autonomousActionToReceipt,
  auditEventToReceipt,
  countByVerification,
  mergeReceipts,
  buildActionReceiptFeed,
  type AutonomousActionRow,
  type AgentReceiptRow,
} from "@/lib/services/action-receipt-feed";
import { canClaimDone, canClaimDoneStrict, toReceipt } from "@/lib/ai/receipts/action-receipt";
import type { AuditEntry } from "@/lib/db/entity-audit";

function audit(over: Partial<AuditEntry>): AuditEntry {
  return {
    id: "a1", entityType: "task", entityId: "task-abc12345", action: "created",
    actor: "nick", before: null, after: null, reason: null, source: "chat:tool-call",
    createdAt: new Date("2026-06-09T10:00:00.000Z"),
    ...over,
  };
}

function auto(over: Partial<AutonomousActionRow>): AutonomousActionRow {
  return {
    id: "x1", ruleName: "auto_followup_expired_quote", actionType: "send_email",
    targetType: "quote", targetId: "q-99", approval: "auto", executedAt: new Date(),
    result: "success", error: null, createdAt: new Date("2026-06-09T09:00:00.000Z"),
    ...over,
  };
}

describe("auditEntryToReceipt", () => {
  it("maps a create to a success receipt (not undoable) with read-side verification", () => {
    const r = auditEntryToReceipt(audit({ action: "created" }));
    expect(r.status).toBe("success");
    expect(r.undoAvailable).toBe(false);
    expect(r.sideEffecting).toBe(true);
    expect(r.verificationState).toBe("VERIFIED");
    expect(r.userVisibleSummary).toContain("Created");
  });

  it("marks a soft delete as undoable", () => {
    const r = auditEntryToReceipt(audit({ action: "soft_deleted" }));
    expect(r.status).toBe("success");
    expect(r.undoAvailable).toBe(true);
    expect(r.verificationState).toBe("VERIFIED");
    expect(r.userVisibleSummary).toContain("Archived");
  });

  it("carries actor + source into metadata", () => {
    const r = auditEntryToReceipt(audit({ actor: "cron:brain-cycle", source: "cron" }));
    expect(r.metadata?.actor).toBe("cron:brain-cycle");
  });
});

describe("autonomousActionToReceipt (failures are visible)", () => {
  it("maps a failed action to a failed receipt with a sanitized error", () => {
    const r = autonomousActionToReceipt(auto({ result: "failed", error: "SMTP 550 rejected\nstack..." }));
    expect(r.status).toBe("failed");
    expect(r.verificationState).toBe("FAILED_KNOWN");
    expect(r.userVisibleSummary).toContain("FAILED");
    expect(r.errorSafeMessage).toBe("SMTP 550 rejected");
  });

  it("maps a pending-approval action to needs_approval / NOT_ATTEMPTED", () => {
    const r = autonomousActionToReceipt(auto({ approval: "pending", executedAt: null, result: null }));
    expect(r.status).toBe("needs_approval");
    expect(r.verificationState).toBe("NOT_ATTEMPTED");
  });

  it("maps executor success to PROVIDER_ACCEPTED, not strict VERIFIED", () => {
    const r = autonomousActionToReceipt(auto({ result: "success" }));
    expect(r.status).toBe("success");
    expect(r.verificationState).toBe("PROVIDER_ACCEPTED");
    expect(canClaimDone([r]).ok).toBe(true);
    expect(canClaimDoneStrict([r]).ok).toBe(false);
  });

  it("maps an un-executed/unknown action to partial / UNKNOWN_COMPLETION", () => {
    const r = autonomousActionToReceipt(auto({ approval: "approved", executedAt: null, result: null }));
    expect(r.status).toBe("partial");
    expect(r.verificationState).toBe("UNKNOWN_COMPLETION");
  });
});

describe("autonomousActionToReceipt — BDN-204 pre-registration surface", () => {
  it("surfaces the pre-filed plan and the plan-vs-outcome diff from payload", () => {
    const r = autonomousActionToReceipt(
      auto({
        payload: {
          plannedOutcome: { statement: "Send ONE reminder; no other side effect.", registeredAt: "2026-08-13T00:00:00Z" },
          outcomeVsPlan: { planned: "Send ONE reminder; no other side effect.", actual: "success", recordedAt: "2026-08-13T00:00:05Z" },
        },
      }),
    );
    expect(r.metadata?.plannedOutcome).toBe("Send ONE reminder; no other side effect.");
    expect((r.metadata?.outcomeVsPlan as { actual?: string })?.actual).toBe("success");
  });

  it("emits NO plan fields for legacy rows without a registered plan (no fake pre-registration)", () => {
    const r = autonomousActionToReceipt(auto({ payload: { anything: "else" } }));
    expect(r.metadata && "plannedOutcome" in r.metadata).toBe(false);
    const legacy = autonomousActionToReceipt(auto({}));
    expect(legacy.metadata && "plannedOutcome" in legacy.metadata).toBe(false);
  });
});

describe("verification census", () => {
  it("counts only consequential receipts so successful reads cannot inflate verified actions", () => {
    const counts = countByVerification([
      toReceipt({ toolName: "getBodyData", ok: true }), // known read — excluded
      toReceipt({ toolName: "createTask", ok: true, verified: true }),
      toReceipt({ toolName: "createTask", ok: true }),
      toReceipt({ toolName: "completeTask", ok: false, error: "db down" }),
      toReceipt({ toolName: "task.create" }),
      toReceipt({ toolName: "task.create", skipped: true }),
    ]);
    expect(counts).toEqual({
      consequentialTotal: 5,
      verified: 1,
      providerAccepted: 1,
      unknownCompletion: 1,
      failedKnown: 1,
      notAttempted: 1,
      unmeasured: 0,
    });
  });

  it("classifies historical consequential receipts with no strict state as UNMEASURED", () => {
    const historical = {
      receiptId: "legacy-write",
      toolName: "createTask",
      category: "task_write",
      sideEffecting: true,
      status: "success" as const,
      undoAvailable: false,
      userVisibleSummary: "Done: createTask.",
      createdAt: "2026-01-01T00:00:00Z",
    };
    const counts = countByVerification([historical]);
    expect(counts.consequentialTotal).toBe(1);
    expect(counts.unmeasured).toBe(1);
    expect(counts.verified).toBe(0);
    expect(counts.providerAccepted).toBe(0);
  });

  it("keeps an unclassifiable receipt in the consequential denominator", () => {
    const counts = countByVerification([toReceipt({ toolName: "neverHeardOfThis", ok: true })]);
    expect(counts.consequentialTotal).toBe(1);
    expect(counts.unknownCompletion).toBe(1);
  });
});

describe("mergeReceipts", () => {
  it("sorts newest-first and counts by status + strict verification", () => {
    const merged = mergeReceipts([
      auditEntryToReceipt(audit({ id: "old", createdAt: new Date("2026-06-09T08:00:00Z") })),
      auditEntryToReceipt(audit({ id: "new", createdAt: new Date("2026-06-09T12:00:00Z") })),
      autonomousActionToReceipt(auto({ id: "f", result: "failed", error: "boom" })),
    ]);
    expect(merged.items[0].receiptId).toBe("audit_new"); // newest first
    expect(merged.counts.failed).toBe(1);
    expect(merged.counts.success).toBe(2);
    expect(merged.counts.total).toBe(3);
    expect(merged.verificationCounts.consequentialTotal).toBe(3);
    expect(merged.verificationCounts.verified).toBe(2);
    expect(merged.verificationCounts.failedKnown).toBe(1);
  });
});

describe("buildActionReceiptFeed (injected loaders — no DB)", () => {
  it("merges audit + autonomous sources, failures visible, newest first", async () => {
    const feed = await buildActionReceiptFeed({
      loadAudit: async () => [audit({ id: "t", action: "updated", createdAt: new Date("2026-06-09T11:00:00Z") })],
      loadAutonomous: async () => [auto({ id: "boom", result: "failed", error: "down", createdAt: new Date("2026-06-09T12:00:00Z") })],
      loadAgentReceipts: async () => [],
    });
    expect(feed.counts.total).toBe(2);
    expect(feed.counts.failed).toBe(1);
    expect(feed.verificationCounts.consequentialTotal).toBe(2);
    expect(feed.verificationCounts.verified).toBe(1);
    expect(feed.verificationCounts.failedKnown).toBe(1);
    expect(feed.items[0].receiptId).toBe("auto_boom"); // 12:00 newest
    expect(feed.items[0].status).toBe("failed");
  });

  it("counts describe EXACTLY the returned items, not the 2×limit union (review fix)", async () => {
    // 60 audits + 60 autos loaded under the default limit 50 → 120 receipts,
    // but only 50 returned. Both count sets must describe only those 50.
    const mk = (i: number, base: Date) => audit({ id: `a${i}`, createdAt: new Date(base.getTime() + i * 1000) });
    const feed = await buildActionReceiptFeed({
      loadAudit: async () => Array.from({ length: 60 }, (_, i) => mk(i, new Date("2026-06-09T00:00:00Z"))),
      loadAutonomous: async () => Array.from({ length: 60 }, (_, i) => auto({ id: `x${i}`, result: "failed", error: "e", createdAt: new Date("2026-06-08T00:00:00Z") })),
      loadAgentReceipts: async () => [],
    });
    expect(feed.items.length).toBe(50);
    expect(feed.counts.total).toBe(50); // not 120
    expect(feed.counts.success + feed.counts.failed + feed.counts.other).toBe(50);
    expect(feed.verificationCounts.consequentialTotal).toBe(50);
    expect(feed.verificationCounts.verified).toBe(50);
  });
});

describe("autonomousActionToReceipt — rejected / forbidden (review fix)", () => {
  it("maps an operator-rejected action to skipped, not partial", () => {
    const r = autonomousActionToReceipt(auto({ approval: "rejected", result: "pending_approval", executedAt: null }));
    expect(r.status).toBe("skipped");
    expect(r.verificationState).toBe("NOT_ATTEMPTED");
  });
  it("maps a policy-forbidden action to skipped", () => {
    const r = autonomousActionToReceipt(auto({ approval: "auto", result: "forbidden_by_policy", executedAt: new Date() }));
    expect(r.status).toBe("skipped");
    expect(r.verificationState).toBe("NOT_ATTEMPTED");
  });
});

describe("Wire 1 · chat action receipts (auditEventToReceipt + feed)", () => {
  // A persisted action_receipt row stores a serialized ActionReceipt as payload.
  const row = (over: Partial<AgentReceiptRow> & { payload?: unknown }): AgentReceiptRow => ({
    id: "ae1",
    payload: toReceipt({ toolName: "task.create", ok: true, label: "Call vendor" }),
    createdAt: new Date("2026-06-09T10:00:00.000Z"),
    ...over,
  });

  it("reconstructs a success receipt and preserves strict PROVIDER_ACCEPTED state", () => {
    const r = auditEventToReceipt(row({}));
    expect(r?.status).toBe("success");
    expect(r?.toolName).toBe("task.create");
    expect(r?.sideEffecting).toBe(true);
    expect(r?.verificationState).toBe("PROVIDER_ACCEPTED");
    expect(canClaimDone(r ? [r] : []).ok).toBe(true);
    expect(canClaimDoneStrict(r ? [r] : []).ok).toBe(false);
  });

  it("keeps a FAILED action visible (no false done)", () => {
    const r = auditEventToReceipt(row({ payload: toReceipt({ toolName: "person.update", ok: false, error: "ask first" }) }));
    expect(r?.status).toBe("failed");
    expect(r?.verificationState).toBe("FAILED_KNOWN");
    expect(canClaimDone(r ? [r] : []).ok).toBe(false); // failed side-effecting blocks a done-claim
  });

  it("preserves verifiable:false so unknown failed tools stay fail-closed after persistence", () => {
    const original = toReceipt({ toolName: "neverHeardOfThis", ok: false, error: "boom" });
    expect(original.verifiable).toBe(false);
    const r = auditEventToReceipt(row({ payload: original }));
    expect(r?.verifiable).toBe(false);
    expect(r?.verificationState).toBe("FAILED_KNOWN");
    expect(canClaimDone(r ? [r] : []).ok).toBe(false);
    expect(canClaimDoneStrict(r ? [r] : []).ok).toBe(false);
  });

  it("preserves unknown successful receipts as UNKNOWN_COMPLETION for strict truth", () => {
    const original = toReceipt({ toolName: "neverHeardOfThis", ok: true });
    const r = auditEventToReceipt(row({ payload: original }));
    expect(r?.status).toBe("success");
    expect(r?.verifiable).toBe(false);
    expect(r?.verificationState).toBe("UNKNOWN_COMPLETION");
    expect(canClaimDone(r ? [r] : []).ok).toBe(true); // legacy behavior intentionally unchanged
    expect(canClaimDoneStrict(r ? [r] : []).ok).toBe(false);
  });

  it("returns null for a junk payload (defensive)", () => {
    expect(auditEventToReceipt(row({ payload: { nope: 1 } }))).toBeNull();
    expect(auditEventToReceipt(row({ payload: null }))).toBeNull();
  });

  it("the feed includes chat action receipts, failures visible, deduped by receiptId", async () => {
    const r1 = toReceipt({ toolName: "task.create", ok: true, entityId: "t1", label: "A" });
    const r2 = toReceipt({ toolName: "shop.sendSms", ok: false, error: "gateway down", entityId: "s1", label: "B" });
    const feed = await buildActionReceiptFeed({
      loadAudit: async () => [],
      loadAutonomous: async () => [],
      loadAgentReceipts: async () => [
        auditEventToReceipt(row({ id: "a", payload: r1, createdAt: new Date("2026-06-09T10:00:00Z") }))!,
        auditEventToReceipt(row({ id: "b", payload: r2, createdAt: new Date("2026-06-09T11:00:00Z") }))!,
        // duplicate of r1 (same receiptId) from a concurrent write — must dedupe
        auditEventToReceipt(row({ id: "c", payload: r1, createdAt: new Date("2026-06-09T10:00:01Z") }))!,
      ],
    });
    expect(feed.counts.total).toBe(2); // r1 deduped
    expect(feed.counts.failed).toBe(1);
    expect(feed.verificationCounts.consequentialTotal).toBe(2);
    expect(feed.verificationCounts.providerAccepted).toBe(1);
    expect(feed.verificationCounts.failedKnown).toBe(1);
    expect(feed.items[0].status).toBe("failed"); // 11:00 newest, the failed SMS
  });
});
