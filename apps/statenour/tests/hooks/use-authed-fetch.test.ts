/**
 * tests/hooks/use-authed-fetch.test.ts — shouldRedirectOnAuthFail
 *
 * This tiny guard decides whether a 401 bounces the user to
 * /auth/sign-in. Getting it wrong = infinite redirect loop on
 * previews (sign-in cookie scoped to bdnick.info doesn't match
 * *.vercel.app) — which is exactly the bug these tests prevent.
 *
 * We don't carry jsdom as a dep, so we shim `globalThis.window` by
 * hand. That's enough for a pure-location read.
 */

import { describe, it, expect, afterEach } from "vitest";
import { shouldRedirectOnAuthFail } from "@/hooks/use-authed-fetch";

type WindowLike = { location: { hostname: string; pathname: string } };
const g = globalThis as unknown as { window?: WindowLike };

function setWindow(hostname: string, pathname: string) {
  g.window = { location: { hostname, pathname } };
}

function clearWindow() {
  delete g.window;
}

afterEach(() => {
  clearWindow();
});

describe("shouldRedirectOnAuthFail", () => {
  it("returns false during SSR (no window)", () => {
    clearWindow();
    expect(shouldRedirectOnAuthFail()).toBe(false);
  });

  it("returns false when already on /auth/sign-in (avoid infinite loop)", () => {
    setWindow("bdnick.info", "/auth/sign-in");
    expect(shouldRedirectOnAuthFail()).toBe(false);
  });

  it("returns false on any /auth/* subpath", () => {
    setWindow("bdnick.info", "/auth/callback");
    expect(shouldRedirectOnAuthFail()).toBe(false);
    setWindow("bdnick.info", "/auth/error");
    expect(shouldRedirectOnAuthFail()).toBe(false);
  });

  it("returns false on Vercel preview deploys (cookie domain mismatch)", () => {
    setWindow("statenour-os-abc123.vercel.app", "/chat");
    expect(shouldRedirectOnAuthFail()).toBe(false);
  });

  it("returns false on nested *.vercel.app paths", () => {
    setWindow("statenour-os-git-codex-ollama-local.vercel.app", "/settings");
    expect(shouldRedirectOnAuthFail()).toBe(false);
  });

  it("returns true on production bdnick.info", () => {
    setWindow("bdnick.info", "/chat");
    expect(shouldRedirectOnAuthFail()).toBe(true);
  });

  it("returns true on production HQ route", () => {
    setWindow("bdnick.info", "/");
    expect(shouldRedirectOnAuthFail()).toBe(true);
  });

  it("returns true on production with query string (location.pathname only)", () => {
    setWindow("bdnick.info", "/tasks");
    expect(shouldRedirectOnAuthFail()).toBe(true);
  });

  it("does NOT match hostname '.vercel.app' inside path", () => {
    // Prevents a false-positive: if someone somehow landed on
    // bdnick.info/.vercel.app-something, they should still redirect.
    setWindow("bdnick.info", "/.vercel.app-docs");
    expect(shouldRedirectOnAuthFail()).toBe(true);
  });
});
