import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

const clientIp = (req: Request): string => {
  // Extract real IP behind Cloudflare/Railway. Cloudflare guarantees cf-connecting-ip
  // cannot be spoofed *if* the traffic passed through CF. 
  let raw = (req.headers["cf-connecting-ip"] as string) || 
            (req.headers["x-real-ip"] as string) || 
            req.ip || 
            "unknown";
            
  // Prevent spoofing via comma-separated header injection
  if (raw && raw !== "unknown" && raw.includes(",")) {
    raw = raw.split(",")[0].trim();
  }
  
  // Normalize IPv6 to its subnet via express-rate-limit's helper so IPv6
  // clients can't bypass limits by hopping addresses within their /64
  // allocation (silences ERR_ERL_KEY_GEN_IPV6 from the v8 keyGenerator
  // validator). IPv4 is returned unchanged; the "unknown" fallback is passed
  // through untouched since it isn't an IP.
  return raw === "unknown" ? raw : ipKeyGenerator(raw);
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
