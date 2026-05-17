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
