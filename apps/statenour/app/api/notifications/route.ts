import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";

/** GET /api/notifications — RETIRED v11.1
 *  NotificationQueue model was retired in the Apr 18 consolidation.
 *  Notifications now go through web-push directly (see
 *  /api/notifications/subscribe + /api/notifications/dispatch).
 *  Returns empty shape for backwards compat with any stale callers. */
export const GET = apiHandler(async () => {
  return { data: [], pagination: { page: 1, perPage: 20, total: 0, hasMore: false } };
});

/** POST /api/notifications — no-op enqueue (retired). */
// mutation-census: exception — retired stub; validates shape and returns
// {retired:true} without writing anything, so there is no state to guard.
export const POST = apiHandler(async (req) => {
  const body = await req.json();
  if (!body.channel || !body.recipient || !body.body) {
    throw new ServiceError("channel, recipient, and body are required", 400);
  }
  return { ok: true, retired: true };
});
