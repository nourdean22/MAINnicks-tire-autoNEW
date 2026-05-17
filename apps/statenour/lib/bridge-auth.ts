import { ServiceError } from "@/lib/utils/service-error";

/**
 * Validate X-Bridge-Key header against BRIDGE_API_KEY env var.
 * Throws ServiceError on failure — compatible with apiHandler wrapper.
 */
export function requireBridgeAuth(req: Request): void {
  const bridgeKey = process.env.BRIDGE_API_KEY;
  if (!bridgeKey) {
    throw new ServiceError("Bridge not configured", 503);
  }
  const provided = req.headers.get("x-bridge-key");
  if (provided !== bridgeKey) {
    throw new ServiceError("Unauthorized", 401);
  }
}
