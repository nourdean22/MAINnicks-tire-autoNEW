/**
 * Nick AI Agent Actions — Quote creation, work order creation,
 * follow-up scheduling, competitor monitoring, chat-to-action dispatcher.
 *
 * Philosophy: VERIFY EVERYTHING. No assumptions. Every AI output is
 * parsed, validated, and verified before being stored or acted upon.
 *
 * This is the tRPC router. Handler logic lives in ./nick/ sub-modules.
 */
import { adminProcedure, router, dbAdminProcedure } from "../_core/trpc";
import { logAdminAction } from "../services/auditTrail";

// ─── Sub-module imports ─────────────────────────────────
import { handleRunMigrations } from "./nick/intelligence";
import {
  handleShopPulse, handleCronHealth,
} from "./nick/chat";

export const nickActionsRouter = router({

  // ─── Customer message previews (PREVIEW ONLY) ─────────
  // 2026-06-10 danger-zone-safe-build · renders the five customer
  // confirmation templates against a SAMPLE order so the owner can
  // review exact copy in the Ops Hub. Read-only: no DB, no provider,
  // no send path exists (sendCustomerMessage always throws — see
  // services/customerMessageTemplates.ts).
  customerMessagePreviews: adminProcedure.query(async () => {
    const { TEMPLATE_BUILDERS } = await import("../services/customerMessageTemplates");
    const sample = {
      customerName: "Sample Customer",
      orderNumber: "TO-SAMPLE-000",
      quantity: 4,
      tireBrand: "NEXEN",
      tireModel: "N'Priz AH5",
      tireSize: "215/60R16",
      totalAmount: 544.0,
    };
    return Object.entries(TEMPLATE_BUILDERS).map(([key, build]) => {
      const msg = build(sample);
      return { key, sms: msg.sms, emailSubject: msg.email.subject, emailBody: msg.email.body };
    });
  }),

  // ─── Shop Status ──────────────────────────────────────
  shopPulse: adminProcedure.query(async () => handleShopPulse()),
  cronHealth: dbAdminProcedure.query(async () => handleCronHealth()),
  runMigrations: adminProcedure.mutation(async ({ ctx }) => {
    // Raw DDL execution — the single highest-privilege operator lever, and it
    // was completely unaudited. Log who ran it + the applied/skipped/error
    // summary the handler returns. Fire-and-forget so audit never blocks the run.
    const result = await handleRunMigrations();
    logAdminAction({
      action: "migrations.ran",
      entityType: "database",
      entityId: "migrations",
      details: "Operator ran DB migrations",
      metadata: result as Record<string, unknown>,
      actor: ctx.user?.email ?? ctx.user?.name ?? "admin",
    }).catch(() => { /* audit must never break the migration run */ });
    return result;
  }),
});
