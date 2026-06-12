import { runDriftScan, getUnresolvedAlerts, acknowledgeAlert, resolveAlert } from "@/lib/mastery/drift-engine";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";

// v10.0.44 — auth: "owner" added to both. Drift alerts are operator-
// private signals + POST mutates state (scan / acknowledge / resolve).
export const GET = apiHandler(async () => {
  const alerts = await getUnresolvedAlerts();
  return { alerts, count: alerts.length };
}, { auth: "owner" });

export const POST = apiHandler(async (req) => {
  const body = await req.json();
  const action = body.action;

  if (action === "scan") {
    const fired = await runDriftScan();
    return { fired, count: fired.length };
  }

  // Coerce id — DriftAlert.id is Int @id but the notification bell
  // (and other callers) stringify the id into URL fragments like
  // "drift-42", then strip the prefix and POST the remaining "42"
  // as a STRING. Prisma throws an unhelpful 500 when it receives a
  // string for an Int column. Accept both shapes + fail cleanly if
  // neither parses so a stale notification can't crash dismiss.
  const rawId = body.id;
  if (rawId === undefined || rawId === null) {
    throw new ServiceError("Missing id", 400);
  }
  const parsedId = typeof rawId === "number" ? rawId : String(rawId);

  if (action === "acknowledge") {
    await acknowledgeAlert(parsedId);
    return { ok: true };
  }

  if (action === "resolve") {
    // Stale localStorage IDs (drift-XXX for rows already resolved or
    // auto-archived by backlog-triage) shouldn't blow up the client.
    // Swallow "Record to update not found" — the UI wants to hide it
    // either way.
    try {
      await resolveAlert(parsedId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/Record to update not found|not found/i.test(msg)) {
        return { ok: true, note: "already gone" };
      }
      throw err;
    }
    return { ok: true };
  }

  throw new ServiceError("Unknown action", 400);
}, { auth: "owner" });
