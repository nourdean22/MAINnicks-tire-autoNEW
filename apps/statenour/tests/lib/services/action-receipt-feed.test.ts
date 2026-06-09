import { describe, it, expect } from "vitest";
import {
  auditEntryToReceipt,
  autonomousActionToReceipt,
  mergeReceipts,
  buildActionReceiptFeed,
  type AutonomousActionRow,
} from "@/lib/services/action-receipt-feed";
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
  it("maps a create to a success receipt (not undoable)", () => {
    const r = auditEntryToReceipt(audit({ action: "created" }));
    expect(r.status).toBe("success");
    expect(r.undoAvailable).toBe(false);
    expect(r.sideEffecting).toBe(true);
    expect(r.userVisibleSummary).toContain("Created");
  });

  it("marks a soft delete as undoable", () => {
    const r = auditEntryToReceipt(audit({ action: "soft_deleted" }));
    expect(r.status).toBe("success");
    expect(r.undoAvailable).toBe(true);
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
    expect(r.userVisibleSummary).toContain("FAILED");
    expect(r.errorSafeMessage).toBe("SMTP 550 rejected");
  });

  it("maps a pending-approval action to needs_approval (never asserts done)", () => {
    const r = autonomousActionToReceipt(auto({ approval: "pending", executedAt: null, result: null }));
    expect(r.status).toBe("needs_approval");
  });

  it("maps a successful action to success", () => {
    expect(autonomousActionToReceipt(auto({ result: "success" })).status).toBe("success");
  });

  it("maps an un-executed/unknown action to partial (not success)", () => {
    expect(autonomousActionToReceipt(auto({ approval: "approved", executedAt: null, result: null })).status).toBe("partial");
  });
});

describe("mergeReceipts", () => {
  it("sorts newest-first and counts by status", () => {
    const merged = mergeReceipts([
      auditEntryToReceipt(audit({ id: "old", createdAt: new Date("2026-06-09T08:00:00Z") })),
      auditEntryToReceipt(audit({ id: "new", createdAt: new Date("2026-06-09T12:00:00Z") })),
      autonomousActionToReceipt(auto({ id: "f", result: "failed", error: "boom" })),
    ]);
    expect(merged.items[0].receiptId).toBe("audit_new"); // newest first
    expect(merged.counts.failed).toBe(1);
    expect(merged.counts.success).toBe(2);
    expect(merged.counts.total).toBe(3);
  });
});

describe("buildActionReceiptFeed (injected loaders — no DB)", () => {
  it("merges audit + autonomous sources, failures visible, newest first", async () => {
    const feed = await buildActionReceiptFeed({
      loadAudit: async () => [audit({ id: "t", action: "updated", createdAt: new Date("2026-06-09T11:00:00Z") })],
      loadAutonomous: async () => [auto({ id: "boom", result: "failed", error: "down", createdAt: new Date("2026-06-09T12:00:00Z") })],
    });
    expect(feed.counts.total).toBe(2);
    expect(feed.counts.failed).toBe(1);
    expect(feed.items[0].receiptId).toBe("auto_boom"); // 12:00 newest
    expect(feed.items[0].status).toBe("failed");
  });

  it("counts describe EXACTLY the returned items, not the 2×limit union (review fix)", async () => {
    // 60 audits + 60 autos loaded under the default limit 50 → 120 receipts,
    // but only 50 returned. counts.total must equal items.length, not 120.
    const mk = (i: number, base: Date) => audit({ id: `a${i}`, createdAt: new Date(base.getTime() + i * 1000) });
    const feed = await buildActionReceiptFeed({
      loadAudit: async () => Array.from({ length: 60 }, (_, i) => mk(i, new Date("2026-06-09T00:00:00Z"))),
      loadAutonomous: async () => Array.from({ length: 60 }, (_, i) => auto({ id: `x${i}`, result: "failed", error: "e", createdAt: new Date("2026-06-08T00:00:00Z") })),
    });
    expect(feed.items.length).toBe(50);
    expect(feed.counts.total).toBe(50); // not 120
    expect(feed.counts.success + feed.counts.failed + feed.counts.other).toBe(50);
  });
});

describe("autonomousActionToReceipt — rejected / forbidden (review fix)", () => {
  it("maps an operator-rejected action to skipped, not partial", () => {
    const r = autonomousActionToReceipt(auto({ approval: "rejected", result: "pending_approval", executedAt: null }));
    expect(r.status).toBe("skipped");
  });
  it("maps a policy-forbidden action to skipped", () => {
    const r = autonomousActionToReceipt(auto({ approval: "auto", result: "forbidden_by_policy", executedAt: new Date() }));
    expect(r.status).toBe("skipped");
  });
});
