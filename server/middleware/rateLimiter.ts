/**
 * Tiered Rate Limiting — Per-endpoint rate control
 * Uses express-rate-limit (already in package.json)
 */

import rateLimit from "express-rate-limit";

// ─── General API limiter (100 req / 15 min) ─────
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests", retryAfter: 900 },
  skip: (req) => req.path === "/api/ping" || req.path === "/api/health",
});

// ─── Form submission limiter (5 req / 15 min) ───
export const formLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many form submissions. Please wait before trying again.", retryAfter: 900 },
});

// ─── AI endpoint limiter (20 req / 15 min) ──────
export const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "AI request limit reached. Please wait a moment.", retryAfter: 900 },
});

// ─── Admin limiter (200 req / 15 min) ───────────
export const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Admin rate limit exceeded", retryAfter: 900 },
});

// ─── Quote/contact limiter (10 req / 15 min) ────
export const quoteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many quote requests. Please call us at (216) 862-0005.", retryAfter: 900 },
});
