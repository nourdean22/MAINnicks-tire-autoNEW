/**
 * GET /api/ai/diagnose-chat — diagnose why the chat route is broken
 * WITHOUT going through the chat route itself.
 *
 * Apr 19 · Created because the "Diagnose with Nick" button on the
 * chat error card was circularly sending another chat message to
 * the same broken endpoint.
 *
 * hooks-lib REST→tRPC slice (2026-05-22) · the probe assembly (Venice
 * + Neon health checks + recent chat errors / slow requests / ai_error
 * audit events + the markdown report) moved verbatim to
 * `lib/services/diagnose-chat.runChatDiagnostic` so the legacy REST
 * consumer AND the new `system.diagnoseChat` tRPC procedure can't
 * drift. `useChatDiagnose` now reads tRPC; this route stays mounted as
 * the coexistence / rollback path.
 *
 * Always-on. Owner-auth. Returns JSON envelope { ok, report, status,
 * checks }.
 */
import { apiHandler } from "@/lib/utils/http";
import { runChatDiagnostic } from "@/lib/services/diagnose-chat";

export const GET = apiHandler(async () => runChatDiagnostic(), {
  auth: "owner",
  rateLimit: "ai", // v9.1.19 · cost-bomb guard
});
