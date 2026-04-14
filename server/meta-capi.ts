/**
 * Meta Conversions API — STUB
 *
 * The full implementation was removed (dead integration: META_CAPI_ACCESS_TOKEN
 * was never configured in Railway). These no-op stubs exist so the router imports
 * don't break. If you later want server-side FB/IG conversion tracking:
 *  1. Generate an Access Token in Meta Business → Events Manager → Data Sources → CAPI
 *  2. Set META_CAPI_ACCESS_TOKEN + META_CAPI_PIXEL_ID in Railway
 *  3. Restore the real implementation from git history (commit 37c8093 and earlier)
 */

import { createLogger } from "./lib/logger";

const log = createLogger("meta-capi-stub");

function noop(eventName: string): Promise<{ success: false; reason: string }> {
  log.debug(`Meta CAPI disabled — ${eventName} event not sent`);
  return Promise.resolve({ success: false, reason: "META_CAPI_ACCESS_TOKEN not configured" });
}

export function sendCAPIEvent(_data: unknown) {
  return noop("generic");
}
export function sendLeadEvent(_data: unknown) {
  return noop("Lead");
}
export function sendScheduleEvent(_data: unknown) {
  return noop("Schedule");
}
export function sendContactEvent(_data: unknown) {
  return noop("Contact");
}
export function sendPurchaseEvent(_data: unknown) {
  return noop("Purchase");
}
