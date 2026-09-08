/**
 * tests/repo/private-discovery.test.ts · 2026-09-07
 *
 * bdnick.info is an owner-only application. Its discovery posture has THREE
 * layers and this file pins all of them against the real config, not prose:
 *
 *   1. robots.txt disallows everything (app/robots.ts) — keeps well-behaved
 *      crawlers from enumerating paths;
 *   2. `X-Robots-Tag: noindex…` on every response (next.config.ts) — Google
 *      documents that a robots-blocked URL can still be listed by URL alone
 *      when linked from elsewhere, and the user-triggered AI fetchers
 *      (ChatGPT-User, Perplexity-User, Google-Agent, meta-externalfetcher,
 *      Amzn-User) document that they ignore robots.txt;
 *   3. the sign-in page — the ONLY 200 an anonymous visitor ever receives —
 *      declares `robots: { index: false }` in its metadata.
 *
 * None of these is access control; middleware.ts is. They only keep the
 * login URL out of indexes. Values are asserted, never mentions: a comment
 * quoting "noindex" must not satisfy this.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// next.config wraps itself in withSentryConfig. This test is about the
// headers the config declares, not about Sentry, and on a checkout whose
// node_modules predate @sentry/nextjs the real import cannot resolve at all
// — so the wrapper is replaced with identity here.
vi.mock("@sentry/nextjs/config", () => ({ withSentryConfig: (config: unknown) => config }));
vi.mock("@next/bundle-analyzer", () => ({ default: () => (config: unknown) => config }));

import nextConfig from "../../next.config";
import robots from "@/app/robots";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

describe("private discovery posture", () => {
  it("robots.txt disallows the whole domain for every user agent", () => {
    const rules = ([] as Array<{ userAgent?: string | string[]; disallow?: string | string[] }>).concat(
      (robots() as { rules: unknown }).rules as never,
    );
    const catchAll = rules.find((r) => r.userAgent === "*" || (Array.isArray(r.userAgent) && r.userAgent.includes("*")));
    expect(catchAll, "a `*` rule must exist").toBeTruthy();
    const disallow = ([] as string[]).concat(catchAll!.disallow ?? []);
    expect(disallow).toContain("/");
  });

  it("every response carries X-Robots-Tag with noindex + nofollow", async () => {
    const groups = await nextConfig.headers!();
    const global = groups.find((g) => g.source === "/:path*");
    expect(global, "the global header group must exist").toBeTruthy();
    const tag = global!.headers.find((h) => h.key.toLowerCase() === "x-robots-tag");
    expect(tag, "X-Robots-Tag must be set on /:path*").toBeTruthy();
    const directives = tag!.value.split(",").map((d) => d.trim().toLowerCase());
    expect(directives).toContain("noindex");
    expect(directives).toContain("nofollow");
  });

  it("the sign-in page metadata refuses indexing", () => {
    const page = stripComments(readFileSync(resolve(APP_ROOT, "app/auth/sign-in/page.tsx"), "utf8"));
    const metadataBlock = page.match(/export const metadata[^=]*=\s*\{([\s\S]*?)\n\};/);
    expect(metadataBlock, "sign-in must export metadata").toBeTruthy();
    expect(metadataBlock![1]).toMatch(/robots\s*:\s*\{[^}]*\bindex\s*:\s*false/);
  });

  it("positive control: the same header group still carries the security headers it always did", async () => {
    const groups = await nextConfig.headers!();
    const keys = groups.find((g) => g.source === "/:path*")!.headers.map((h) => h.key);
    for (const k of ["X-Frame-Options", "X-Content-Type-Options", "Strict-Transport-Security", "Permissions-Policy"]) {
      expect(keys).toContain(k);
    }
  });
});

describe("HSTS is preload-ready (2026-09-08)", () => {
  it("declares two years, subdomains and preload on every route", async () => {
    const headers = await (nextConfig as { headers?: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>> }).headers!();
    const hsts = headers.flatMap((h) => h.headers).find((h) => h.key === "Strict-Transport-Security");
    expect(hsts, "no HSTS header declared").toBeTruthy();
    expect(hsts!.value).toMatch(/max-age=(\d+)/);
    expect(Number(/max-age=(\d+)/.exec(hsts!.value)![1])).toBeGreaterThanOrEqual(31536000 * 2);
    expect(hsts!.value).toContain("includeSubDomains");
    expect(hsts!.value).toContain("preload");
  });
});
