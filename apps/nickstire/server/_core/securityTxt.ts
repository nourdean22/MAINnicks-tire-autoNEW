/**
 * /.well-known/security.txt — RFC 9116.
 *
 * 2026-09-08 · a researcher who finds something has had no sanctioned place
 * to say so; the file tells them where, and `Expires` tells them the answer
 * is current. Contact points are the shop's public contact page and public
 * phone — both already on every page, so nothing new is disclosed. The
 * legacy top-level path 301s to the well-known one, as the RFC recommends.
 *
 * Expires is required by the RFC and MUST be under a year out; it is derived
 * from the boot time (180 days) so it can never silently go stale for longer
 * than a deploy cycle. Dates are whole days, UTC.
 */
import type { Express } from "express";

export interface SecurityTxtOptions {
  /** Canonical origin, no trailing slash — e.g. "https://nickstire.org". */
  siteUrl: string;
  /** `tel:` URI for the public shop phone (BUSINESS.phone.href). */
  contactPhoneHref: string;
  /** Injected for tests; defaults to boot time. */
  now?: Date;
}

export const SECURITY_TXT_PATH = "/.well-known/security.txt";
export const SECURITY_TXT_TTL_DAYS = 180;

export function buildSecurityTxt({ siteUrl, contactPhoneHref, now = new Date() }: SecurityTxtOptions): string {
  const expires = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + SECURITY_TXT_TTL_DAYS));
  return [
    `Contact: ${siteUrl}/contact`,
    `Contact: ${contactPhoneHref}`,
    `Expires: ${expires.toISOString()}`,
    "Preferred-Languages: en",
    `Canonical: ${siteUrl}${SECURITY_TXT_PATH}`,
    "",
  ].join("\n");
}

/** Mounts the well-known path plus the legacy `/security.txt` redirect. Registered before the SPA catch-all. */
export function registerSecurityTxt(app: Express, opts: Omit<SecurityTxtOptions, "now">): void {
  // Built once per process: the boot time IS the "now" the Expires derives from.
  const body = buildSecurityTxt(opts);
  app.get(SECURITY_TXT_PATH, (_req, res) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(body);
  });
  app.get("/security.txt", (_req, res) => res.redirect(301, SECURITY_TXT_PATH));
}
