/**
 * `pnpm check:get-auth` canary (scripts/check-sensitive-get-auth.ts).
 *
 * The 2026-10-10 audit (SN-10 / F10) proved the gate green on things it exists
 * to catch: a comment naming an auth helper satisfied it, a `// public:` note
 * anywhere in a file's first 10 lines exempted the whole file,
 * `export { x as GET }` was invisible, and the hand-kept prefix list skipped
 * ultron / health / people / relationships while naming 5 dead directories.
 * No test referenced the script, so none of that could go red.
 *
 * Fixtures are sources this file owns (never live config or a live count).
 * Each break-it fixture must FAIL; the controls prove the gate is not simply
 * failing everything. The binary probe runs the REAL script on temp copies and
 * asserts the exit code AND the named handler, so a wiring break (wrong argv,
 * silently scanning the live repo instead) cannot pass as green.
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_EXACT, PUBLIC_PREFIXES } from "@/lib/security/route-policy";
import { checkSource, listRoutes, scanPrefixes } from "@/scripts/check-sensitive-get-auth";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LEAK = "return Response.json(await prisma.journalEntry.findMany());";

describe("checkSource - break-it fixtures must FAIL", () => {
  const cases: Array<[string, string, string[]]> = [
    [
      "auth named only in comments",
      [
        "// requireSession runs in middleware, so no auth here",
        "/** Guarded by {@link requireSession}; see cronHandler. */",
        "export async function GET() {",
        '  /* apiHandler(..., { auth: "owner" }) */',
        `  ${LEAK}`,
        "}",
      ].join("\n"),
      ["GET"],
    ],
    [
      "auth named only in a string literal",
      `export async function GET() {\n  const note = "requireSession(req) is TODO";\n  ${LEAK}\n}\n`,
      ["GET"],
    ],
    [
      "unauthed handler exported as `export { x as GET }`",
      `async function handler() {\n  ${LEAK}\n}\nexport { handler as GET, handler as POST };\n`,
      ["GET"],
    ],
    [
      "file-header `// public:` does not exempt a GET it does not precede",
      [
        "// public: coarse health for monitors",
        'import { prisma } from "@/lib/prisma";',
        'export const dynamic = "force-dynamic";',
        `export async function GET() {\n  ${LEAK}\n}`,
      ].join("\n"),
      ["GET"],
    ],
    [
      "`// public:` on GET does not exempt a second, unauthed read handler",
      [
        "// public: external uptime monitors",
        "export async function GET() {\n  return Response.json({ ok: true });\n}",
        `export async function HEAD() {\n  ${LEAK}\n}`,
      ].join("\n"),
      ["HEAD"],
    ],
    [
      "auth only in a helper GET never references",
      `export async function GET() {\n  ${LEAK}\n}\nasync function unused(req: Request) {\n  await requireSession(req);\n}\n`,
      ["GET"],
    ],
    [
      "auth only in PATCH (the v10.0.183 /api/ai/chat/[id] leak)",
      `export async function GET() {\n  ${LEAK}\n}\nexport async function PATCH(req: Request) {\n  await requireSession(req);\n}\n`,
      ["GET"],
    ],
    [
      'apiHandler with auth: "none"',
      `export const GET = apiHandler(async () => {\n  ${LEAK}\n}, { auth: "none" });\n`,
      ["GET"],
    ],
    [
      "apiHandler with no auth option",
      `export const GET = apiHandler(async () => {\n  ${LEAK}\n});\n`,
      ["GET"],
    ],
    [
      'apiHandler with an unknown auth mode ("queuex" is not "queue")',
      `export const GET = apiHandler(async () => {\n  ${LEAK}\n}, { auth: "queuex" });\n`,
      ["GET"],
    ],
    ["GET re-exported from another module (unverifiable here)", 'export { GET } from "./impl";\n', ["GET"]],
    ["`export *` can carry a GET the gate cannot see", 'export * from "./impl";\n', ["export *"]],
    [
      "GET destructured from an import (unverifiable here)",
      'import { handlers } from "@/auth";\nexport const { GET, POST } = handlers;\n',
      ["GET"],
    ],
    ["GET aliased to an imported handler (unverifiable here)", 'import { handler } from "./impl";\nexport const GET = handler;\n', ["GET"]],
    ["default re-exported as GET", 'export { default as GET } from "./impl";\n', ["GET"]],
    [
      "prose QUOTING the marker is not a marker (system/health, deploy-info shape)",
      `// The old \`// public:\` note here dated from the Vercel era.\nexport async function GET() {\n  ${LEAK}\n}\n`,
      ["GET"],
    ],
    [
      "naming a secret without comparing it is not auth (app/api/version shape)",
      `export const GET = apiHandler(async () => ({\n  cron: Boolean(process.env.CRON_SECRET),\n  sync: Boolean(process.env.STATENOUR_SYNC_KEY),\n  expected: typeof EXPECTED_SECRET,\n}));\n`,
      ["GET"],
    ],
    [
      "a member access does not resolve to a same-file authed helper",
      `async function guard(req: Request) {\n  await requireSession(req);\n}\nexport async function GET() {\n  void cache.guard;\n  ${LEAK}\n}\n`,
      ["GET"],
    ],
  ];
  it.each(cases)("%s", (_name, src, want) => {
    expect(checkSource(src)).toEqual(want);
  });
});

describe("checkSource - controls must PASS", () => {
  const cases: Array<[string, string]> = [
    ["requireSession inside GET", `export async function GET(req: Request) {\n  await requireSession(req);\n  ${LEAK}\n}\n`],
    ['apiHandler(..., { auth: "owner" })', `export const GET = apiHandler(async () => {\n  ${LEAK}\n}, { auth: "owner" });\n`],
    [
      'apiHandler(..., { auth: "queue" }) (scoped /api/sync/queue key)',
      `export const GET = apiHandler(async () => {\n  ${LEAK}\n}, { auth: "queue" });\n`,
    ],
    ["cronHandler wrapper", `export const GET = cronHandler("job", async () => ({ ok: true }));\n`],
    [
      "authed handler exported as `export { handler as GET }`",
      `const handler = apiHandler(async () => {\n  ${LEAK}\n}, { auth: "owner" });\nexport { handler as GET, handler as POST };\n`,
    ],
    [
      "wrapper around an authed local handler",
      `const handler = async (req: Request) => {\n  await requireSession(req);\n  ${LEAK}\n};\nexport const GET = withTracing(handler, "x");\n`,
    ],
    [
      "GET calls a same-file guard helper (brain/pinned shape)",
      [
        "async function requireSessionGuard(req: Request) {",
        "  try { await requireSession(req); return null; } catch { return new Response(null, { status: 401 }); }",
        "}",
        "export async function GET(req: Request) {",
        "  const denied = await requireSessionGuard(req);",
        "  if (denied) return denied;",
        `  ${LEAK}`,
        "}",
      ].join("\n"),
    ],
    [
      "inline Bearer CRON_SECRET check (cron/mega shape)",
      [
        "export async function GET(req: Request) {",
        '  const ok = safeEqual(req.headers.get("authorization") ?? "", `Bearer ${process.env.CRON_SECRET}`);',
        '  if (!ok) return Response.json({ error: "Unauthorized" }, { status: 401 });',
        `  ${LEAK}`,
        "}",
      ].join("\n"),
    ],
    [
      "sync-key helper doing a crypto.timingSafeEqual (nour-os/query shape)",
      [
        "function isAuthorized(req: Request): boolean {",
        "  const syncKey = process.env.STATENOUR_SYNC_KEY;",
        "  if (!syncKey) return false;",
        '  const a = Buffer.from(req.headers.get("x-sync-key") ?? "");',
        "  const b = Buffer.from(syncKey);",
        "  return a.length === b.length && crypto.timingSafeEqual(a, b);",
        "}",
        "export async function GET(req: Request) {",
        '  if (!isAuthorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });',
        `  ${LEAK}`,
        "}",
      ].join("\n"),
    ],
    ["`// public:` directly above GET", "// public: external uptime monitors\nexport const GET = apiHandler(async () => ({ ok: true }));\n"],
    [
      "`// public:` inside the JSDoc directly above GET (heartbeat shape)",
      "/**\n * GET /api/x\n *\n * // public: external uptime monitors hit this without a session.\n */\nexport const GET = apiHandler(async () => ({ ok: true }));\n",
    ],
    ["no read handler at all", "export async function POST(req: Request) {\n  await requireSession(req);\n}\n"],
  ];
  it.each(cases)("%s", (_name, src) => {
    expect(checkSource(src)).toEqual([]);
  });
});

describe("scan set", () => {
  it("covers every /api path that bypasses the session gate, plus the owner-private gaps", () => {
    const set = scanPrefixes();
    for (const p of [...PUBLIC_PREFIXES, ...PUBLIC_EXACT].filter((x) => x.startsWith("/api/"))) {
      expect(set, p).toContain(`app${p.replace(/\/$/, "")}`);
    }
    for (const p of ["ultron", "health", "people", "relationships"]) expect(set).toContain(`app/api/${p}`);
  });

  it("names no dead prefix (a prefix with no route is a rotting list)", () => {
    const routes = listRoutes();
    const dead = (prefixes: string[]) => prefixes.filter((p) => !routes.some((f) => f.startsWith(`${p}/`)));
    // Positive control: a removed directory IS reported, so the empty result below means something.
    expect(dead(["app/api/score-daily"])).toEqual(["app/api/score-daily"]);
    expect(dead(scanPrefixes())).toEqual([]);
  });
});

describe("routes the hardened gate flagged on 2026-10-10 now pass it", () => {
  // Owner-private: must pass by real auth, never by a `// public:` marker.
  const OWNER = [
    "ultron/personal-pulse", "ultron/pulse", "ultron/situation", "ultron/ticker", "ultron/todo-desk",
    "ultron/work-context", "ultron/pulse-digest", "ultron/calibrate", "ultron/health-digest",
    "ultron/narrator", "health/governor/today", "system/deploy-info",
  ];
  // Open on purpose: pass by a marker that states why.
  const PUBLIC = [
    "auth/[...nextauth]", "auth/expires", "actions/openapi", "mcp", "nour-os/query",
    "version", "inngest",
  ];
  it.each(OWNER)("owner-gated: app/api/%s", (name) => {
    const file = `app/api/${name}/route.ts`;
    const src = readFileSync(join(APP_ROOT, file), "utf8");
    expect(listRoutes()).toContain(file);
    expect(checkSource(src)).toEqual([]);
    expect(src).not.toMatch(/^\s*(?:\*\s*)?\/\/\s*public:/m);
  });
  it.each(PUBLIC)("marked public: app/api/%s", (name) => {
    const file = `app/api/${name}/route.ts`;
    expect(listRoutes()).toContain(file);
    expect(checkSource(readFileSync(join(APP_ROOT, file), "utf8"))).toEqual([]);
  });
});

describe("07-X4: owner-private routes the proxy gate alone used to guard are scanned and authed", () => {
  // oauth/google-data/status is wrapped by R3-08; this row is its consumer.
  const ROUTES = [
    "content/render-asset", "tools/health", "drive/sync", "notifications", "notifications/subscribe", "habits",
    "oauth/google-data/status",
  ];
  it.each(ROUTES)("app/api/%s", (name) => {
    const file = `app/api/${name}/route.ts`;
    expect(listRoutes()).toContain(file);
    expect(checkSource(readFileSync(join(APP_ROOT, file), "utf8"))).toEqual([]);
  });
});

describe("binary probe - the real script, end to end", () => {
  const dir = mkdtempSync(join(tmpdir(), "get-auth-canary-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const spawnGate = (args: string[], cwd = APP_ROOT) => {
    const r = spawnSync(
      process.execPath,
      [join(APP_ROOT, "node_modules/tsx/dist/cli.mjs"), join(APP_ROOT, "scripts/check-sensitive-get-auth.ts"), ...args],
      { cwd, encoding: "utf8" },
    );
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const run = (src: string, name: string) => {
    const file = join(dir, name);
    writeFileSync(file, src);
    return spawnGate([file]);
  };

  it("exits 1 when it finds no route files at all (wrong cwd must not read as all-clear)", () => {
    const r = spawnGate([], resolve(APP_ROOT, "../.."));
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("scanned 0 route files");
  }, 60_000);

  it("exits 1 and names the file + handler for a comment-only auth mention", () => {
    const r = run(`// requireSession happens upstream\nexport async function GET() {\n  ${LEAK}\n}\n`, "leak-route.ts");
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("leak-route.ts");
    expect(r.out).toContain("[GET]");
  }, 60_000);

  it("exits 0 on an owner-gated control, having scanned exactly the one file passed", () => {
    const r = run(`export const GET = apiHandler(async () => {\n  ${LEAK}\n}, { auth: "owner" });\n`, "ok-route.ts");
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("scanned 1 route file(s)");
  }, 60_000);
});
