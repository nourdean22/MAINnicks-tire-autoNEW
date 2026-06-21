import rateLimit from "express-rate-limit";
import type { Request } from "express";

const clientIp = (req: Request): string => {
  const cfIp = req.headers["cf-connecting-ip"];
  if (typeof cfIp === "string") {
    return cfIp;
  }
  return req.ip || "unknown";
};

// Rate limiting for public API endpoints to prevent spam/abuse
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  keyGenerator: clientIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later or call us at (216) 862-0005." },
});

// Stricter rate limit for form submissions (booking, lead, callback)
export const formLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 form submissions per hour per IP
  keyGenerator: clientIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions. Please call us directly at (216) 862-0005." },
});

// Stricter rate limit for AI/chat endpoints (expensive operations)
export const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // 30 AI requests per hour per IP
  keyGenerator: clientIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many AI requests. Please try again later or call us at (216) 862-0005." },
});

// Upload limiter — tighter than forms: 15 uploads/hour/IP (each is a ~7MB base64 payload)
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  keyGenerator: clientIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many file uploads. Please try again later." },
});
