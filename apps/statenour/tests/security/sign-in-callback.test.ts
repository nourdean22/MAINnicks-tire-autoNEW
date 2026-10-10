/**
 * tests/security/sign-in-callback.test.ts · audit 2026-10-10 F11.
 *
 * The sign-in page redirects an already-signed-in operator to `callbackUrl`.
 * Its check rejected only a leading "//", so "/\evil.com" passed: browsers
 * read a backslash as a slash, and Location: /\evil.com goes to evil.com.
 * "/%5Cevil.com" is the same shape one decode later.
 *
 * Drives the REAL page component. Only its runtime deps are replaced: the
 * NextAuth runtime, the operator-session lookup (a signed-in owner), and
 * next/navigation's redirect (recorded, then thrown the way Next throws it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/auth", () => ({ signIn: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getAuthRuntimeMode: () => "google",
  getOperatorSession: async () => ({ email: "owner@example.com" }),
}));
vi.mock("@/components/ui/glass-card", () => ({ GlassCard: () => null }));
vi.mock("@/components/ui/button", () => ({ Button: () => null }));

import SignInPage from "@/app/auth/sign-in/page";

const FALLBACK = "/chat";

/** Where a signed-in operator is sent for this callbackUrl. */
async function destination(callbackUrl: string): Promise<string> {
  redirect.mockClear();
  await SignInPage({ searchParams: Promise.resolve({ callbackUrl }) }).catch(() => undefined);
  expect(redirect, `no redirect for ${JSON.stringify(callbackUrl)}`).toHaveBeenCalledTimes(1);
  return redirect.mock.calls[0][0];
}

beforeEach(() => {
  vi.stubEnv("AUTH_ALLOWED_EMAIL", "owner@example.com");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sign-in callbackUrl · same-origin paths only", () => {
  it.each(["/brain?tab=memory", "/chat", "/decisions/12", "/chat?q=winter%20tires&view=list"])(
    "positive control: %s is honoured",
    async (cb) => {
      expect(await destination(cb)).toBe(cb);
    },
  );

  it.each([
    "/\\evil.com",
    "/%5Cevil.com",
    "/%5cevil.com",
    "//evil.com",
    "/\t/evil.com",
    "https://evil.com",
    "evil.com",
    "",
  ])("%j falls back instead of leaving the origin", async (cb) => {
    expect(await destination(cb)).toBe(FALLBACK);
  });
});
