import { ServiceError } from "@/lib/utils/service-error";
import { safeEqual } from "@/lib/auth-guard";

/**
 * Validate X-Bridge-Key header against BRIDGE_API_KEY env var.
 * Throws ServiceError on failure — compatible with apiHandler wrapper.
 */
export function requireBridgeAuth(req: Request): void {
  const bridgeKey = process.env.BRIDGE_API_KEY;
  if (!bridgeKey) {
    throw new ServiceError("Bridge not configured", 503);
  }
  // 2026-06-01 · timing-safe compare. Was `provided !== bridgeKey`, a
  // timing side-channel — every other secret in this codebase (cron, sync,
  // VAPI, nour-os) compares via safeEqual/timingSafeEqual. This was the
  // lone `!==`.
  const provided = req.headers.get("x-bridge-key") ?? "";
  if (!safeEqual(provided, bridgeKey)) {
    throw new ServiceError("Unauthorized", 401);
  }
}
