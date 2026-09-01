/**
 * tests/security/middleware-boundary.test.ts · 2026-09-01 audit W-4 (P0) + W-5
 *
 * The SUBJECT of this file is the middleware's real allow/deny decision, not
 * the `isPublic()` helper. route-policy.test.ts is a good test of the
 * classifier and was structurally blind to the P0: it asserts
 * `isPublic("/missions") === false` — true — while middleware.ts separately
 * let any dotted path through one line later. A gate is only as wide as its
 * subject. This file imports `@/middleware` itself, with `@/auth` replaced by
 * an identity wrapper so the NextAuth runtime never loads under vitest, and
 * asserts what a request actually receives.
 *
 * Three things it proves, each with the shape that would have caught the bug:
 *   1. The exact production probes (`/decisions/1.2`, `/9.9`, `/abc.def`)
 *      are DENIED. They returned 200 unauthenticated on bdnick.info across
 *      three deploys (0e6d230, 04c55da, 5c1195e).
 *   2. EVERY page route under app/** is denied without a session — including
 *      a dotted-id variant of every dynamic segment — enumerated from the
 *      filesystem so a future `[slug]` route cannot ship un-gated. This is the
 *      guardian-registry-drift pattern ported onto the auth boundary: list the
 *      call sites, assert each one, never trust a hand-maintained list.
 *   3. EVERY file under public/ is still allowed (the inverse check), so the
 *      fix cannot quietly gate manifest.webmanifest / robots.txt and break the
 *      installed PWA.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { isPublic, isStaticFile } from "@/lib/security/route-policy";

// `export default auth(handler)` — with `auth` as identity, the default export
// IS the handler and `req.auth` is simply absent (no session).
vi.mock("@/auth", () => ({ auth: (handler: unknown) => handler }));

import middleware, { config as middlewareConfig } from "@/middleware";

// Next compiles `config.matcher` with its bundled path-to-regexp. Use THAT
// copy, with the options Next passes, so this test exercises the matcher the
// way production does rather than a hand-written approximation of it.
const { pathToRegexp } = createRequire(import.meta.url)("next/dist/compiled/path-to-regexp") as {
  pathToRegexp: (path: string, keys?: unknown[], options?: Record<string, unknown>) => RegExp;
};
const MATCHER = pathToRegexp(middlewareConfig.matcher[0], [], { delimiter: "/", sensitive: false, strict: false });
/** True iff Next would run the middleware for this path at all. */
const middlewareRuns = (path: string) => MATCHER.test(path);

type Decision = { status: number; location: string | null; next: string | null };

const run = middleware as unknown as (req: NextRequest) => Promise<Response> | Response;

async function decide(path: string): Promise<Decision> {
  const res = await run(new NextRequest(`https://bdnick.info${path}`));
  return {
    status: res.status,
    location: res.headers.get("location"),
    next: res.headers.get("x-middleware-next"),
  };
}

const denied = (d: Decision, path: string) =>
  d.status === 307 && (d.location ?? "").startsWith(`https://bdnick.info/auth/sign-in?callbackUrl=${encodeURIComponent(path)}`);
const allowed = (d: Decision) => d.status === 200 && d.next === "1";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** app/** page.tsx → URL paths, route groups stripped, dynamic segments filled. */
function pageRoutes(fill: string): string[] {
  const appDir = join(APP_ROOT, "app");
  return walk(appDir)
    .filter((f) => /[\\/]page\.tsx$/.test(f))
    .map((f) => {
      const segs = relative(appDir, dirname(f))
        .split(/[\\/]/)
        .filter((s) => s.length > 0 && !s.startsWith("("))
        .map((s) => (/^\[/.test(s) ? fill : s));
      return "/" + segs.join("/");
    });
}

// The middleware reads env per request: with the three auth vars present and
// neither dev bypass set, every branch converges on the session check —
// which is the boundary under test.
const ENV_KEYS = [
  "AUTH_SECRET",
  "AUTH_GOOGLE_CLIENT_ID",
  "AUTH_GOOGLE_CLIENT_SECRET",
  "AUTH_FORCE_MOCK",
  "LOCAL_DEV_BYPASS_AUTH",
] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.AUTH_SECRET = "test-secret";
  process.env.AUTH_GOOGLE_CLIENT_ID = "test-client-id";
  process.env.AUTH_GOOGLE_CLIENT_SECRET = "test-client-secret";
  delete process.env.AUTH_FORCE_MOCK;
  delete process.env.LOCAL_DEV_BYPASS_AUTH;
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("W-4 · the production probes are denied without a session", () => {
  it.each([
    "/decisions/1.2",
    "/decisions/9.9",
    "/decisions/abc.def",
    "/decisions/1.2.3",
    "/people/nour@example.com",
    // PR-review follow-up · an extension-suffixed page segment. These were
    // 200 on production because the MATCHER skipped the middleware for them;
    // the matcher half is asserted separately below, this is the function half.
    "/decisions/1.png",
    "/decisions/1.js",
    "/decisions/1.css",
    "/decisions/1.svg",
  ])(
    "%s → 307 to /auth/sign-in (was 200 on prod)",
    async (path) => {
      const d = await decide(path);
      expect(denied(d, path), `${path} got ${d.status} ${d.location ?? d.next ?? ""}`).toBe(true);
    },
  );

  it("control · the undotted page was always denied", async () => {
    for (const path of ["/decisions/1", "/missions", "/"]) {
      expect(denied(await decide(path), path), path).toBe(true);
    }
  });

  it("a dotted path under a private API prefix stays 401, never 200", async () => {
    const d = await decide("/api/system/diagnostics/x.json");
    expect(d.status).toBe(401);
  });
});

describe("config.matcher · the middleware RUNS for extension-suffixed page paths (PR-review follow-up)", () => {
  // The boundary test above calls the middleware function directly, so it is
  // blind to paths the matcher never routes to it. `/decisions/1.png` was
  // exactly that: 200 unauthenticated on production after the classifier fix,
  // because `.*\.(png|...)$` skipped the middleware for ANY nested path ending
  // in an asset extension. The exclusion is now root-level only.
  it.each(["/decisions/1.png", "/decisions/1.js", "/decisions/1.css", "/decisions/1.svg", "/decisions/1.2", "/manifest.webmanifest", "/robots.txt", "/missions"])(
    "%s → middleware runs",
    (path) => {
      expect(middlewareRuns(path), path).toBe(true);
    },
  );

  it.each(["/favicon.ico", "/favicon-32x32.png", "/sw.js", "/apple-touch-icon.png", "/_next/static/chunks/main.js", "/_next/image"])(
    "%s → skipped by the matcher (root-level asset or Next internal)",
    (path) => {
      expect(middlewareRuns(path), path).toBe(false);
    },
  );

  it("every page route with a .png-suffixed dynamic segment BOTH reaches the middleware AND is denied", async () => {
    const leaks: string[] = [];
    for (const path of pageRoutes("1.png")) {
      if (isPublic(path)) continue;
      if (!middlewareRuns(path)) {
        leaks.push(`${path} → matcher skips middleware`);
        continue;
      }
      const d = await decide(path);
      if (!denied(d, path)) leaks.push(`${path} → ${d.status} ${d.location ?? d.next ?? ""}`);
    }
    expect(leaks, `extension-suffixed page paths reachable without a session:\n${leaks.join("\n")}`).toEqual([]);
  });
});

describe("auth-boundary drift guard · every page route is denied without a session", () => {
  const plain = pageRoutes("1");
  const dotted = pageRoutes("1.2");

  it("discovers the page routes (sanity · 37 as of 5c1195e)", () => {
    expect(plain.length).toBeGreaterThanOrEqual(30);
    expect(dotted).toContain("/decisions/1.2");
  });

  it("denies every non-public page, plain AND dotted-id variants", async () => {
    const leaks: string[] = [];
    for (const path of [...new Set([...plain, ...dotted])]) {
      if (isPublic(path)) continue; // /auth/sign-in — public by policy, asserted by route-policy.test.ts
      const d = await decide(path);
      if (!denied(d, path)) leaks.push(`${path} → ${d.status} ${d.location ?? d.next ?? ""}`);
    }
    expect(leaks, `page routes reachable without a session:\n${leaks.join("\n")}`).toEqual([]);
  });
});

describe("inverse · every public/ file still passes the gate", () => {
  const publicDir = join(APP_ROOT, "public");
  const files = walk(publicDir).map((f) => "/" + relative(publicDir, f).split(/[\\/]/).join("/"));

  it("discovers the public files (sanity)", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(files).toContain("/manifest.webmanifest");
  });

  it("classifies every public/ file as a static file", () => {
    const gated = files.filter((p) => !isStaticFile(p));
    expect(
      gated,
      `public/ files the session gate would now block — add the extension to STATIC_FILE_RE or move the file to the root:\n${gated.join("\n")}`,
    ).toEqual([]);
  });

  it("lets the PWA + crawler metadata through without a session", async () => {
    for (const path of ["/manifest.webmanifest", "/robots.txt", "/manifest-mobile.json", "/install.html", "/api/version", "/auth/sign-in"]) {
      const d = await decide(path);
      expect(allowed(d), `${path} → ${d.status} ${d.location ?? ""}`).toBe(true);
    }
  });
});

describe("isStaticFile · the classifier is narrow on purpose", () => {
  it("accepts root-level files with an asset extension", () => {
    for (const p of ["/robots.txt", "/sw.js", "/favicon-32.png", "/manifest.webmanifest", "/site.webmanifest", "/ROBOTS.TXT"]) {
      expect(isStaticFile(p), p).toBe(true);
    }
  });

  it("rejects dotted page paths, nested paths, bare dots and /api", () => {
    for (const p of ["/decisions/1.2", "/decisions/1.json", "/icons/x.png", "/1.2", "/.env", "/x.", "/api/x.json", "/api/images/a.png"]) {
      expect(isStaticFile(p), p).toBe(false);
    }
  });
});
