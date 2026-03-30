/**
 * Security Headers Middleware
 * Hardens HTTP responses against common attacks.
 * Aligned with OWASP security header recommendations.
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

  // Force HTTPS
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  // Referrer policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // Permissions policy (restrict ALL sensitive APIs — the site doesn't need camera/mic/geo)
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  // Content Security Policy
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://connect.facebook.net https://www.google-analytics.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https: http:",
    "connect-src 'self' https://www.google-analytics.com https://www.facebook.com https://d2xsxph8kpxj0f.cloudfront.net https://api.nhtsa.gov",
    "frame-src https://www.google.com https://maps.google.com",
    "media-src 'self' blob:",
    "frame-ancestors 'none'",
  ].join("; "));

  next();
}
