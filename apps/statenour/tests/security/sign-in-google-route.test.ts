/**
 * tests/security/sign-in-google-route.test.ts · bug hunt 2026-10-22.
 *
 * Sentry JAVASCRIPT-REACT-Z (28 events, POST /auth/sign-in/page, Safari): the
 * sign-in button was an inline Server Action. A tab opened on an older build
 * posts an action id the new image does not have, or (no JS) a plain multipart
 * POST with no id at all; Next throws "Failed to find Server Action" on the
 * server, where no client-side deploy-skew reload can see it.
 *
 * The button is now a plain `<form method="post">` to this route handler
 * (form markup: sign-in-form-no-js.test.tsx). There is no action id to skew.
 * The handler keeps what the Server Action gave for free: a same-origin check
 * on the POST, and the same callbackUrl gate as the page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const GOOGLE = "https://accounts.google.com/o/oauth2/v2/auth?client_id=x";

const { signIn } = vi.hoisted(() => ({
  signIn: vi.fn(async (..._args: unknown[]) => GOOGLE),
}));
vi.mock("@/auth", () => ({ signIn }));

import { POST } from "@/app/auth/sign-in/google/route";

const SAME_SITE = { origin: "https://bdnick.info", host: "bdnick.info" };

function post(callbackUrl: string | null, headers: Record<string, string> = SAME_SITE) {
  const body = new FormData();
  if (callbackUrl !== null) body.set("callbackUrl", callbackUrl);
  return new Request("https://bdnick.info/auth/sign-in/google", { method: "POST", body, headers });
}

beforeEach(() => {
  signIn.mockClear();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /auth/sign-in/google", () => {
  it("starts Google sign-in for a same-origin callbackUrl and sends the browser there with a 303", async () => {
    const res = await POST(post("/brain?tab=memory"));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(signIn).toHaveBeenCalledWith("google", { redirectTo: "/brain?tab=memory", redirect: false });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(GOOGLE);
  });

  it.each(["https://evil.com", "//evil.com", "/\\evil.com", "/%5Cevil.com", ""])(
    "%j falls back to the page's default instead of leaving the origin",
    async (cb) => {
      await POST(post(cb));
      expect(signIn).toHaveBeenCalledWith("google", { redirectTo: "/chat", redirect: false });
    },
  );

  it("a missing callbackUrl field falls back too", async () => {
    await POST(post(null));
    expect(signIn).toHaveBeenCalledWith("google", { redirectTo: "/chat", redirect: false });
  });

  it("refuses a cross-site POST (the origin check the Server Action used to do)", async () => {
    const res = await POST(post("/chat", { origin: "https://evil.com", host: "bdnick.info" }));
    expect(res.status).toBe(403);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("CONTROL: the proxy's forwarded host counts as same-origin", async () => {
    const res = await POST(
      post("/chat", { origin: "https://bdnick.info", host: "10.0.0.5:3000", "x-forwarded-host": "bdnick.info" }),
    );
    expect(res.status).toBe(303);
  });
});
