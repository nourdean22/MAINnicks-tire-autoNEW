/**
 * GET /api/system/receipt-feed · F4 action receipt feed.
 *
 * Owner-only, read-only. "What did Nick/system actually DO?" — a reverse-chron
 * feed of write actions (from EntityAudit) + autonomous actions (incl. FAILED
 * ones), normalized onto the ActionReceipt contract. No false "done" claims.
 */

import { apiHandler } from "@/lib/utils/http";
import { buildActionReceiptFeed } from "@/lib/services/action-receipt-feed";

export const GET = apiHandler(async () => buildActionReceiptFeed(), { auth: "owner" });
