/**
 * VAPI webhook auth · v10.0.525 · security audit fix (S-1)
 *
 * The v10.0.524 STRIDE+OWASP audit found CVSS 9.1 (Critical):
 *   - 4 VAPI webhook routes fail-OPEN when VAPI_WEBHOOK_SECRET
 *     is unset (was returning `true`)
 *   - Non-timing-safe `===` compare leaks the secret via timing
 *     side-channel over many requests
 *
 * Fix: single shared helper that:
 *   1. Fails CLOSED when the secret env var is unset · logs a
 *      warning so the operator sees the misconfiguration in logs
 *   2. Uses node:crypto.timingSafeEqual over equal-length Buffers
 *      with a constant-time length-mismatch branch
 *   3. Accepts both `x-vapi-secret` and `x-vapi-signature` headers
 *      to match VAPI's documented variants
 *
 * Usage in each of the 4 routes:
 *   if (!verifyVapiSecret(req)) {
 *     return NextResponse.json({ error: "unauthorized" }, { status: 401 });
 *   }
 */

import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("auth/vapi-webhook");

/**
 * Returns true iff the request carries a valid VAPI webhook
 * secret. Fails closed when the env var is unset.
 */
export function verifyVapiSecret(req: NextRequest | Request): boolean {
  const expected = (process.env.VAPI_WEBHOOK_SECRET ?? "").trim();
  if (!expected) {
    log.warn("vapi_secret_unset_fail_closed", {
      reason: "VAPI_WEBHOOK_SECRET env var not set; rejecting webhook",
    });
    return false;
  }

  // Try both header names VAPI documents.
  const got =
    req.headers.get("x-vapi-secret") ??
    req.headers.get("x-vapi-signature") ??
    "";

  if (!got) {
    log.warn("vapi_secret_header_missing");
    return false;
  }

  // timingSafeEqual requires equal-length Buffers · short-circuit
  // on length mismatch but in a way that doesn't reveal the
  // expected length via timing of the throw itself. We compare
  // the supplied secret against itself when lengths differ so the
  // call always takes the same time path.
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Constant-time self-compare so length-leak doesn't help.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}
