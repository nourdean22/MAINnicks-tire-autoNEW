import { requireSession } from "@/lib/auth-guard";
import { recordPageLeave } from "@/lib/services/brain-domain";
import { LEAVE_REASONS, type LeaveReason } from "@/lib/brain/page-dwell";

export const dynamic = "force-dynamic";

/**
 * POST /api/brain/page-leave (2026-10-23, usage telemetry). The end of a page visit: PageTracker sends
 * `{ page, dwellMs, reason }` with a keepalive fetch, because a tRPC mutation cannot run while the page
 * is closing. Same session guard as the page-visit path. A keepalive request has no readable response,
 * so success is a bare 204; a malformed body is a 400 and a failed write a 503, never a quiet 204.
 * The body is the only input and only these three fields are read: no query string, no tab, no text.
 */
export async function POST(req: Request) {
  await requireSession(req);
  // sendBeacon-style callers send text/plain, so parse the text rather than trusting the content type.
  const body = await req.text().then((t) => JSON.parse(t) as unknown).catch(() => null);
  const { page, dwellMs, reason } = (body && typeof body === "object" ? body : {}) as {
    page?: unknown;
    dwellMs?: unknown;
    reason?: unknown;
  };

  if (
    typeof page !== "string" ||
    page.length === 0 ||
    page.length > 512 ||
    typeof dwellMs !== "number" ||
    !(LEAVE_REASONS as readonly unknown[]).includes(reason)
  ) {
    return new Response(null, { status: 400 });
  }

  const { ok } = await recordPageLeave({ page, dwellMs, reason: reason as LeaveReason });
  // recordPageLeave rejects a negative or non-finite dwell too; that is the caller's bad input.
  if (!ok) return new Response(null, { status: Number.isFinite(dwellMs) && dwellMs >= 0 ? 503 : 400 });
  return new Response(null, { status: 204 });
}
