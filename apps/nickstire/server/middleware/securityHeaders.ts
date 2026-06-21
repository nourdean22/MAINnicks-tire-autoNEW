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

  // Permissions policy (restrict ALL sensitive APIs — the site doesn't need camera/mic/geo)
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  // Content Security Policy
  // unsafe-inline required for GA4/Meta Pixel inline scripts + Tailwind inline styles
  // unsafe-eval REMOVED — not needed in production (only Vite dev HMR)
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://connect.facebook.net https://www.google-analytics.com https://analytics.ahrefs.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://www.google-analytics.com https://www.facebook.com https://d2xsxph8kpxj0f.cloudfront.net https://api.nhtsa.gov https://analytics.ahrefs.com",
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
