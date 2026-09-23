/**
 * resend-sender — which From address the app ACTUALLY sends Resend mail from.
 *
 * Mirrors the one expression both runtime senders use (server/email-notify.ts and
 * server/services/dripProcessor.ts):
 *
 *   process.env.RESEND_FROM_EMAIL || "Nick's Tire & Auto <noreply@nickstire.org>"
 *
 * WHY THIS FILE EXISTS. #2593 wrote verify-resend-domain.mjs against EMAIL_FROM,
 * a variable no runtime code reads, so the verifier checked an address the app
 * never sends from and could report SENDING while real mail failed. The verifier
 * now resolves the sender here, and resendSender.test.ts fails if either runtime
 * sender stops using exactly this expression.
 */
export const APP_DEFAULT_FROM = "Nick's Tire & Auto <noreply@nickstire.org>";

/** Domain of a From value ("Name <a@b.org>" or "a@b.org"), or null. */
export function fromDomain(from) {
  if (typeof from !== "string" || !from.includes("@")) return null;
  const domain = from.split("@").pop().replace(/>.*$/, "").trim().toLowerCase();
  return domain || null;
}

/**
 * Resolve the sender exactly as the app does. `||`, not `??`: an empty
 * RESEND_FROM_EMAIL falls through to the default, same as the runtime.
 * EMAIL_FROM is reported only so a caller can say it is being ignored.
 */
export function resolveSender(env) {
  const set = env.RESEND_FROM_EMAIL;
  const from = set || APP_DEFAULT_FROM;
  return {
    from,
    source: set ? "RESEND_FROM_EMAIL" : "app default (RESEND_FROM_EMAIL unset)",
    domain: fromDomain(from),
    ignoredEmailFrom: env.EMAIL_FROM ? env.EMAIL_FROM : null,
  };
}
