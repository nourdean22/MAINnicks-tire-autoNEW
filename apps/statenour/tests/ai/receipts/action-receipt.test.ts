import { describe, it, expect, vi } from "vitest";
import { toReceipt, canClaimDone, canClaimDoneStrict, compareClaimDoneShadow, isSideEffecting, classifyToolEffect, receiptsWithReadBack } from "@/lib/ai/receipts/action-receipt";

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
  it("builds a legacy success receipt for a side-effecting write but marks it only PROVIDER_ACCEPTED", () => {
    const r = toReceipt({ toolName: "createTask", ok: true, label: "Call vendor", entityType: "task", entityId: "t1" }, { now: NOW });
    expect(r.status).toBe("success");
    expect(r.sideEffecting).toBe(true);
    expect(r.verificationState).toBe("PROVIDER_ACCEPTED");
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
    expect(r.verificationState).toBe("FAILED_KNOWN");
    expect(r.userVisibleSummary).toContain("Did NOT complete");
    expect(r.errorSafeMessage).toContain("<path>");
    expect(r.errorSafeMessage).not.toContain("secret");
  });

  it("maps needs_approval and skipped to NOT_ATTEMPTED strict state", () => {
    const approval = toReceipt({ toolName: "sendTelegram", needsApproval: true }, { now: NOW });
    const skipped = toReceipt({ toolName: "createTask", skipped: true }, { now: NOW });
    expect(approval.status).toBe("needs_approval");
    expect(approval.verificationState).toBe("NOT_ATTEMPTED");
    expect(skipped.status).toBe("skipped");
    expect(skipped.verificationState).toBe("NOT_ATTEMPTED");
  });

  it("a side-effecting tool with no confirmed ok is 'partial' / UNKNOWN_COMPLETION", () => {
    const r = toReceipt({ toolName: "createTask" }, { now: NOW }); // no ok signal
    expect(r.status).toBe("partial");
    expect(r.verificationState).toBe("UNKNOWN_COMPLETION");
  });

  it("a read tool with no ok signal is legacy success and strict VERIFIED", () => {
    const r = toReceipt({ toolName: "getBodyData" }, { now: NOW });
    expect(r.status).toBe("success");
    expect(r.sideEffecting).toBe(false);
    expect(r.verificationState).toBe("VERIFIED");
  });

  it("normalizes an unknown tool without throwing and fails strict state closed", () => {
    const r = toReceipt({ toolName: "madeUpTool", ok: true }, { now: NOW });
    expect(r.toolName).toBe("madeUpTool");
    expect(r.sideEffecting).toBe(false);
    expect(r.category).toBe("unknown");
    expect(r.verifiable).toBe(false);
    expect(r.verificationState).toBe("UNKNOWN_COMPLETION");
  });

  it("accepts an explicit independent verification signal", () => {
    const r = toReceipt({ toolName: "createTask", ok: true, verified: true }, { now: NOW });
    expect(r.status).toBe("success");
    expect(r.verificationState).toBe("VERIFIED");
  });

  it("is deterministic — same inputs give the same receiptId", () => {
    const input = { toolName: "createTask", ok: true, entityId: "t9", label: "x" };
    expect(toReceipt(input, { now: NOW }).receiptId).toBe(toReceipt(input, { now: NOW }).receiptId);
  });
});

describe("canClaimDone", () => {
  it("keeps legacy behavior: true when every side-effecting receipt returned success", () => {
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

describe("strict done shadow", () => {
  it("exposes the exact legacy/strict gap for a successful write with no read-back", () => {
    const receipts = [toReceipt({ toolName: "createTask", ok: true }, { now: NOW })];
    expect(canClaimDone(receipts).ok).toBe(true);
    expect(canClaimDoneStrict(receipts).ok).toBe(false);

    const comparison = compareClaimDoneShadow(receipts);
    expect(comparison.legacyOk).toBe(true);
    expect(comparison.strictOk).toBe(false);
    expect(comparison.legacyStrictGap).toBe(true);
    expect(comparison.strictOffenders.map((o) => o.toolName)).toEqual(["createTask"]);
  });

  it("allows strict Done only after independent verification", () => {
    const receipts = [toReceipt({ toolName: "createTask", ok: true, verified: true }, { now: NOW })];
    expect(canClaimDoneStrict(receipts).ok).toBe(true);
    expect(compareClaimDoneShadow(receipts).legacyStrictGap).toBe(false);
  });

  it("does not make failed supporting reads block mutation completion", () => {
    const receipts = [
      toReceipt({ toolName: "createTask", ok: true, verified: true }, { now: NOW }),
      toReceipt({ toolName: "getBodyData", ok: false, error: "timeout" }, { now: NOW }),
    ];
    expect(canClaimDoneStrict(receipts).ok).toBe(true);
  });

  it("fails closed for legacy side-effecting receipt literals missing strict state", () => {
    const legacy = {
      receiptId: "legacy-write",
      toolName: "createTask",
      category: "task_write",
      sideEffecting: true,
      status: "success" as const,
      undoAvailable: false,
      userVisibleSummary: "Done: createTask.",
      createdAt: NOW,
    };
    expect(canClaimDone([legacy]).ok).toBe(true);
    expect(canClaimDoneStrict([legacy]).ok).toBe(false);
  });

  it("keeps legacy pure-read literals non-blocking", () => {
    const legacyRead = {
      receiptId: "legacy-read",
      toolName: "getBodyData",
      category: "health_read",
      sideEffecting: false,
      status: "failed" as const,
      undoAvailable: false,
      userVisibleSummary: "x",
      createdAt: NOW,
    };
    expect(canClaimDoneStrict([legacyRead]).ok).toBe(true);
  });
});

// ── fail-closed classification (2026-07-29, operator-requested) ──────
// The hole: isSideEffecting() answered `false` both for "known pure
// read" and "never heard of it", so an unrecognized tool that FAILED
// was not an offender and a done-claim survived it.
describe("classifyToolEffect + unverifiable receipts", () => {
  it("distinguishes write / read / unknown where the boolean could not", () => {
    expect(classifyToolEffect("createTask")).toBe("write");
    expect(classifyToolEffect("task.create")).toBe("write"); // action-block
    expect(classifyToolEffect("getCommitments")).toBe("read");
    expect(classifyToolEffect("neverHeardOfThis")).toBe("unknown");
    // sendSMS was retired from this catalog (Twilio → nickstire) — it is
    // genuinely unclassifiable HERE, which is exactly the point.
    expect(classifyToolEffect("sendSMS")).toBe("unknown");
  });

  it("an unknown tool yields verifiable:false without being relabeled a write", () => {
    const r = toReceipt({ toolName: "neverHeardOfThis", ok: false });
    expect(r.verifiable).toBe(false);
    expect(r.sideEffecting).toBe(false);
    expect(r.status).toBe("failed");
    expect(r.verificationState).toBe("FAILED_KNOWN");
  });

  it("unknown + no signal is `partial` (unverified), never optimistic success", () => {
    const r = toReceipt({ toolName: "neverHeardOfThis" });
    expect(r.status).toBe("partial");
    expect(r.verificationState).toBe("UNKNOWN_COMPLETION");
    expect(r.userVisibleSummary).toContain("Unverified");
  });

  it("known reads keep verifiable:true and success-on-silence (no behavior change)", () => {
    const r = toReceipt({ toolName: "getCommitments" });
    expect(r.verifiable).toBe(true);
    expect(r.status).toBe("success");
    expect(r.verificationState).toBe("VERIFIED");
  });

  it("an explicit sideEffecting flag makes a receipt verifiable by definition", () => {
    const r = toReceipt({ toolName: "someBridgeOp", sideEffecting: true, ok: true });
    expect(r.verifiable).toBe(true);
    expect(r.sideEffecting).toBe(true);
    expect(r.verificationState).toBe("PROVIDER_ACCEPTED");
    expect(canClaimDone([r]).ok).toBe(true);
    expect(canClaimDoneStrict([r]).ok).toBe(false);
  });

  it("canClaimDone blocks unverifiable non-success, allows unverifiable success under legacy behavior", () => {
    expect(canClaimDone([toReceipt({ toolName: "neverHeardOfThis", ok: false })]).ok).toBe(false);
    expect(canClaimDone([toReceipt({ toolName: "neverHeardOfThis", ok: true })]).ok).toBe(true);
    expect(canClaimDoneStrict([toReceipt({ toolName: "neverHeardOfThis", ok: true })]).ok).toBe(false);
  });

  it("legacy literal receipts without the field stay verifiable for the legacy feed guard", () => {
    const legacy = {
      receiptId: "r1",
      toolName: "task.created",
      category: "entity-audit",
      sideEffecting: false,
      status: "failed" as const,
      undoAvailable: false,
      userVisibleSummary: "x",
      createdAt: "2026-07-29T00:00:00Z",
    };
    expect(canClaimDone([legacy]).ok).toBe(true);
    expect(canClaimDoneStrict([legacy]).ok).toBe(true);
  });
});

describe("receiptsWithReadBack · per-invocation pairing", () => {
  const NOW = "2026-09-22T12:00:00.000Z";
  const calls = [
    { name: "createTask", ok: true },
    { name: "createTask", ok: true },
    { name: "createTask", ok: true },
  ];

  it("MIXED OUTCOMES for the same tool name stay with their own invocation", () => {
    // The defect this replaces: a Set of verified NAMES marked all three VERIFIED.
    const r = receiptsWithReadBack(calls, [{ verified: true }, { verified: false }, { verified: null }], { now: NOW });
    expect(r.map((x) => x.verificationState)).toEqual(["VERIFIED", "PROVIDER_ACCEPTED", "PROVIDER_ACCEPTED"]);
  });

  it("promotes ONLY on a positional true — false and null leave the provider's word", () => {
    const r = receiptsWithReadBack(calls.slice(0, 2), [{ verified: null }, { verified: false }], { now: NOW });
    expect(r.every((x) => x.verificationState === "PROVIDER_ACCEPTED")).toBe(true);
  });

  it("FAILS CLOSED on a length mismatch: nothing is promoted and the caller is told", () => {
    const onMismatch = vi.fn();
    const r = receiptsWithReadBack(calls, [{ verified: true }], { now: NOW, onMismatch });
    expect(r.map((x) => x.verificationState)).toEqual(["PROVIDER_ACCEPTED", "PROVIDER_ACCEPTED", "PROVIDER_ACCEPTED"]);
    expect(onMismatch).toHaveBeenCalledWith(3, 1);
  });

  it("no calls → no receipts, and no mismatch noise", () => {
    const onMismatch = vi.fn();
    expect(receiptsWithReadBack([], [], { onMismatch })).toEqual([]);
    expect(onMismatch).not.toHaveBeenCalled();
  });

  it("a failed call is never promoted even if a stray true is paired with it", () => {
    const r = receiptsWithReadBack([{ name: "createTask", ok: false }], [{ verified: true }], { now: NOW });
    expect(r[0].status).toBe("failed");
    expect(r[0].verificationState).toBe("FAILED_KNOWN");
  });
});
