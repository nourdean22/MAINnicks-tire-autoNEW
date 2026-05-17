// ── In-memory sliding window rate limiter ──────────────────────────────
// Resets on cold start (acceptable for Hobby plan abuse prevention).

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt < now) store.delete(key);
  }
}, 5 * 60 * 1000);

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  max: number;      // Max requests per window
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check rate limit for a given key (usually IP or route+IP).
 * Returns whether the request is allowed and remaining quota.
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    // New window
    store.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, remaining: config.max - 1, resetAt: now + config.windowMs };
  }

  entry.count++;

  if (entry.count > config.max) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  return { allowed: true, remaining: config.max - entry.count, resetAt: entry.resetAt };
}

/**
 * v10.0.77 · Cheap snapshot for /system/costs + provider-health HUD.
 * Returns the current count of tracked rate-limit buckets across all
 * routes. Map.size is O(1) — the previous TODO ("expensive to track
 * precisely") was about iterating to count *non-expired* entries, but
 * for the operator dashboard a slight over-count (entries within their
 * 5-minute cleanup window but past their windowMs) is acceptable signal.
 */
export function getActiveKeyCount(): number {
  return store.size;
}

/**
 * v10.0.529 S-4 fix · trustworthy client IP extraction.
 *
 * Pre-fix: only read `x-forwarded-for[0]` + `x-real-ip` (both
 * spoofable by any caller). An attacker rotating `x-forwarded-for`
 * per request would defeat per-IP rate limits.
 *
 * Vercel injects `x-vercel-forwarded-for` AFTER stripping any
 * caller-set value, so its leftmost entry is the platform-trusted
 * client IP. We prefer it. For raw `x-forwarded-for` chains we walk
 * the list and return the LAST non-private IP — the right hop is
 * the one closest to the trust boundary (Vercel/Railway edge), not
 * the leftmost which the attacker controls.
 *
 * On non-Vercel (local dev, Railway) the function still falls back
 * to x-real-ip → x-forwarded-for(last non-private) → "unknown".
 */
export function getClientIp(req: Request): string {
  // 1. Vercel-trusted header (set by the platform · cannot be spoofed)
  const vercelXff = req.headers.get("x-vercel-forwarded-for");
  if (vercelXff) {
    const first = vercelXff.split(",")[0]?.trim();
    if (first) return first;
  }

  // 2. Raw x-forwarded-for · take the LAST non-private hop. The
  //    request format is "client, proxy1, proxy2" — the rightmost
  //    address is what the trust boundary saw, not what the attacker
  //    initially injected.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (let i = hops.length - 1; i >= 0; i -= 1) {
      const ip = hops[i];
      if (!isPrivateIp(ip)) return ip;
    }
    // All hops were private (rare · indicates internal-only routing) ·
    // fall through to x-real-ip which may have a public address.
  }

  // 3. x-real-ip (set by some proxies · less trusted but better than nothing)
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri;

  return "unknown";
}

/**
 * RFC 1918 + loopback + link-local + ULA + IPv6 link-local matcher.
 * Used by getClientIp to skip "trusted infrastructure" hops in the
 * x-forwarded-for chain. NOT a security boundary on its own — only
 * used to pick the rate-limit-key IP.
 */
function isPrivateIp(ip: string): boolean {
  if (!ip || ip === "unknown") return true;
  // IPv6 loopback + link-local + unique-local
  if (ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) {
    return true;
  }
  // IPv4 ranges
  if (ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("169.254.")) {
    return true;
  }
  if (ip.startsWith("192.168.")) return true;
  // 172.16.0.0 – 172.31.255.255
  if (ip.startsWith("172.")) {
    const second = Number(ip.split(".")[1]);
    if (second >= 16 && second <= 31) return true;
  }
  // 0.0.0.0/8
  if (ip.startsWith("0.")) return true;
  return false;
}

// ── Preset configs ─────────────────────────────────────────────────────

export const RATE_LIMITS = {
  general: { windowMs: 60_000, max: 60 },   // 60 req/min
  ai: { windowMs: 60_000, max: 10 },        // 10 req/min
  auth: { windowMs: 60_000, max: 5 },       // 5 req/min
  sync: { windowMs: 60_000, max: 30 },      // 30 req/min
} as const;

/**
 * v9.1.19 · Sugar for direct-export AI routes (e.g. the chat route at
 * app/api/ai/chat/route.ts that does `export async function POST`
 * instead of going through apiHandler). Throws a 429 Response so the
 * outer handler can return it cleanly.
 *
 * Usage:
 *   await requireSession(req);
 *   const limit = checkAiRateLimit(req);
 *   if (limit) return limit; // 429
 */
export function checkAiRateLimit(req: Request): Response | null {
  const ip = getClientIp(req);
  const url = new URL(req.url);
  const key = `${url.pathname}:${ip}`;
  const result = checkRateLimit(key, RATE_LIMITS.ai);
  if (result.allowed) return null;
  return new Response(
    JSON.stringify({
      ok: false,
      error: "AI rate limit exceeded — try again in a minute",
      retryAfterMs: result.resetAt - Date.now(),
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil((result.resetAt - Date.now()) / 1000)),
      },
    },
  );
}
