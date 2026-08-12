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

vi.mock("@/lib/auth-guard", () => ({
  requireSession: vi.fn().mockResolvedValue({
    id: "operator-1",
    email: "nick@example.com",
    role: "operator",
  }),
  requireCronAuth: vi.fn(),
  requireSyncAuth: vi.fn(),
}));

// 2026-08-11 · cost-firewall default-off IN THE TEST SUITE ONLY: the
// provider-chain tests deliberately exercise metered-lane rotation
// mechanics on fake keys, which the firewall would otherwise filter.
// Production default is ON (NICK_COST_FIREWALL unset → on). The
// dedicated firewall tests (tests/ai/cost-firewall.test.ts) re-enable
// it per case. `??=` keeps any explicit shell value authoritative.
process.env.NICK_COST_FIREWALL ??= "0";
