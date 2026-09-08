/**
 * Security Headers Middleware
 * Hardens HTTP responses against common attacks.
 * Aligned with OWASP security header recommendations.
 *
 * 2026-05-05: strengthened per Lighthouse Best Practices audit:
 * - HSTS: added `preload` directive (still need to register at hstspreload.org)
 * - COOP: added Cross-Origin-Opener-Policy for origin isolation
 * - CORP: added Cross-Origin-Resource-Policy
 */

import type { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";

/**
 * 2026-09-08 · script-src without 'unsafe-inline' in production.
 *
 * The site ships exactly ONE executable inline script — the analytics loader
 * in client/index.html — and every prerendered snapshot carries the same
 * bytes (336/336 pages, one distinct sha256, measured before this change).
 * A CSP that allows any inline script allows an injected one too; a CSP that
 * allows only this script's hash allows nothing else. Vite leaves plain
 * inline <script> blocks untouched at build time (dist hash == source hash),
 * and React never emits inline handlers, so nothing else needs the escape.
 *
 * Dev keeps 'unsafe-inline': Vite's HMR client and React Refresh inject
 * inline scripts whose bytes change. The server configures this once at boot
 * (index.ts) from the HTML it will actually serve; no hashes → the old header.
 *
 * Kill switch without a deploy: CSP_ALLOW_UNSAFE_INLINE_SCRIPTS=true.
 */
const SCRIPT_TAG = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
const EXECUTABLE_TYPES = /^(module|text\/javascript|application\/javascript|text\/ecmascript)$/i;

/** sha256 (base64) of every executable inline script in an HTML document, in order. */
export function inlineScriptHashes(html: string): string[] {
  const out: string[] = [];
  SCRIPT_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SCRIPT_TAG.exec(html))) {
    const attrs = m[1] ?? "";
    if (/\ssrc\s*=/i.test(attrs)) continue; // external — governed by the host list
    const type = /\stype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1];
    if (type && !EXECUTABLE_TYPES.test(type)) continue; // ld+json etc. never execute
    out.push(createHash("sha256").update(m[2], "utf8").digest("base64"));
  }
  return out;
}

let cspInlineScriptHashes: string[] = [];

/** Called once at boot with the hashes of the HTML this server serves. Empty → 'unsafe-inline'. */
export function configureCspInlineScripts(hashes: string[]): void {
  cspInlineScriptHashes = [...new Set(hashes)];
}

/** What script-src will say about inline scripts right now (exported for the boot log + tests). */
export function cspInlineScriptSource(): string {
  return cspInlineScriptHashes.length
    ? cspInlineScriptHashes.map((h) => `'sha256-${h}'`).join(" ")
    : "'unsafe-inline'";
}

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  // Prevent MIME-type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "DENY");

  // Disable the broken legacy XSS auditor — it causes more vulnerabilities than it prevents.
  // CSP is the correct protection layer.
  res.setHeader("X-XSS-Protection", "0");

  // Force HTTPS — `preload` directive enables future hstspreload.org registration
  // for inclusion in browser preload lists (HSTS active even on first visit).
  // To complete: submit nickstire.org at https://hstspreload.org/
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");

  // Cross-Origin-Opener-Policy — origin isolation for Spectre-class attacks.
  // `same-origin` keeps full control while preventing cross-origin window references.
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");

  // Cross-Origin-Resource-Policy — limits which origins can embed our resources.
  // `same-site` allows our subdomains (autonicks.com → nickstire.org) but blocks
  // arbitrary external embedders.
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");

  // Referrer policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // Permissions policy (restrict ALL sensitive APIs — the site doesn't need camera/mic/geo).
  // 2026-09-07 · added usb / midi / display-capture / browsing-topics (the last
  // opts the site out of Chrome's Topics API for ad profiling). `payment=()` is
  // deliberately NOT here: /pay uses Stripe, whose wallet buttons need the
  // Payment Request API.
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), usb=(), midi=(), display-capture=(), browsing-topics=()");

  // Content Security Policy
  // script-src: hashes of the served inline scripts in production (see the
  // header comment), 'unsafe-inline' only when none were configured (dev).
  // style-src keeps 'unsafe-inline': Tailwind/React inline styles.
  // unsafe-eval REMOVED — not needed in production (only Vite dev HMR)
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    `script-src 'self' ${cspInlineScriptSource()} https://www.googletagmanager.com https://connect.facebook.net https://www.google-analytics.com https://analytics.ahrefs.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    // 2026-09-07 · GA4 beacons do not only go to www.google-analytics.com:
    // gtag.js also posts to regional hosts (region1.google-analytics.com),
    // analytics.google.com and stats.g.doubleclick.net (Google Signals).
    // Google's own CSP guide lists exactly these wildcards for connect-src;
    // without them a share of hits was dropped at the browser with no
    // server-side trace. Verify in DevTools: no "Refused to connect" for a
    // /g/collect URL.
    "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://*.g.doubleclick.net https://www.facebook.com https://d2xsxph8kpxj0f.cloudfront.net https://api.nhtsa.gov https://analytics.ahrefs.com",
    "frame-src https://www.google.com https://maps.google.com",
    "media-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
    // upgrade-insecure-requests: rewrites http:// to https:// automatically
    // (defense-in-depth even with HSTS — covers user-typed URLs in our forms)
    "upgrade-insecure-requests",
  ].join("; "));

  next();
}
