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

/**
 * A SIGNED-IN OPERATOR IS NOT AN ANONYMOUS ABUSER.
 *
 * `app.use("/api/trpc", apiLimiter)` applied a 100-per-15-minutes anti-spam
 * budget to EVERY tRPC call, including the admin console's own. The console's
 * POLLING alone spends roughly five times that budget before the operator
 * clicks anything:
 *
 *     2 queries at 5s   = 360 requests / 15 min
 *     4 queries at 30s  = 120
 *     3 queries at 60s  =  45
 *     2 queries at 120s =  15
 *                       ≈ 540  against a limit of 100
 *
 * And batching is deliberately blocked upstream (_core/index.ts:280) so a
 * batched call cannot count as one — every query is charged separately.
 *
 * So a few minutes into any admin session every tRPC call 429s, INCLUDING
 * auth.me. The client reads that failure as "no user" and renders the
 * "Sign in required" screen — the operator signs in with Google, lands back on
 * the sign-in screen, and no amount of signing in fixes it, because the session
 * was never the problem. Reported live 2026-07-20; the admin was unusable.
 *
 * Two tiers rather than an exemption. Authenticated traffic still has a ceiling
 * — a leaked session must not become an unlimited API key — but the ceiling is
 * set above what the product itself generates instead of a fifth of it.
 *
 * The check is cookie PRESENCE, not validity, and that is the correct trade
 * here: verifying a JWT on every request in middleware costs more than the
 * limiter saves, and the downgrade for guessing wrong is merely the higher
 * bucket. Authorization is still enforced downstream by adminProcedure, which
 * this does not touch.
 */
const AUTHED_WINDOW_MS = 15 * 60 * 1000;
const ANON_MAX_PER_WINDOW = 100;
/** ~3x the console's measured polling draw, so normal use never reaches it. */
const AUTHED_MAX_PER_WINDOW = 1500;

function looksAuthenticated(req: Request): boolean {
  const cookie = req.headers.cookie;
  return typeof cookie === "string" && cookie.includes("app_session_id=");
}

export const apiLimiter = rateLimit({
  windowMs: AUTHED_WINDOW_MS,
  max: (req: Request) => (looksAuthenticated(req) ? AUTHED_MAX_PER_WINDOW : ANON_MAX_PER_WINDOW),
  // Separate buckets, so anonymous traffic from a shared NAT cannot spend the
  // operator's allowance and lock them out of their own admin.
  keyGenerator: (req: Request) => `${looksAuthenticated(req) ? "auth" : "anon"}:${clientIp(req)}`,
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
