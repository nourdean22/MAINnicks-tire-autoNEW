import { describe, it, expect } from "vitest";
import {
  toReceipt,
  canClaimDone,
  isSideEffecting,
} from "@/lib/ai/receipts/action-receipt";

const NOW = "2026-06-09T00:00:00.000Z";

describe("isSideEffecting", () => {
  it("treats *_write SDK tools as side-effecting", () => {
    expect(isSideEffecting("createTask")).toBe(true);
    expect(isSideEffecting("completeTask")).toBe(true);
    expect(isSideEffecting("pinMemory")).toBe(true);
    expect(isSideEffecting("journalDecision")).toBe(true);
  });

  it("treats action-block mutations as side-effecting", () => {
    expect(isSideEffecting("task.create")).toBe(true);
    expect(isSideEffecting("person.update")).toBe(true);
  });

  it("treats reads as NOT side-effecting", () => {
    expect(isSideEffecting("getBodyData")).toBe(false);
    expect(isSideEffecting("getCommitments")).toBe(false);
  });

  it("handles unknown tools safely (not side-effecting, no throw)", () => {
    expect(isSideEffecting("totallyMadeUpTool")).toBe(false);
  });
});

describe("toReceipt", () => {
  it("builds a success receipt for a side-effecting write", () => {
    const r = toReceipt({ toolName: "createTask", ok: true, label: "Call vendor", entityType: "task", entityId: "t1" }, { now: NOW });
    expect(r.status).toBe("success");
    expect(r.sideEffecting).toBe(true);
    expect(r.userVisibleSummary).toContain("Done");
    expect(r.errorSafeMessage).toBeUndefined();
    expect(r.createdAt).toBe(NOW);
  });

  it("builds a failure receipt with a visible failure + sanitized error", () => {
    const r = toReceipt(
      { toolName: "completeTask", ok: false, error: "ENOENT C:\\Users\\nourd\\secret\\db.ts boom", label: "Ship PR" },
      { now: NOW },
    );
    expect(r.status).toBe("failed");
    expect(r.userVisibleSummary).toContain("Did NOT complete");
    expect(r.errorSafeMessage).toContain("<path>");
    expect(r.errorSafeMessage).not.toContain("secret");
  });

  it("maps needs_approval and skipped", () => {
    expect(toReceipt({ toolName: "sendTelegram", needsApproval: true }, { now: NOW }).status).toBe("needs_approval");
    expect(toReceipt({ toolName: "createTask", skipped: true }, { now: NOW }).status).toBe("skipped");
  });

  it("a side-effecting tool with no confirmed ok is 'partial', not success", () => {
    const r = toReceipt({ toolName: "createTask" }, { now: NOW }); // no ok signal
    expect(r.status).toBe("partial");
  });

  it("a read tool with no ok signal is success (it returned)", () => {
    const r = toReceipt({ toolName: "getBodyData" }, { now: NOW });
    expect(r.status).toBe("success");
    expect(r.sideEffecting).toBe(false);
  });

  it("normalizes an unknown tool without throwing", () => {
    const r = toReceipt({ toolName: "madeUpTool", ok: true }, { now: NOW });
    expect(r.toolName).toBe("madeUpTool");
    expect(r.sideEffecting).toBe(false);
    expect(r.category).toBe("unknown");
  });

  it("is deterministic — same inputs give the same receiptId", () => {
    const input = { toolName: "createTask", ok: true, entityId: "t9", label: "x" };
    expect(toReceipt(input, { now: NOW }).receiptId).toBe(toReceipt(input, { now: NOW }).receiptId);
  });
});

describe("canClaimDone", () => {
  it("is true when every side-effecting receipt succeeded", () => {
    const receipts = [
      toReceipt({ toolName: "createTask", ok: true }, { now: NOW }),
      toReceipt({ toolName: "getBodyData", ok: true }, { now: NOW }),
    ];
    expect(canClaimDone(receipts).ok).toBe(true);
  });

  it("is FALSE when a side-effecting action did not succeed", () => {
    const receipts = [
      toReceipt({ toolName: "createTask", ok: true }, { now: NOW }),
      toReceipt({ toolName: "completeTask", ok: false, error: "db down" }, { now: NOW }),
    ];
    const v = canClaimDone(receipts);
    expect(v.ok).toBe(false);
    expect(v.offenders.map((o) => o.toolName)).toContain("completeTask");
  });

  it("a failed READ never blocks a done-claim", () => {
    const receipts = [toReceipt({ toolName: "getBodyData", ok: false, error: "timeout" }, { now: NOW })];
    expect(canClaimDone(receipts).ok).toBe(true);
  });

  it("an unverified (partial) side-effecting action blocks a done-claim", () => {
    const receipts = [toReceipt({ toolName: "task.create" }, { now: NOW })]; // no ok
    expect(canClaimDone(receipts).ok).toBe(false);
  });
});
