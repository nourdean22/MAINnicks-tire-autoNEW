/**
 * tests/redteam/route-auth.redteam.test.ts · red-team of request-routing auth (wave 1, PR #2981).
 *
 * SUBJECT: the real code path, end to end, never a reading of a regex.
 *   - proxy.ts default export (the NextAuth-wrapped middleware) with @/auth as an identity
 *     wrapper, so `req.auth` is exactly what the test sets: absent = no session.
 *   - config.matcher compiled with Next's own bundled path-to-regexp (what decides whether
 *     the proxy runs at all).
 *   - lib/security/route-policy.ts isPublic / underPrefix / PUBLIC_PREFIXES / PUBLIC_EXACT.
 *   - app/api/cron/mega GET, app/api/sync/events POST, app/api/sync/queue POST,
 *     app/api/sync/queue/render-complete POST, each through the REAL apiHandler and the REAL
 *     lib/auth-guard (the suite-wide setup file mocks auth-guard to a no-op; this file
 *     restores the actual module, and the positive controls below prove it did).
 *   - app/auth/sign-in/page.tsx (the callbackUrl gate), fed both raw inputs and the
 *     callbackUrl the proxy itself generates.
 *
 * Only runtime deps are replaced: Prisma (an in-memory store that honours the WHERE
 * filters these routes use), the cron fan-out runner, and the sign-in page's NextAuth /
 * session / redirect / UI imports.
 *
 * Verified bypasses are `it(...)`: they assert the CORRECT behaviour and pass only
 * while the bug is present. When a fix lands, vitest reports them as failing; delete the
 * `.fails` and they become permanent deny examples.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createRequire } from "node:module";

// ── secrets: set BEFORE any import, because lib/auth-guard reads them at module load ──
const SECRETS = vi.hoisted(() => {
  const saved = {
    CRON_SECRET: process.env.CRON_SECRET,
    STATENOUR_SYNC_KEY: process.env.STATENOUR_SYNC_KEY,
  };
  const CRON = "redteam-cron-secret-0123456789";
  const SYNC = "redteam-sync-key-0123456789";
  process.env.CRON_SECRET = CRON;
  process.env.STATENOUR_SYNC_KEY = SYNC;
  return { CRON, SYNC, saved };
});

// ── in-memory social_publish_queue that honours the filters the routes send ──
const db = vi.hoisted(() => {
  type Row = Record<string, any> & { id: string; status: string };
  const rows = new Map<string, Row>();
  // Every operator in one condition must hold (Prisma ANDs them); an unknown one never matches.
  const matches = (row: Row, where: Record<string, any>): boolean =>
    Object.entries(where).every(([k, cond]) => {
      if (k === "OR") return (cond as Record<string, any>[]).some((w) => matches(row, w));
      const v = row[k] ?? null;
      if (cond === null) return v === null;
      if (cond && typeof cond === "object" && !(cond instanceof Date)) {
        return Object.entries(cond).every(([op, x]: [string, any]) => {
          if (op === "notIn") return !x.includes(v);
          if (op === "in") return x.includes(v);
          if (op === "not") return x === null ? v !== null : v !== x;
          if (op === "lt") return v !== null && v < x;
          if (op === "gte") return v !== null && v >= x;
          return false;
        });
      }
      return v === cond;
    });
  const apply = (r: Row, data: Record<string, any>): Row => {
    const next: Row = { ...r };
    for (const [k, x] of Object.entries(data)) {
      next[k] = x && typeof x === "object" && "increment" in x ? (r[k] ?? 0) + x.increment : x;
    }
    return next;
  };
  const now = () => new Date("2026-10-10T12:00:00.000Z");
  const socialPublishQueue = {
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const existing = rows.get(where.id);
      if (existing && matches(existing, where)) {
        const next = { ...existing, ...update };
        rows.set(where.id, next);
        return next;
      }
      if (existing) throw Object.assign(new Error("Unique constraint failed on the fields: (`id`)"), { code: "P2002" });
      const row = { deletedAt: null, createdAt: now(), updatedAt: now(), ...create };
      rows.set(where.id, row);
      return row;
    }),
    findUnique: vi.fn(async ({ where }: any) => rows.get(where.id) ?? null),
    findFirst: vi.fn(async ({ where }: any) => [...rows.values()].find((r) => matches(r, where)) ?? null),
    update: vi.fn(async ({ where, data }: any) => {
      const r = rows.get(where.id);
      if (!r || !matches(r, where)) throw Object.assign(new Error("Record to update not found."), { code: "P2025" });
      const next = apply(r, data);
      rows.set(where.id, next);
      return next;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const [id, r] of rows) {
        if (matches(r, where)) {
          rows.set(id, apply(r, data));
          count++;
        }
      }
      return { count };
    }),
  };
  return { rows, socialPublishQueue, now };
});

const fanout = vi.hoisted(() => ({
  withConcurrency: vi.fn(async () => [] as unknown[]),
  cronJobLogCreate: vi.fn(async () => ({})),
}));

const page = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));

// identity wrapper: `export default auth(handler)` IS the handler; `auth()` (no session) is null
vi.mock("@/auth", () => ({
  auth: (h?: unknown) => (typeof h === "function" ? h : null),
  authEnabled: true,
  signIn: vi.fn(),
  handlers: {},
}));
// undo tests/setup/auth-guard-mock.ts for THIS file: the guard under test is the real one
vi.mock("@/lib/auth-guard", async () => await vi.importActual<typeof import("@/lib/auth-guard")>("@/lib/auth-guard"));
vi.mock("@/lib/prisma", () => {
  const prisma: Record<string, any> = {
    socialPublishQueue: db.socialPublishQueue,
    auditEvent: { create: vi.fn(async () => ({ id: "aud_1" })), findMany: vi.fn(async () => []) },
    apiRequestLog: { create: vi.fn(async () => ({})) },
    errorLog: { create: vi.fn(async () => ({})) },
    cronJobLog: { create: fanout.cronJobLogCreate },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma, resetQueryCount: vi.fn(), getQueryCount: vi.fn(() => 0) };
});
vi.mock("@/lib/utils/concurrent", () => ({ withConcurrency: fanout.withConcurrency }));
vi.mock("@/lib/services/coach-events", () => ({ recordCoachEvent: vi.fn(async () => null) }));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitDriftFired: vi.fn() }));
vi.mock("@/lib/brain/pipeline-controller", () => ({ processShopEvent: vi.fn(async () => ({})) }));
vi.mock("next/navigation", () => ({ redirect: page.redirect }));
vi.mock("@/lib/auth", () => ({
  getAuthRuntimeMode: () => "google",
  getOperatorSession: async () => ({ email: "owner@example.com" }),
}));
vi.mock("@/components/ui/glass-card", () => ({ GlassCard: () => null }));
vi.mock("@/components/ui/button", () => ({ Button: () => null }));

import proxy, { config as proxyConfig } from "@/proxy";
import { isPublic, PUBLIC_EXACT, PUBLIC_PREFIXES } from "@/lib/security/route-policy";
import { requireCronAuth, requireSyncAuth } from "@/lib/auth-guard";
import { GET as megaGET } from "@/app/api/cron/mega/route";
import { POST as syncEventsPOST } from "@/app/api/sync/events/route";
import { POST as syncQueuePOST } from "@/app/api/sync/queue/route";
import { POST as renderCompletePOST } from "@/app/api/sync/queue/render-complete/route";
import { GET as renderLeaseGET } from "@/app/api/sync/queue/render/route";
import SignInPage from "@/app/auth/sign-in/page";

const ORIGIN = "https://bdnick.info";
const FALLBACK = "/chat";

// ── harness: the proxy's real decision ──────────────────────────────────────
type Decision = { status: number; location: string | null; next: string | null; body: string };
const runProxy = proxy as unknown as (req: NextRequest) => Promise<Response> | Response;

async function decide(path: string, sessionEmail?: string): Promise<Decision> {
  const req = new NextRequest(`${ORIGIN}${path}`);
  if (sessionEmail) (req as unknown as { auth: unknown }).auth = { user: { email: sessionEmail } };
  const res = await runProxy(req);
  return {
    status: res.status,
    location: res.headers.get("location"),
    next: res.headers.get("x-middleware-next"),
    body: res.status === 401 || res.status === 500 ? await res.text() : "",
  };
}
type Verdict = "allow" | "401" | "signin" | "lockdown" | "other";
function verdictOf(d: Decision): Verdict {
  if (d.status === 200 && d.next === "1") return "allow";
  if (d.status === 401 && d.body.includes('"Unauthorized"')) return "401";
  if (d.status === 500 && d.body.includes("SYSTEM LOCKED")) return "lockdown";
  if (d.status === 307 && (d.location ?? "").startsWith(`${ORIGIN}/auth/sign-in?callbackUrl=`)) return "signin";
  return "other";
}
const describeD = (d: Decision) => `${d.status} ${d.location ?? d.next ?? ""} ${d.body}`.trim();
const callbackOf = (d: Decision) => new URL(d.location ?? "http://none").searchParams.get("callbackUrl");

// Next compiles `config.matcher` with its bundled path-to-regexp and these options.
const { pathToRegexp } = createRequire(import.meta.url)("next/dist/compiled/path-to-regexp") as {
  pathToRegexp: (path: string, keys?: unknown[], options?: Record<string, unknown>) => RegExp;
};
const MATCHER = pathToRegexp(proxyConfig.matcher[0], [], { delimiter: "/", sensitive: false, strict: false });
const proxyRuns = (path: string) => MATCHER.test(path);

// ── harness: the sign-in page's real redirect target ─────────────────────────
async function signInDestination(callbackUrl: string): Promise<string> {
  page.redirect.mockClear();
  await SignInPage({ searchParams: Promise.resolve({ callbackUrl }) }).catch(() => undefined);
  expect(page.redirect, `no redirect for ${JSON.stringify(callbackUrl)}`).toHaveBeenCalledTimes(1);
  return page.redirect.mock.calls[0][0] as string;
}
/** Where a BROWSER lands for this redirect target (WHATWG resolution, same parser browsers use). */
const browserOrigin = (target: string) => new URL(target, `${ORIGIN}/auth/sign-in?callbackUrl=x`).origin;

// ── harness: bridge + cron calls ─────────────────────────────────────────────
async function callJson(handler: (req: Request, ctx: never) => Promise<Response>, path: string, body: unknown, headers: Record<string, string>) {
  const res = await handler(
    new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    {} as never,
  );
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}
const BRIDGE = { authorization: `Bearer ${SECRETS.SYNC}` };
const draftEvent = (data: Record<string, unknown>) => ({
  type: "nickstire:social_draft:sync",
  timestamp: "2026-10-10T12:00:00.000Z",
  source: "nickstire",
  data,
});
const sendDraft = (data: Record<string, unknown>, headers: Record<string, string> = BRIDGE) =>
  callJson(syncEventsPOST as never, "/api/sync/events", draftEvent(data), headers);

function mega(headers: Record<string, string> = {}, query = "slot=morning") {
  return megaGET(new NextRequest(`${ORIGIN}/api/cron/mega?${query}`, { headers }));
}

const AUTH_ENV = ["AUTH_SECRET", "AUTH_GOOGLE_CLIENT_ID", "AUTH_GOOGLE_CLIENT_SECRET"] as const;

beforeEach(() => {
  for (const k of AUTH_ENV) vi.stubEnv(k, `test-${k}`);
  vi.stubEnv("AUTH_FORCE_MOCK", "");
  vi.stubEnv("LOCAL_DEV_BYPASS_AUTH", "");
  vi.stubEnv("CRON_SECRET", SECRETS.CRON);
  vi.stubEnv("STATENOUR_SYNC_KEY", SECRETS.SYNC);
  vi.stubEnv("APP_BASE_URL", "http://fanout.invalid");
  vi.stubEnv("AUTH_ALLOWED_EMAIL", "owner@example.com");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("no network in red-team tests");
    }),
  );
  db.rows.clear();
  fanout.withConcurrency.mockClear();
  fanout.cronJobLogCreate.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterAll(() => {
  for (const [k, v] of Object.entries(SECRETS.saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ═════════════════════════════════════════════════════════════════════════════
describe("positive controls · the instruments fire", () => {
  it("proxy DENIES a private API path without a session (401 Unauthorized)", async () => {
    const d = await decide("/api/system/diagnostics");
    expect(verdictOf(d), describeD(d)).toBe("401");
  });

  it("proxy DENIES a private page without a session (307 to /auth/sign-in with callbackUrl)", async () => {
    const d = await decide("/missions");
    expect(verdictOf(d), describeD(d)).toBe("signin");
    expect(callbackOf(d)).toBe("/missions");
  });

  it("proxy ALLOWS the same private paths WITH a session (the deny above is the session gate)", async () => {
    expect(verdictOf(await decide("/api/system/diagnostics", "owner@example.com"))).toBe("allow");
    expect(verdictOf(await decide("/missions", "owner@example.com"))).toBe("allow");
  });

  it("the REAL requireSyncAuth is loaded (the suite-wide no-op mock is undone): a wrong key is 401", async () => {
    const r = await sendDraft({ id: "pc1", content: "x", status: "pending" }, { authorization: "Bearer wrong-key" });
    expect(r.status).toBe(401);
    expect(r.json.error ?? r.json).toMatch(/Unauthorized/);
    expect(db.rows.has("pc1")).toBe(false);
    expect(() => requireSyncAuth(new Request(ORIGIN, { headers: { "x-sync-key": "nope" } }))).toThrow("Unauthorized");
  });

  it("the REAL requireSyncAuth accepts the bridge key (Bearer and x-sync-key)", async () => {
    expect((await sendDraft({ id: "pc2", content: "x", status: "pending" })).status).toBe(200);
    expect((await sendDraft({ id: "pc3", content: "x", status: "pending" }, { "x-sync-key": SECRETS.SYNC })).status).toBe(200);
    expect(db.rows.get("pc2")?.status).toBe("pending");
  });

  it("/api/cron/mega fans out on Bearer CRON_SECRET (so every 401 below is the gate, not a dead route)", async () => {
    const res = await mega({ authorization: `Bearer ${SECRETS.CRON}` });
    expect(res.status).toBe(200);
    expect(fanout.withConcurrency).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("route policy · public prefixes never swallow a private sibling (real proxy decision)", () => {
  // Each of these shares a public entry's spelling or sits beside it; none is public.
  const siblings: Array<[string, Verdict]> = [
    ["/api/brainstorm", "401"],
    ["/api/brain-admin", "401"],
    ["/api/sync-admin", "401"],
    ["/api/syncx/events", "401"],
    ["/api/cronjobs", "401"],
    ["/api/cron-admin/mega", "401"],
    ["/api/authz", "401"],
    ["/api/authorize", "401"],
    ["/api/webhooks-admin", "401"],
    ["/api/telegramx", "401"],
    ["/api/imagesx/1", "401"],
    ["/api/inngestx", "401"],
    ["/api/mcpx", "401"],
    ["/api/devicesx", "401"],
    ["/api/nour-osx", "401"],
    ["/api/short", "401"], // owner-gated collection: only /api/short/<code> is public
    ["/api/shortlinks", "401"],
    ["/api/actions", "401"],
    ["/api/actions-brain", "401"],
    ["/api/internal/runner", "401"],
    ["/api/internal/runnerx", "401"],
    ["/api/internal/runners/claim", "401"],
    ["/api/health", "401"],
    ["/api/health/governor/today", "401"],
    ["/api/health/summaryx", "401"],
    ["/api/integrations", "401"],
    ["/api/integrations/research", "401"],
    ["/api/integrations/apple-healthx", "401"],
    ["/api/versions", "401"],
    ["/api/version/x", "401"],
    ["/api/version.json", "401"],
    ["/api/system/heartbeatx", "401"],
    ["/api/system/heartbeat/x", "401"],
    ["/api/system/healthz", "401"],
    ["/api/system/health/x", "401"],
    ["/api/system/observability-probe/x", "401"],
    ["/authz", "signin"],
    ["/author/x", "signin"],
    ["/_nextx/secret", "signin"],
    ["/faviconx", "signin"],
  ];
  it.each(siblings)("%s → %s", async (path, want) => {
    expect(isPublic(path), `isPublic(${path})`).toBe(false);
    const d = await decide(path);
    expect(verdictOf(d), `${path}: ${describeD(d)}`).toBe(want);
  });

  it("every PUBLIC_EXACT entry is exact: a child and a suffix of each are gated", async () => {
    for (const exact of PUBLIC_EXACT) {
      for (const path of [`${exact}/x`, `${exact}x`]) {
        expect(isPublic(path), path).toBe(false);
        expect(verdictOf(await decide(path)), path).toBe("401");
      }
    }
  });

  it("every bare PUBLIC_PREFIXES entry stops at a path boundary (dash, dot, underscore and digit suffixes)", async () => {
    for (const prefix of PUBLIC_PREFIXES.filter((p) => !p.endsWith("/"))) {
      for (const suffix of ["-x", ".x", "_x", "2", "%2F"]) {
        const path = `${prefix}${suffix}`;
        expect(isPublic(path), path).toBe(false);
        const v = verdictOf(await decide(path));
        expect(v === "401" || v === "signin", `${path} → ${v}`).toBe(true);
      }
    }
  });
});

describe("route policy · path-shape tricks resolve to the gated route, never a public one", () => {
  // The URL parser the proxy reads (WHATWG, via NextRequest) normalises dot segments,
  // including %2e forms, and backslashes, BEFORE isPublic sees the path.
  const tricks: Array<[string, Verdict]> = [
    ["/api/cron/../system/diagnostics", "401"],
    ["/api/cron/%2e%2e/system/diagnostics", "401"],
    ["/api/cron/.%2E/system/diagnostics", "401"],
    ["/api/brain/x/../../system/diagnostics", "401"],
    ["/api/short/../system/diagnostics", "401"],
    ["/api/actions/./../system/diagnostics", "401"],
    ["/api/cron\\..\\system\\diagnostics", "401"],
    ["/api/cron;/../system/diagnostics", "401"],
    ["/api/cron%00/../system/diagnostics", "401"],
    ["/api/system/diagnostics?p=/api/cron/", "401"],
    ["/api/system/diagnostics?/api/sync", "401"],
    ["/api/system/diagnostics;/api/cron", "401"],
    ["/api/system/diagnostics#/api/cron", "401"],
    ["/api/cron%2Fmega", "401"], // encoded separator is NOT a boundary: denied, never widened
    ["/api%2Fcron/mega", "signin"],
    ["/api/brain%2F..%2Fsystem", "401"],
    ["/api/ｃron/mega", "401"], // fullwidth c
    ["/API/cron/mega", "signin"], // case: not the public prefix
    ["/api/CRON/mega", "401"],
    ["/api/Brain/x", "401"],
    ["//api/system/diagnostics", "signin"],
    ["/api//cron/mega", "401"],
    ["/x.json/../api/system/diagnostics", "401"],
    ["/missions?x=/auth/sign-in", "signin"],
    ["/auth/../missions", "signin"],
    ["/auth/%2e%2e/missions", "signin"],
  ];
  it.each(tricks)("%s → %s", async (path, want) => {
    const d = await decide(path);
    expect(verdictOf(d), `${path}: ${describeD(d)}`).toBe(want);
  });
});

describe("route policy · legitimate callers still pass (false-positive guard)", () => {
  const legit = [
    "/api/cron/mega",
    "/api/cron/mega?slot=evening",
    "/api/cron/mega/",
    "/api/cron",
    "/api/sync/events",
    "/api/sync/queue/render-complete",
    "/api/brain/by-url",
    "/api/short/abc123",
    "/api/actions/openapi",
    "/api/actions/remember",
    "/api/internal/runner/claim",
    "/api/health/summary",
    "/api/integrations/apple-health/v1/hae",
    "/api/version",
    "/api/system/heartbeat",
    "/api/system/heartbeat?probe=uptime",
    "/api/system/health",
    "/api/system/observability-probe",
    "/api/auth/session",
    "/api/auth/callback/google?code=x&state=y",
    "/api/webhooks/stripe",
    "/api/inngest",
    "/api/mcp",
    "/api/devices/queue",
    "/api/nour-os/query",
    "/api/telegram/webhook",
    "/api/images/abc",
    "/auth/sign-in",
    "/auth/sign-in?callbackUrl=%2Fbrain%3Ftab%3Dmemory",
    "/api/cr\ton/mega", // the parser strips the tab: it IS /api/cron/mega
    "/manifest.webmanifest",
    "/robots.txt",
  ];
  it.each(legit)("%s → allow", async (path) => {
    const d = await decide(path);
    expect(verdictOf(d), `${path}: ${describeD(d)}`).toBe("allow");
  });
});

describe("proxy env branches · production ignores the dev bypass flags", () => {
  it("NODE_ENV=production + LOCAL_DEV_BYPASS_AUTH=1 + AUTH_FORCE_MOCK=1 → still 401 / sign-in", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOCAL_DEV_BYPASS_AUTH", "1");
    vi.stubEnv("AUTH_FORCE_MOCK", "1");
    expect(verdictOf(await decide("/api/system/diagnostics"))).toBe("401");
    expect(verdictOf(await decide("/missions"))).toBe("signin");
  });

  it("NODE_ENV=production with an auth var missing → lockdown for private paths; self-authed public paths still reach their own auth", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_GOOGLE_CLIENT_SECRET", "");
    expect(verdictOf(await decide("/api/system/diagnostics"))).toBe("lockdown");
    expect(verdictOf(await decide("/missions"))).toBe("lockdown");
    expect(verdictOf(await decide("/api/cron/mega"))).toBe("allow");
    // and the route's own gate still holds behind that allow
    const res = await mega({ authorization: `Bearer ${SECRETS.SYNC}` });
    expect(res.status).toBe(401);
  });
});

describe("config.matcher · which paths skip the proxy entirely (no auth, no CSP)", () => {
  it.each(["/favicon.ico", "/sw.js", "/apple-touch-icon.png", "/_next/static/chunks/main.js", "/_next/image"])(
    "control: %s is skipped (root-level asset or Next internal)",
    (path) => {
      expect(proxyRuns(path), path).toBe(false);
    },
  );

  it.each(["/api/cron/mega", "/api/system/diagnostics", "/missions", "/decisions/1.png", "/api/images/a.png", "/robots.txt"])(
    "control: %s runs the proxy",
    (path) => {
      expect(proxyRuns(path), path).toBe(true);
    },
  );

  // FIXED (was latent P3) · the lookahead `favicon.ico` was an UNESCAPED, UNANCHORED regex:
  // `.` matched any char and nothing pinned the end, so any path starting favicon<any>ico
  // skipped the proxy (no session check, no CSP). Now `favicon\.ico$`, like the asset arm.
  it.each(["/faviconXico/private", "/favicon.ico/private", "/favicon-icons", "/favicon.icoX", "/favicon.ico/"])(
    "%s should run the proxy (only the exact /favicon.ico may skip it)",
    (path) => {
      expect(proxyRuns(path), path).toBe(true);
    },
  );
});

// ═════════════════════════════════════════════════════════════════════════════
describe("callbackUrl · the proxy's re-auth link → the sign-in page's redirect (end to end)", () => {
  it("chain: /brain?tab=memory survives proxy → sign-in → redirect", async () => {
    const d = await decide("/brain?tab=memory");
    expect(verdictOf(d)).toBe("signin");
    expect(await signInDestination(callbackOf(d)!)).toBe("/brain?tab=memory");
  });

  it("chain: a percent-encoded path is not double-decoded or double-encoded", async () => {
    const d = await decide("/people/nour%40example.com?view=a%2Fb");
    const cb = callbackOf(d)!;
    expect(cb).toBe("/people/nour%40example.com?view=a%2Fb");
    expect(await signInDestination(cb)).toBe(cb);
  });

  it.each(["//evil.com", "/\\evil.com", "//evil.com/%2e%2e", "/%5Cevil.com", "/%2F%2Fevil.com", "/.//evil.com"])(
    "chain: request path %j → the 307 stays on bdnick.info AND the page never sends the browser off-origin",
    async (path) => {
      const d = await decide(path);
      expect(verdictOf(d), describeD(d)).toBe("signin");
      expect(new URL(d.location!).origin).toBe(ORIGIN);
      const dest = await signInDestination(callbackOf(d)!);
      expect(browserOrigin(dest), `${path} → callbackUrl ${callbackOf(d)} → ${dest}`).toBe(ORIGIN);
    },
  );

  it.each([
    "//evil.com",
    "///evil.com",
    "/\\evil.com",
    "/\\/evil.com",
    "\\\\evil.com",
    "/%5Cevil.com",
    "/%5cevil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r\n/evil.com",
    "/\t\\evil.com",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(document.domain)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https://evil.com",
    "https:evil.com",
    "https://bdnick.info.evil.com/",
    "https://bdnick.info@evil.com/",
    "evil.com",
    "%2F%2Fevil.com",
    "%2F%5Cevil.com",
    "",
  ])("hostile callbackUrl %j → fallback, never followed", async (cb) => {
    expect(await signInDestination(cb)).toBe(FALLBACK);
  });

  it.each(["/.//evil.com", "/%2e%2e//evil.com", "/%2F%2Fevil.com", "/%255Cevil.com", "/javascript:alert(1)", "/https://evil.com", "/ /evil.com"])(
    "odd-but-same-origin callbackUrl %j: whatever the page does, a browser resolving it stays on bdnick.info",
    async (cb) => {
      const dest = await signInDestination(cb);
      expect(browserOrigin(dest), `${cb} → ${dest}`).toBe(ORIGIN);
    },
  );

  it.each(["/brain?tab=memory", "/chat", "/decisions/12", "/people/nour%40example.com", "/chat?q=a%2Fb&view=list"])(
    "legitimate deep link %s is honoured exactly (false-positive guard)",
    async (cb) => {
      expect(await signInDestination(cb)).toBe(cb);
    },
  );
});

// ═════════════════════════════════════════════════════════════════════════════
describe("/api/cron/mega · CRON_SECRET only", () => {
  it("anonymous: the proxy lets it through to the route, and the route refuses (chain)", async () => {
    expect(verdictOf(await decide("/api/cron/mega?slot=morning"))).toBe("allow");
    expect((await mega()).status).toBe(401);
    expect(fanout.withConcurrency).not.toHaveBeenCalled();
  });

  const refused: Array<[string, Record<string, string>, string?]> = [
    ["Bearer <sync key>", { authorization: `Bearer ${SECRETS.SYNC}` }],
    ["x-sync-key: <sync key>", { "x-sync-key": SECRETS.SYNC }],
    ["bare <cron secret> (no Bearer)", { authorization: SECRETS.CRON }],
    ["lowercase bearer", { authorization: `bearer ${SECRETS.CRON}` }],
    ["double space", { authorization: `Bearer  ${SECRETS.CRON}` }],
    ["Basic scheme", { authorization: `Basic ${Buffer.from(`x:${SECRETS.CRON}`).toString("base64")}` }],
    ["sync key then cron secret in one header", { authorization: `Bearer ${SECRETS.SYNC}, Bearer ${SECRETS.CRON}` }],
    ["cron secret as a prefix", { authorization: `Bearer ${SECRETS.CRON}x` }],
    ["cron secret truncated", { authorization: `Bearer ${SECRETS.CRON.slice(0, -1)}` }],
    ["x-vercel-cron spoof", { "x-vercel-cron": "1" }],
    ["secret in the query string only", {}, `slot=morning&secret=${SECRETS.CRON}&token=${SECRETS.CRON}`],
  ];
  it.each(refused)("%s → 401, nothing fans out", async (_label, headers, query) => {
    const res = await mega(headers, query);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(fanout.withConcurrency).not.toHaveBeenCalled();
    expect(fanout.cronJobLogCreate).not.toHaveBeenCalled();
  });

  it("CRON_SECRET unset: 'Bearer ' and the sync key are both 401 (empty secret never matches)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    for (const h of ["Bearer ", "Bearer", `Bearer ${SECRETS.SYNC}`]) {
      expect((await mega({ authorization: h })).status, h).toBe(401);
    }
    expect(fanout.withConcurrency).not.toHaveBeenCalled();
  });

  it("the child crons' gate (real requireCronAuth) refuses the sync key too: the bridge key cannot fan out one child at a time", () => {
    const req = (authorization: string) => new Request(`${ORIGIN}/api/cron/data-cleanup`, { headers: { authorization } });
    expect(() => requireCronAuth(req(`Bearer ${SECRETS.SYNC}`))).toThrow("Unauthorized");
    expect(() => requireCronAuth(req(SECRETS.CRON))).toThrow("Unauthorized");
    expect(() => requireCronAuth(req(`Bearer ${SECRETS.CRON}`))).not.toThrow();
  });

  it("false-positive guard: a trailing space after the right secret still fans out (Headers trims it)", async () => {
    const res = await mega({ authorization: `Bearer ${SECRETS.CRON} ` });
    expect(res.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("/api/sync/events · a bridge draft is create-or-edit-pending only (real auth, real handler)", () => {
  it.each(["approved", "scheduled", "rendering", "Approved", "PUBLISHED", "published ", "pending\u0000", "live-now", "POSTED", "constructor", "__proto__", "toString"])(
    "a new draft sent as %j lands as pending",
    async (status) => {
      const id = `s-${JSON.stringify(status)}`;
      const r = await sendDraft({ id, content: "x", status });
      expect(r.status).toBe(200);
      expect(db.rows.get(id)?.status).toBe("pending");
    },
  );

  it("an array-wrapped status cannot smuggle an actionable value", async () => {
    await sendDraft({ id: "arr", content: "x", status: ["approved"] });
    expect(db.rows.get("arr")?.status).toBe("pending");
  });

  it.each(["approved", "scheduled", "rendering", "published", "rejected"])(
    "an existing %s row is untouched and reported ignored",
    async (status) => {
      db.rows.set("p1", { id: "p1", content: "operator copy", status, platforms: ["instagram"], deletedAt: null, createdAt: db.now() });
      const r = await sendDraft({ id: "p1", content: "overwrite", status: "pending", platforms: ["facebook"] });
      expect(r.status).toBe(200);
      expect(r.json.data.results[0]).toMatchObject({ ignored: "row not pending" });
      expect(db.rows.get("p1")).toMatchObject({ content: "operator copy", status, platforms: ["instagram"] });
    },
  );

  it("a batch cannot launder status: the second event for the same id is still mapped to pending", async () => {
    const r = await callJson(
      syncEventsPOST as never,
      "/api/sync/events",
      { events: [draftEvent({ id: "b1", content: "a", status: "pending" }), draftEvent({ id: "b1", content: "b", status: "approved" })] },
      BRIDGE,
    );
    expect(r.status).toBe(200);
    expect(db.rows.get("b1")).toMatchObject({ content: "b", status: "pending" });
  });

  // Hostile review 2026-10-10 (sync/events mirror guard). nickstire's Draft Board marks a post
  // live as "posted" (or "published_manual"), and drops one as "archived" (routers/content.ts
  // saveReelDraft/saveCarouselDraft send brief.status raw). The clamp turned all three into
  // "pending", which is publish-claimable, and an approved/scheduled row ignored the mirror and
  // stayed claimable: one Queue publish tap from a duplicate post.
  const PUBLISHED_AT = "2026-10-10T11:00:00.000Z";
  const POST_MIRROR_URL = "https://instagram.example/p/1";
  it.each([
    ["posted", "approved"],
    ["posted", "scheduled"],
    ["published_manual", "approved"],
    ["published", "approved"],
    ["published", "scheduled"],
  ])("a %s mirror retires an existing %s row as published and keeps the operator's copy", async (sent, status) => {
    const when = new Date("2026-10-11T15:00:00Z");
    db.rows.set("m1", { id: "m1", content: "operator copy", status, platforms: ["instagram"], scheduledFor: when, publishedAt: null, publishUrls: [], deletedAt: null, createdAt: db.now() });
    const r = await sendDraft({ id: "m1", content: "nick copy", status: sent, platforms: ["facebook"], publishedAt: PUBLISHED_AT });
    expect(r.status).toBe(200);
    expect(r.json.data.results[0]).not.toHaveProperty("ignored");
    expect(db.rows.get("m1")).toMatchObject({ status: "published", content: "operator copy", platforms: ["instagram"], scheduledFor: when });
    expect(db.rows.get("m1")?.publishedAt?.toISOString()).toBe(PUBLISHED_AT);
  });

  it.each(["posted", "published_manual"])("a %s mirror for a pending or new draft lands as published, never pending", async (sent) => {
    db.rows.set("m2", { id: "m2", content: "draft", status: "pending", deletedAt: null, createdAt: db.now() });
    await sendDraft({ id: "m2", content: "as posted", status: sent });
    await sendDraft({ id: "m3", content: "as posted", status: sent });
    expect(db.rows.get("m2")).toMatchObject({ status: "published", content: "as posted" });
    expect(db.rows.get("m3")?.status).toBe("published");
  });

  it.each(["pending", "approved", "scheduled"])("an archived mirror retires a %s row as rejected (never publishable)", async (status) => {
    db.rows.set("m4", { id: "m4", content: "operator copy", status, deletedAt: null, createdAt: db.now() });
    await sendDraft({ id: "m4", content: "x", status: "archived" });
    await sendDraft({ id: "m5", content: "x", status: "archived" });
    expect(db.rows.get("m4")?.status).toBe("rejected");
    expect(db.rows.get("m5")?.status).toBe("rejected");
  });

  it.each(["posted", "published", "archived", "rejected"])(
    "control: a %s mirror never touches a row the render or publish lane holds (rendering) or a terminal row",
    async (sent) => {
      for (const status of ["rendering", "published", "rejected"]) {
        const row = { id: "m6", content: "worker copy", status, platforms: ["instagram"], publishUrls: [POST_MIRROR_URL], deletedAt: null, createdAt: db.now() };
        db.rows.set("m6", { ...row });
        const r = await sendDraft({ id: "m6", content: "nick copy", status: sent, platforms: ["facebook"] });
        expect(r.json.data.results[0], `${sent} over ${status}`).toMatchObject({ ignored: "row not pending" });
        expect(db.rows.get("m6"), `${sent} over ${status}`).toEqual(row);
      }
    },
  );

  it("anonymous POST is 401 and writes nothing", async () => {
    const r = await sendDraft({ id: "anon", content: "x", status: "pending" }, {});
    expect(r.status).toBe(401);
    expect(db.rows.has("anon")).toBe(false);
  });
});

describe("the SAME bridge key, the adjacent doors · does the draft contract hold end to end?", () => {
  const POST_URL = "https://facebook.example/posted/1";

  // FIXED (was P1/P2 bypass) · render-complete had no status precondition, so it promoted ANY
  // row to "scheduled" (scheduledFor set) or "approved", both publish-claimable. Chain:
  // sync/events creates a pending draft WITH scheduledFor → render-complete → "scheduled".
  // It is now a compare-and-set on the render lane's lease: anything else is 409, untouched.
  it("chain: a bridge-created pending draft cannot be promoted to scheduled by render-complete", async () => {
    const create = await sendDraft({ id: "chain1", content: "bridge copy", status: "approved", scheduledFor: "2026-10-10T13:00:00.000Z" });
    expect(create.status).toBe(200);
    expect(db.rows.get("chain1")?.status).toBe("pending"); // sync/events held
    const r = await callJson(renderCompletePOST as never, "/api/sync/queue/render-complete", { id: "chain1", videoUrl: "https://cdn.example/x.mp4" }, BRIDGE);
    expect(db.rows.get("chain1")?.status, `render-complete answered ${r.status} ${JSON.stringify(r.json)}`).toBe("pending");
  });

  // FIXED (was P1) · same door, worse target: a row nickstire mirrored as ALREADY PUBLISHED was
  // re-armed to "approved" with no publishResults, so a dispatch would post it a second time.
  it.each(["published", "rejected"])("render-complete cannot re-arm a %s row", async (status) => {
    db.rows.set("live1", { id: "live1", content: "live post", status, platforms: ["facebook"], publishUrls: [POST_URL], scheduledFor: null, deletedAt: null, createdAt: db.now() });
    const r = await callJson(renderCompletePOST as never, "/api/sync/queue/render-complete", { id: "live1", videoUrl: "https://cdn.example/y.mp4" }, BRIDGE);
    expect(db.rows.get("live1")?.status, `render-complete answered ${r.status} ${JSON.stringify(r.json)}`).toBe(status);
  });

  const LEASE = new Date("2026-10-10T12:30:00Z");
  it.each<[string, Record<string, unknown>]>([
    ["pending", { status: "pending", renderLeaseExpiresAt: null }],
    ["approved", { status: "approved", renderLeaseExpiresAt: null }],
    ["scheduled", { status: "scheduled", renderLeaseExpiresAt: null }],
    // the publish worker's in-flight marker: "rendering" with NO lease (social-publish.ts claim)
    ["publish-lane rendering (no lease)", { status: "rendering", renderLeaseExpiresAt: null }],
    ["soft-deleted leased reel", { status: "rendering", renderLeaseExpiresAt: LEASE, deletedAt: new Date("2026-10-10T11:00:00Z") }],
  ])("render-complete on a %s row is 409 and writes nothing", async (_label, state) => {
    const row = { id: "u1", content: "x", kind: "reel", imageUrl: null, scheduledFor: null, deletedAt: null, createdAt: db.now(), ...state };
    db.rows.set("u1", { ...row });
    const r = await callJson(renderCompletePOST as never, "/api/sync/queue/render-complete", { id: "u1", videoUrl: "https://cdn.example/u1.mp4" }, BRIDGE);
    expect(r.status, JSON.stringify(r.json)).toBe(409);
    expect(db.rows.get("u1")).toEqual(row);
  });

  it("worker path end to end: GET /render leases the approved reel, render-complete finishes it, a replay is 409", async () => {
    db.rows.set("w1", { id: "w1", content: "reel", kind: "reel", status: "approved", imageUrl: null, renderAttempts: 0, renderLeaseExpiresAt: null, scheduledFor: null, deletedAt: null, createdAt: db.now() });
    const lease = await renderLeaseGET(new Request(`${ORIGIN}/api/sync/queue/render`, { headers: BRIDGE }), {} as never);
    expect(lease.status).toBe(200);
    expect((await lease.json()).data.item).toMatchObject({ id: "w1", attempt: 1 });
    expect(db.rows.get("w1")).toMatchObject({ status: "rendering", renderAttempts: 1 });
    expect(db.rows.get("w1")?.renderLeaseExpiresAt).toBeInstanceOf(Date);

    const done = await callJson(renderCompletePOST as never, "/api/sync/queue/render-complete", { id: "w1", videoUrl: "https://cdn.example/w1.mp4" }, BRIDGE);
    expect(done.status, JSON.stringify(done.json)).toBe(200);
    expect(done.json.data.item).toEqual({ id: "w1", imageUrl: "https://cdn.example/w1.mp4", status: "approved" });
    expect(db.rows.get("w1")).toMatchObject({ status: "approved", imageUrl: "https://cdn.example/w1.mp4", renderLeaseExpiresAt: null, lastRenderError: null });

    const replay = await callJson(renderCompletePOST as never, "/api/sync/queue/render-complete", { id: "w1", videoUrl: "https://cdn.example/other.mp4" }, BRIDGE);
    expect(replay.status).toBe(409);
    expect(db.rows.get("w1")?.imageUrl).toBe("https://cdn.example/w1.mp4");
  });

  it("a leased reel with scheduledFor set finishes as scheduled (the operator's schedule survives the render)", async () => {
    db.rows.set("w2", { id: "w2", content: "reel", kind: "reel", status: "rendering", renderLeaseExpiresAt: LEASE, scheduledFor: new Date("2026-10-11T15:00:00Z"), deletedAt: null, createdAt: db.now() });
    const r = await callJson(renderCompletePOST as never, "/api/sync/queue/render-complete", { id: "w2", videoUrl: "https://cdn.example/w2.mp4" }, BRIDGE);
    expect(r.status).toBe(200);
    expect(db.rows.get("w2")).toMatchObject({ status: "scheduled", imageUrl: "https://cdn.example/w2.mp4", renderLeaseExpiresAt: null });
  });

  it("the completion write is a compare-and-set pinned to the lease state it read", async () => {
    db.rows.set("w3", { id: "w3", content: "reel", kind: "reel", status: "rendering", renderLeaseExpiresAt: LEASE, scheduledFor: null, deletedAt: null, createdAt: db.now() });
    db.socialPublishQueue.updateMany.mockClear();
    db.socialPublishQueue.update.mockClear();
    await callJson(renderCompletePOST as never, "/api/sync/queue/render-complete", { id: "w3", videoUrl: "https://cdn.example/w3.mp4" }, BRIDGE);
    expect(db.socialPublishQueue.update).not.toHaveBeenCalled();
    expect(db.socialPublishQueue.updateMany).toHaveBeenCalledTimes(1);
    expect(db.socialPublishQueue.updateMany.mock.calls[0][0].where).toEqual({
      id: "w3",
      deletedAt: null,
      status: "rendering",
      renderLeaseExpiresAt: { not: null },
      scheduledFor: null,
    });
  });

  it("control: render-complete DOES finish a row the render lane actually leased", async () => {
    db.rows.set("r1", { id: "r1", content: "reel", kind: "reel", status: "rendering", renderLeaseExpiresAt: new Date("2026-10-10T12:30:00Z"), scheduledFor: null, deletedAt: null, createdAt: db.now() });
    const r = await callJson(renderCompletePOST as never, "/api/sync/queue/render-complete", { id: "r1", videoUrl: "https://cdn.example/r1.mp4" }, BRIDGE);
    expect(r.status).toBe(200);
    expect(db.rows.get("r1")).toMatchObject({ status: "approved", imageUrl: "https://cdn.example/r1.mp4", renderLeaseExpiresAt: null });
  });

  it("control: render-complete without the bridge key is 401 and changes nothing", async () => {
    db.rows.set("r2", { id: "r2", content: "x", status: "pending", scheduledFor: null, deletedAt: null, createdAt: db.now() });
    const r = await callJson(renderCompletePOST as never, "/api/sync/queue/render-complete", { id: "r2", videoUrl: "https://cdn.example/r2.mp4" }, {});
    expect(r.status).toBe(401);
    expect(db.rows.get("r2")?.status).toBe("pending");
  });

  // BYPASS (P1, ACKNOWLEDGED in 98f646118 "NOT in this commit") · POST /api/sync/queue
  // approve/publish is still sync-key auth, so the bridge key that sync/events now limits to
  // pending can approve its own draft one request later ("pending" is also publish-claimable).
  it.fails("chain: a bridge-created pending draft cannot be approved via /api/sync/queue with the same key", async () => {
    await sendDraft({ id: "chain2", content: "bridge copy", status: "pending", platforms: ["instagram"] });
    expect(db.rows.get("chain2")?.status).toBe("pending");
    const r = await callJson(syncQueuePOST as never, "/api/sync/queue", { id: "chain2", action: "approve" }, BRIDGE);
    expect(db.rows.get("chain2")?.status, `sync/queue answered ${r.status} ${JSON.stringify(r.json)}`).toBe("pending");
  });
});
