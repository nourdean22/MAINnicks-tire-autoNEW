/**
 * The sign-in button is a plain HTML form POST (bug hunt 2026-10-22, Sentry
 * JAVASCRIPT-REACT-Z). An inline Server Action renders as a form whose submit
 * needs React and a live action id; a tab left open across a deploy, or Safari
 * posting before hydration, hit "Failed to find Server Action". The rendered
 * markup must post to /auth/sign-in/google with the callbackUrl in the body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/auth", () => ({ signIn: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getAuthRuntimeMode: () => "google",
  getOperatorSession: async () => null,
}));
vi.mock("@/components/ui/glass-card", () => ({ GlassCard: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, type }: { children: ReactNode; type?: "submit" }) => <button type={type}>{children}</button>,
}));

import SignInPage from "@/app/auth/sign-in/page";

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_APP_URL", ""));
afterEach(() => vi.unstubAllEnvs());

const render = async (callbackUrl: string) =>
  renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({ callbackUrl }) }));

describe("sign-in form · no JavaScript, no action id", () => {
  it("posts a plain form to /auth/sign-in/google carrying the callbackUrl", async () => {
    const html = await render("/missions");
    const form = html.match(/<form[^>]*>/)?.[0] ?? "";
    expect(form).toContain('method="post"');
    expect(form).toContain('action="/auth/sign-in/google"');
    expect(html).toContain('<input type="hidden" name="callbackUrl" value="/missions"/>');
    expect(html).toContain('<button type="submit">Continue with Google</button>');
  });

  it("an off-origin callbackUrl never reaches the form", async () => {
    const html = await render("https://evil.com");
    expect(html).not.toContain("evil.com");
    expect(html).toContain('name="callbackUrl" value="/chat"');
  });
});
