/**
 * lib/security/stripe-signature.ts
 *
 * Stripe webhook signature verification, without the SDK.
 *
 * EXTRACTED from app/api/webhooks/stripe/route.ts on 2026-09-02 (self-audit
 * of the same day's C-7 fix). Putting it in the route meant its test had to
 * import the route module — which drags in Prisma and the apiHandler stack to
 * exercise ten lines of pure crypto. A signature check is a security
 * primitive, belongs beside the other ones in lib/security, and should be
 * testable without a database.
 *
 * TWO defects are fixed here relative to the original inline version:
 *
 * 1 · REPLAY (C-7, fixed 2026-09-02). The old code parsed `t=`, folded it
 *     into the signed payload, and never compared it to the clock, so a
 *     captured request stayed valid forever while a comment above it claimed
 *     to match the standard protocol. The timestamp is the half of the
 *     scheme that bounds replay.
 *
 * 2 · SECRET ROTATION (found by the self-audit). The old code — and my first
 *     pass at fixing it — took `parts.find(v1=)`, i.e. the FIRST v1 only.
 *     During a rolling secret change Stripe signs the payload with BOTH the
 *     old and the new secret and sends several `v1=` entries in one header;
 *     the one matching your configured secret is not necessarily first. A
 *     receiver that checks only the first will reject live webhooks for the
 *     whole rotation window and look like an outage. Every v1 is compared
 *     now, each in constant time.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe's documented default replay tolerance, in seconds. A signature is
 * only valid inside this window around the `t=` timestamp it commits to.
 */
export const STRIPE_TOLERANCE_SECONDS = 300;

/** Constant-time hex compare that never throws on a malformed candidate. */
function hexEquals(a: string, b: string): boolean {
  try {
    const left = Buffer.from(a, "hex");
    const right = Buffer.from(b, "hex");
    if (left.length !== right.length || left.length === 0) return false;
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds: number = STRIPE_TOLERANCE_SECONDS,
): boolean {
  if (!signatureHeader || !secret) return false;

  const parts = signatureHeader.split(",").map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  // ALL v1 entries, not the first — see the rotation note in the header.
  const candidates = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));

  if (!timestamp || candidates.length === 0) return false;

  // Replay window. Rejected symmetrically: a far-future timestamp is as
  // suspect as an old one, and a non-numeric one is not a timestamp at all.
  const issuedAt = Number(timestamp);
  if (!Number.isFinite(issuedAt)) return false;
  if (Math.abs(nowSeconds - issuedAt) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");

  // Compare every candidate rather than short-circuiting on the first match,
  // so the work done does not depend on which position matched.
  let matched = false;
  for (const candidate of candidates) {
    if (hexEquals(candidate, expected)) matched = true;
  }
  return matched;
}
