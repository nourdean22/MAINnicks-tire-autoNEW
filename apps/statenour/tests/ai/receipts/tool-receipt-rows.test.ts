/**
 * toolReceiptRows is the one projection of an ActionReceipt into
 * tokenUsage.toolReceipts. persist-assistant-message (a finished turn) and the
 * errored-turn writer (stream-error-handler) both call it, so the two rows a
 * reload can find have the same shape. Extracting it must not change what a
 * finished turn stores.
 */
import { describe, it, expect } from "vitest";
import { toReceipt, type ActionReceipt } from "@/lib/ai/receipts/action-receipt";
import { toolReceiptRows } from "@/lib/ai/receipts/tool-receipt-rows";

const NOW = "2026-10-15T12:00:00.000Z";

// The inline map persist-assistant-message.ts held before the extraction,
// copied as it was: the oracle for "no behavior change".
const projectedInline = (receipts: ActionReceipt[]) =>
  receipts.map((r) => ({
    toolName: r.toolName,
    category: r.category,
    sideEffecting: r.sideEffecting,
    verifiable: r.verifiable,
    status: r.status,
    verificationState: r.verificationState,
    entityType: r.entityType ?? null,
    entityId: r.entityId ?? null,
  }));

const receipts = [
  toReceipt({ toolName: "createTask", ok: true, entityType: "task", entityId: "t1", label: "Call Mike", metadata: { note: "private" } }, { now: NOW }),
  toReceipt({ toolName: "searchMemories", ok: true }, { now: NOW }),
  toReceipt({ toolName: "notInTheCatalog", partial: true }, { now: NOW }),
  toReceipt({ toolName: "stageCustomerAlert", ok: false, error: "provider said no" }, { now: NOW }),
];

describe("toolReceiptRows", () => {
  it("projects exactly what the inline map in persist-assistant-message stored", () => {
    expect(toolReceiptRows(receipts)).toStrictEqual(projectedInline(receipts));
  });

  it("keeps the eight persisted fields and drops everything else", () => {
    const [row] = toolReceiptRows(receipts);
    expect(Object.keys(row).sort()).toEqual(
      ["category", "entityId", "entityType", "sideEffecting", "status", "toolName", "verifiable", "verificationState"],
    );
    expect(JSON.stringify(row)).not.toContain("Call Mike");
    expect(JSON.stringify(row)).not.toContain("private");
  });

  it("an empty list stays an empty array: [] is how a turn records 'no tool ran'", () => {
    expect(toolReceiptRows([])).toStrictEqual([]);
  });
});
