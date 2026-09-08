/**
 * Global vitest mock for `@/lib/auth-guard`.
 *
 * v8.26 · Routes that previously had no auth check now call
 * `requireSession(req)` (added by scripts/add-route-auth.ts). The
 * real `lib/auth-guard.ts` imports `@/auth` which pulls in next-auth's
 * full runtime — incompatible with the vitest node environment because
 * next-auth resolves `next/server` differently than vitest does.
 *
 * Tests don't care about real auth; they care about the route logic.
 * This mock returns a stable mock operator so any route under test
 * sees a "logged-in" Nour without next-auth being loaded.
 *
 * Pulled in via vitest.config.ts `setupFiles`.
 */

import { vi } from "vitest";
import { timingSafeEqual } from "node:crypto";

/**
 * 2026-09-07 · `safeEqual` is the ONE export of auth-guard that carries no
 * next-auth dependency, and every header/bearer-secret route calls it
 * (inbound-crm, health/summary, prompt-cache-flush, bridge-auth). Without it
 * here, any route test that reached a secret compare got `safeEqual is not a
 * function` → a 500 from apiHandler → and a test asserting "not 401" passed
 * on a crash. Mirrors lib/auth-guard.ts exactly: constant-time, length-safe.
 */
function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

vi.mock("@/lib/auth-guard", () => ({
  requireSession: vi.fn().mockResolvedValue({
    id: "operator-1",
    email: "nick@example.com",
    role: "operator",
  }),
  requireCronAuth: vi.fn(),
  requireSyncAuth: vi.fn(),
  safeEqual,
}));

// 2026-08-11 · cost-firewall default-off IN THE TEST SUITE ONLY: the
// provider-chain tests deliberately exercise metered-lane rotation
// mechanics on fake keys, which the firewall would otherwise filter.
// Production default is ON (NICK_COST_FIREWALL unset → on). The
// dedicated firewall tests (tests/ai/cost-firewall.test.ts) re-enable
// it per case. `??=` keeps any explicit shell value authoritative.
process.env.NICK_COST_FIREWALL ??= "0";
