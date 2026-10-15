import type { ActionReceipt } from "./action-receipt";

/**
 * What tokenUsage.toolReceipts stores per tool: what ran, whether it mutates,
 * how far it was verified. No args and no results: both can carry secrets or PII.
 * A type alias, not an interface, so it casts to Prisma's JSON input type.
 */
export type ToolReceiptRow = {
  toolName: string;
  category: string;
  sideEffecting: boolean;
  verifiable: boolean | undefined;
  status: ActionReceipt["status"];
  verificationState: ActionReceipt["verificationState"];
  entityType: string | null;
  entityId: string | null;
};

/** The one projection shared by a finished turn's row and an errored turn's row. */
export function toolReceiptRows(receipts: readonly ActionReceipt[]): ToolReceiptRow[] {
  return receipts.map((r) => ({
    toolName: r.toolName,
    category: r.category,
    sideEffecting: r.sideEffecting,
    verifiable: r.verifiable,
    status: r.status,
    verificationState: r.verificationState,
    entityType: r.entityType ?? null,
    entityId: r.entityId ?? null,
  }));
}
