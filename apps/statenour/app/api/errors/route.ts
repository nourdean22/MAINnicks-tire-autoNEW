/**
 * POST /api/errors — client-side error ingest.
 *
 * Receives unhandled errors, unhandled promise rejections, and
 * React error-boundary trips from the browser. Writes to ErrorLog
 * so the /system/errors page can surface them.
 *
 * Passive — telemetry-only. Zero side effects beyond the write.
 * Auth: owner-only (session). Rate-limited client-side via
 * ClientErrorTelemetry (dedupe + 10/min cap); server adds a
 * belt-and-suspenders sanity cap.
 *
 * scattered-components REST→tRPC slice (2026-05-22) · the write logic
 * moved to the shared `lib/services/client-error.recordClientError`
 * service · this route AND the new `trpc.system.recordClientError`
 * procedure call the same function · drift impossible. The route stays
 * mounted as the coexistence / rollback path.
 */
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import {
  recordClientError,
  type ClientErrorInput,
} from "@/lib/services/client-error";

export const POST = apiHandler(
  async (req) => {
    const body = await readRequestJson<ClientErrorInput>(req).catch(
      () => null,
    );
    if (!body || typeof body.message !== "string" || !body.message) {
      return { ok: false, reason: "invalid payload" };
    }
    return recordClientError(body);
  },
  { auth: "owner" },
);
