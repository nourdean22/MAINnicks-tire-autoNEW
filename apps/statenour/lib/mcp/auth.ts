/**
 * lib/mcp/auth.ts
 *
 * Owner auth for the MCP facade (docs/MCP-PLAN.md §4).
 *
 * A dedicated bearer secret (MCP_ACCESS_TOKEN) instead of the NextAuth
 * session: external MCP clients (ChatGPT connectors, MCP Inspector)
 * can't hold a Google OAuth session, and a dedicated token is
 * revocable on its own — rotate the Railway env var and every client
 * is cut off without touching operator auth.
 *
 * Fail-closed contract:
 *   · MCP_ACCESS_TOKEN unset  → 503 (Tier 0 — endpoint disabled)
 *   · token missing/mismatch  → 401
 *
 * Deliberately self-contained — this module does NOT import
 * lib/auth-guard.ts. Vitest globally mocks that module
 * (tests/setup/auth-guard-mock.ts) with only requireSession/
 * requireCronAuth/requireSyncAuth, so importing safeEqual from it
 * would be undefined under test. The 10 duplicated lines of
 * constant-time compare are the cheaper trade.
 */
import { timingSafeEqual } from "node:crypto";

export class McpAuthError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 503,
  ) {
    super(message);
    this.name = "McpAuthError";
  }
}

/** Constant-time string comparison (mirrors lib/auth-guard.safeEqual). */
function constantTimeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against self to keep constant time, then return false.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Validate the MCP bearer token. Accepts `Authorization: Bearer <token>`
 * or `x-mcp-token: <token>`. Throws McpAuthError on any failure.
 */
export function requireMcpAuth(req: Request): { actor: "mcp:external" } {
  const configured = process.env.MCP_ACCESS_TOKEN;
  if (!configured) {
    // Tier 0 — endpoint disabled by default. Never fall through to a
    // mock identity the way session auth does in dev; an external
    // control port must be explicitly armed.
    throw new McpAuthError("MCP endpoint is disabled (MCP_ACCESS_TOKEN not set)", 503);
  }
  const presented =
    req.headers.get("x-mcp-token") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (!constantTimeEqual(presented, configured)) {
    throw new McpAuthError("Unauthorized", 401);
  }
  return { actor: "mcp:external" };
}
