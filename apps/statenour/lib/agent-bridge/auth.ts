import { createHash, timingSafeEqual } from "node:crypto";
import type { BridgeScope } from "./scopes";

// Hash both sides to fixed length so the comparison is constant-time and
// never branches on secret length — a plain !== leaks match-prefix timing.
function secretsMatch(candidate: string, secret: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

/** Who called, and how much they may do. `clientId` is safe to audit — it is
 *  the token's NAME, never the token value. */
export interface BridgeIdentity {
  clientId: string;
  scope: BridgeScope;
}

/**
 * Per-client tokens, 2026-08-27. The bridge used to accept ONE flat token
 * (`AGENT_BRIDGE_SECRET_TOKEN`) that granted the entire 181-tool surface
 * including `runPython`. A single-secret compromise was total. Now each token
 * carries a scope, so a narrow client (Dispatch) can be handed a token that
 * cannot reach a write tool at all.
 *
 * NAMED, not the value: the returned clientId is the env-var stem, which the
 * audit row records. The token itself never leaves this function.
 */
interface TokenSlot {
  clientId: string;
  scope: BridgeScope;
  env: string;
}
const TOKEN_SLOTS: readonly TokenSlot[] = [
  { clientId: "read-client", scope: "read", env: "AGENT_BRIDGE_TOKEN_READ" },
  { clientId: "tasks-client", scope: "tasks", env: "AGENT_BRIDGE_TOKEN_TASKS" },
  // Legacy single token. Capability REDUCED to read-only: it used to grant the
  // full surface, and the whole point of this change is that no token does.
  // Measured zero bridge callers ever, so nothing breaks; a client needing
  // writes gets AGENT_BRIDGE_TOKEN_TASKS. Kept valid so existing auth tests and
  // any (unobserved) integration keep resolving.
  { clientId: "legacy", scope: "read", env: "AGENT_BRIDGE_SECRET_TOKEN" },
];

/**
 * Resolve a presented token to an identity, or null. Pure over an injected
 * env map so the canary can drive every slot without touching process.env.
 * Constant-time compare against every CONFIGURED slot; the first match wins.
 * An unset slot can never match (an empty secret is skipped, not compared to
 * an empty token).
 */
export function resolveBridgeToken(
  token: string,
  env: Record<string, string | undefined> = process.env,
): BridgeIdentity | null {
  let match: BridgeIdentity | null = null;
  for (const slot of TOKEN_SLOTS) {
    const secret = (env[slot.env] ?? "").trim();
    if (!secret || !token) continue;
    // Compare EVERY configured slot (no early return) so total work does not
    // depend on which slot matched — the same constant-time discipline the
    // hash compare gives within a slot, extended across slots.
    if (secretsMatch(token, secret) && !match) {
      match = { clientId: slot.clientId, scope: slot.scope };
    }
  }
  return match;
}

/**
 * Assert the request is authorized and RETURN its identity. Throws the same
 * "Unauthorized" / "Forbidden" / "disabled" / "Failing closed" strings the
 * route already maps to 401 / 403 / 503 — the contract auth.test.ts pins.
 */
export function assertBridgeAuth(req: Request): BridgeIdentity {
  if (process.env.AGENT_BRIDGE_ENABLED !== "true") {
    throw new Error("Agent Bridge is disabled.");
  }

  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    throw new Error("Unauthorized");
  }

  // Fail closed if NO token slot is configured at all — the old behaviour for
  // the missing single secret, generalised.
  const anyConfigured = TOKEN_SLOTS.some((s) => (process.env[s.env] ?? "").trim().length > 0);
  if (!anyConfigured) {
    throw new Error(
      "Server configuration error: no AGENT_BRIDGE token is set (AGENT_BRIDGE_TOKEN_READ / _TASKS / legacy AGENT_BRIDGE_SECRET_TOKEN). Failing closed.",
    );
  }

  const identity = resolveBridgeToken(token);
  if (!identity) {
    throw new Error("Forbidden");
  }
  return identity;
}
