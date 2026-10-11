/**
 * Red-team: `pnpm check:get-auth` (scripts/check-sensitive-get-auth.ts, AST gate, wave 1 T15).
 *
 * Contract under test: every exported GET/HEAD route handler must carry auth IN ITS BODY,
 * unless the export statement carries a `// public: <reason>` marker.
 *
 * Every probe runs through TWO layers, pinned separately:
 *   1. the REAL script, spawned once via tsx on fixture files written to a temp dir
 *      (REDTEAM_FIXTURE_DIR, else a fresh mkdtemp) - verdict parsed from its own output;
 *   2. the exported `checkSource()` it calls.
 * The scan set (`listRoutes()`) is probed with a faked `git ls-files` listing, since the
 * real one only reads the tracked tree.
 *
 * Reading the results:
 *   - "handled:"  the gate already gives the correct verdict. Green, permanent.
 *   - "OPEN ...:" a verified bypass / false positive. The `[observed]` test pins today's
 *     wrong verdict (proves the probe parsed and the red below is for the right reason);
 *     the `[expected]` test is `it.fails` and asserts the CORRECT verdict. When the gate
 *     is fixed, `[observed]` goes red and `[expected]` goes red: delete the first, turn
 *     the second into `it`. REDTEAM_SHOW_OPEN=1 runs every `[expected]` test as plain `it`.
 *
 * 2026-10-10: all 30 findings (B01-B25, F01-F05) were fixed in the gate and are now
 * "handled" probes; none is open. A14-A17 / D23-D26 / B22b pin the new flow rules
 * (try/catch, local-const checks, throw, helper memo, TSX parsing) in deny/allow pairs.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isPublic } from "@/lib/security/route-policy";
import { checkSource, listRoutes } from "@/scripts/check-sensitive-get-auth";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TSX = join(APP_ROOT, "node_modules/tsx/dist/cli.mjs");
const SCRIPT = join(APP_ROOT, "scripts/check-sensitive-get-auth.ts");
const LEAK = "return Response.json(await prisma.journalEntry.findMany());";

// `it.fails` while a finding is open. REDTEAM_SHOW_OPEN=1 runs them as plain `it` so the
// open findings print as reds with their real assertion message (the positive control).
const itOpen = process.env.REDTEAM_SHOW_OPEN === "1" ? it : it.fails;

const ownDir = !process.env.REDTEAM_FIXTURE_DIR;
const FIXTURES = process.env.REDTEAM_FIXTURE_DIR ?? mkdtempSync(join(tmpdir(), "get-auth-redteam-"));
mkdirSync(FIXTURES, { recursive: true });
afterAll(() => {
  if (ownDir) rmSync(FIXTURES, { recursive: true, force: true });
});

function runGate(files: string[]): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [TSX, SCRIPT, ...files], { cwd: APP_ROOT, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

/** The script prints one `  <file>  [M1, M2]` line per violating file. */
function parseViolations(out: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const line of out.split(/\r?\n/)) {
    const m = /^ {2}(.+?) {2}\[(.*)\]$/.exec(line);
    if (m) map.set(basename(m[1]), m[2].split(", "));
  }
  return map;
}

interface Probe {
  id: string;
  name: string;
  src: string;
  /** The correct verdict: read handlers the gate must name (empty = must pass). */
  expected: string[];
  /** Today's verdict when it differs from `expected` (a verified bypass / false positive). */
  observed?: string[];
  /** Fixture file name when the extension matters (default `<id>.route.ts`). */
  file?: string;
}

const fn = (body: string) => `async () => {\n  ${body}\n}`;

// ---------------------------------------------------------------------------------------
// Verified BYPASSES (red team 2026-10-10): an unauthenticated read handler the gate let
// through. All fixed in the same wave; each is now a permanent deny example.
// ---------------------------------------------------------------------------------------
const BYPASSES: Probe[] = [
  {
    id: "B01",
    name: "auth only on an env-gated branch (dev bypass)",
    src: `export async function GET(req: Request) {\n  if (process.env.NODE_ENV === "production") await requireSession(req);\n  ${LEAK}\n}\n`,
    expected: ["GET"],
  },
  {
    id: "B02",
    name: "early return of data BEFORE the auth call",
    src: `export async function GET(req: Request) {\n  if (new URL(req.url).searchParams.has("preview")) {\n    ${LEAK}\n  }\n  await requireSession(req);\n  return Response.json({});\n}\n`,
    expected: ["GET"],
  },
  {
    id: "B03",
    name: "shared handler exported as GET+POST, auth only when method !== GET",
    src: `async function handler(req: Request) {\n  if (req.method !== "GET") await requireSession(req);\n  ${LEAK}\n}\nexport { handler as GET, handler as POST };\n`,
    expected: ["GET"],
  },
  {
    id: "B04",
    name: "auth failure swallowed: requireSession(req).catch(() => null)",
    src: `export async function GET(req: Request) {\n  await requireSession(req).catch(() => null);\n  ${LEAK}\n}\n`,
    expected: ["GET"],
  },
  {
    id: "B05",
    name: "auth inside a closure that is never invoked",
    src: `export async function GET(req: Request) {\n  const check = () => requireSession(req);\n  ${LEAK}\n}\n`,
    expected: ["GET"],
  },
  {
    id: "B06",
    name: "auth helper referenced as a value, never called",
    src: `export async function GET() {\n  void requireSession;\n  ${LEAK}\n}\n`,
    expected: ["GET"],
  },
  {
    id: "B07",
    name: "auth helper named only in a TYPE position (typeof requireSession)",
    src: `export async function GET(): Promise<Awaited<ReturnType<typeof requireSession>> | Response> {\n  ${LEAK}\n}\n`,
    expected: ["GET"],
  },
  {
    id: "B08",
    name: 'auth: "owner" as response DATA inside an auth: "none" handler (mention, not option)',
    src: `export const GET = apiHandler(async () => {\n  const rows = await prisma.journalEntry.findMany();\n  return { route: "/api/journal", auth: "owner", rows };\n}, { auth: "none" });\n`,
    expected: ["GET"],
  },
  {
    id: "B09",
    name: 'spread of a same-file owner preset, then auth: "none" overrides it',
    src: `const OWNER = { auth: "owner" } as const;\nexport const POST = apiHandler(save, OWNER);\nexport const GET = apiHandler(${fn(LEAK)}, { ...OWNER, auth: "none" });\n`,
    expected: ["GET"],
  },
  {
    id: "B10",
    name: 'auth: "owner" followed by an unverifiable imported spread that can override it',
    src: `import { routeOverrides } from "./opts";\nexport const GET = apiHandler(${fn(LEAK)}, { auth: "owner", ...routeOverrides });\n`,
    expected: ["GET"],
  },
  {
    id: "B11",
    name: "export const { GET, POST } = { GET: open, POST: authed } (sibling's auth credited)",
    src: `export const { GET, POST } = {\n  GET: apiHandler(${fn(LEAK)}),\n  POST: apiHandler(save, { auth: "owner" }),\n};\n`,
    expected: ["GET"],
  },
  {
    id: "B12",
    name: "GET uses one member of a module-level helpers object that also holds a guard",
    src: `const db = {\n  guard: (req: Request) => requireSession(req),\n  list: () => prisma.journalEntry.findMany(),\n};\nexport async function GET() {\n  return Response.json(await db.list());\n}\n`,
    expected: ["GET"],
  },
  {
    id: "B13",
    name: "scope-blind lookup: a LOCAL `guard` variable resolves to the top-level authed guard()",
    src: `async function guard(req: Request) {\n  await requireSession(req);\n}\nexport async function POST(req: Request) {\n  await guard(req);\n}\nexport async function GET(req: Request) {\n  const guard = new URL(req.url).searchParams.get("g");\n  return Response.json({ guard, rows: await prisma.journalEntry.findMany() });\n}\n`,
    expected: ["GET"],
  },
  {
    id: "B14",
    name: "safeEqual used for an ETag compare counts as auth (name match, not purpose)",
    src: `import { safeEqual } from "@/lib/auth-guard";\nexport async function GET(req: Request) {\n  const rows = await prisma.journalEntry.findMany();\n  if (safeEqual(req.headers.get("if-none-match") ?? "", String(rows.length))) return new Response(null, { status: 304 });\n  return Response.json(rows);\n}\n`,
    expected: ["GET"],
  },
  {
    id: "B15",
    name: "a local no-op stub named requireSession counts as auth",
    src: `const requireSession = async (_req: Request) => {};\nexport async function GET(req: Request) {\n  await requireSession(req);\n  ${LEAK}\n}\n`,
    expected: ["GET"],
  },
  {
    id: "B16",
    name: "export let GET = authed; later reassigned to an open handler",
    src: `export let GET = apiHandler(async () => ({ ok: true }), { auth: "owner" });\nGET = apiHandler(${fn(LEAK)});\n`,
    expected: ["GET"],
  },
  {
    id: "B17",
    name: "array-binding export: export const [GET] = [open]",
    src: `export const [GET] = [apiHandler(${fn(LEAK)})];\n`,
    expected: ["GET"],
  },
  {
    id: "B18",
    name: "nested object-binding export: export const { handlers: { GET } } = impl",
    src: `import * as impl from "./impl";\nexport const { handlers: { GET } } = impl;\n`,
    expected: ["GET"],
  },
  {
    id: "B19",
    name: "TS import-equals export: export import GET = impl.GET",
    src: `import * as impl from "./impl";\nexport import GET = impl.GET;\n`,
    expected: ["GET"],
  },
  {
    id: "B20",
    name: 'namespace re-export: export * as GET from "./impl" (unclassified export, not failed closed)',
    src: `export * as GET from "./impl";\n`,
    expected: ["GET"],
  },
  {
    id: "B21",
    name: "JSDoc PROSE that wraps `// public:` onto its own line exempts the handler",
    src: `/**\n * Owner-only journal feed. Never add a\n * // public: marker here, the data is private.\n */\nexport async function GET() {\n  ${LEAK}\n}\n`,
    expected: ["GET"],
  },
  {
    id: "B22b",
    name: "a .tsx route parsed as .ts reads JSX TEXT naming requireSession as a call",
    src: `export async function GET() {\n  const note = <p>await requireSession(req);</p>;\n  return new ImageResponse(<div>{await prisma.journalEntry.findMany()}</div>);\n}\n`,
    expected: ["GET"],
    file: "B22b.route.tsx",
  },
];

// ---------------------------------------------------------------------------------------
// Verified FALSE POSITIVES (red team 2026-10-10): a properly authenticated read handler the
// gate flagged. All fixed; each is now a permanent allow example.
// ---------------------------------------------------------------------------------------
const FALSE_POSITIVES: Probe[] = [
  {
    id: "F01",
    name: 'apiHandler(..., { auth: "owner" as const })',
    src: `export const GET = apiHandler(${fn(LEAK)}, { auth: "owner" as const });\n`,
    expected: [],
  },
  {
    id: "F02",
    name: "quoted option key: { \"auth\": \"owner\" }",
    src: `export const GET = apiHandler(${fn(LEAK)}, { "auth": "owner" });\n`,
    expected: [],
  },
  {
    id: "F03",
    name: 'shorthand option: const auth = "owner"; apiHandler(fn, { auth })',
    src: `const auth = "owner" as const;\nexport const GET = apiHandler(${fn(LEAK)}, { auth });\n`,
    expected: [],
  },
  {
    id: "F04",
    name: "the repo's own runner guard assertRunnerRequest (lib/internal/runner-auth.ts)",
    src: `import { assertRunnerRequest } from "@/lib/internal/runner-auth";\nexport const GET = apiHandler(async (req) => {\n  assertRunnerRequest(req);\n  ${LEAK}\n});\n`,
    expected: [],
  },
  {
    id: "F05",
    name: "the repo's own bridge guard requireBridgeAuth (lib/bridge-auth.ts)",
    src: `import { requireBridgeAuth } from "@/lib/bridge-auth";\nexport async function GET(req: Request) {\n  requireBridgeAuth(req);\n  ${LEAK}\n}\n`,
    expected: [],
  },
];

// ---------------------------------------------------------------------------------------
// Probes the gate already handles correctly (green deny + allow examples).
// ---------------------------------------------------------------------------------------
const HANDLED: Probe[] = [
  // deny
  { id: "D01", name: "apiHandler(fn) with no options (implicit auth none)", src: `export const GET = apiHandler(${fn(LEAK)});\n`, expected: ["GET"] },
  { id: "D02", name: "apiHandler(fn, {}) empty options", src: `export const GET = apiHandler(${fn(LEAK)}, {});\n`, expected: ["GET"] },
  { id: "D03", name: "apiHandler(fn, { auth: undefined })", src: `export const GET = apiHandler(${fn(LEAK)}, { auth: undefined });\n`, expected: ["GET"] },
  { id: "D04", name: 'apiHandler(fn, { auth: "none" }) beside an owner-gated POST', src: `export const POST = apiHandler(save, { auth: "owner" });\nexport const GET = apiHandler(${fn(LEAK)}, { auth: "none" });\n`, expected: ["GET"] },
  { id: "D05", name: "auth mode chosen at runtime (ternary) fails closed", src: `export const GET = apiHandler(${fn(LEAK)}, { auth: process.env.OPEN ? "none" : "owner" });\n`, expected: ["GET"] },
  { id: "D06", name: "export async function HEAD, unauthed", src: `export async function HEAD() {\n  ${LEAK}\n}\n`, expected: ["HEAD"] },
  { id: "D07", name: "export default async function GET, unauthed (conservative)", src: `export default async function GET() {\n  ${LEAK}\n}\n`, expected: ["GET"] },
  { id: "D08", name: 'string export name: export { leak as "GET" }', src: `async function leak() {\n  ${LEAK}\n}\nexport { leak as "GET" };\n`, expected: ["GET"] },
  { id: "D09", name: "export { authed as GET, leak as HEAD } flags only HEAD", src: `const authed = apiHandler(${fn(LEAK)}, { auth: "owner" });\nasync function leak() {\n  ${LEAK}\n}\nexport { authed as GET, leak as HEAD };\n`, expected: ["HEAD"] },
  { id: "D10", name: 'export { GET } from "./other" (re-export fails closed)', src: `export { GET } from "./other";\n`, expected: ["GET"] },
  { id: "D11", name: "import { GET } then export { GET } (fails closed)", src: `import { GET } from "./impl";\nexport { GET };\n`, expected: ["GET"] },
  { id: "D12", name: "export var GET; GET = open (no initializer, fails closed)", src: `export var GET: any;\nGET = async () => {\n  ${LEAK}\n};\n`, expected: ["GET"] },
  { id: "D13", name: "requireSession imported but not called", src: `import { requireSession } from "@/lib/auth-guard";\nexport async function GET() {\n  ${LEAK}\n}\n`, expected: ["GET"] },
  { id: "D14", name: "requireSession only in a // comment and a string", src: `export async function GET() {\n  // await requireSession(req);\n  const todo = "requireSession(req)";\n  ${LEAK}\n}\n`, expected: ["GET"] },
  { id: "D15", name: "multi-declarator: export const GET = open, POST = authed", src: `export const GET = apiHandler(${fn(LEAK)}), POST = apiHandler(save, { auth: "owner" });\n`, expected: ["GET"] },
  { id: "D16", name: "`// public:` inside a template string above GET", src: `const doc = \`\n// public: not a real marker\n\`;\nexport async function GET() {\n  ${LEAK}\n}\n`, expected: ["GET"] },
  { id: "D17", name: "`// public:` as a trailing comment of the PREVIOUS statement", src: `export const dynamic = "force-dynamic"; // public: trailing\nexport async function GET() {\n  ${LEAK}\n}\n`, expected: ["GET"] },
  { id: "D18", name: "`// public:` after the export keyword", src: `export\n// public: after the keyword\nasync function GET() {\n  ${LEAK}\n}\n`, expected: ["GET"] },
  { id: "D19", name: "`// PUBLIC:` wrong case", src: `// PUBLIC: monitors\nexport async function GET() {\n  ${LEAK}\n}\n`, expected: ["GET"] },
  { id: "D20", name: "`// public:` with an empty reason", src: `// public:\nexport async function GET() {\n  ${LEAK}\n}\n`, expected: ["GET"] },
  { id: "D21", name: "`/* // public: x */` inline block comment", src: `/* // public: inline block */\nexport async function GET() {\n  ${LEAK}\n}\n`, expected: ["GET"] },
  { id: "D22", name: "a `// public:` marker in ANOTHER file does not exempt this one (pair with A01)", src: `export async function GET() {\n  ${LEAK}\n}\n`, expected: ["GET"] },
  // allow
  { id: "A01", name: "`// public:` directly above GET (pair of D22, same gate run)", src: `// public: external uptime monitors\nexport async function GET() {\n  return Response.json({ ok: true });\n}\n`, expected: [] },
  { id: "A02", name: 'apiHandler(fn, { auth: "cron" })', src: `export const GET = apiHandler(${fn(LEAK)}, { auth: "cron" });\n`, expected: [] },
  { id: "A03", name: "cronHandler wrapper", src: `export const GET = cronHandler("job", ${fn(LEAK)});\n`, expected: [] },
  { id: "A04", name: "syncHandler wrapper", src: `export const GET = syncHandler(${fn(LEAK)});\n`, expected: [] },
  { id: "A05", name: "evidenceHandler wrapper", src: `export const GET = evidenceHandler(${fn(LEAK)});\n`, expected: [] },
  { id: "A06", name: "auth option as a no-substitution template literal", src: "export const GET = apiHandler(" + fn(LEAK) + ", { auth: `owner` });\n", expected: [] },
  { id: "A07", name: "{ ...BASE, auth: \"owner\" } (owner wins, spread first)", src: `export const GET = apiHandler(${fn(LEAK)}, { ...BASE, auth: "owner" });\n`, expected: [] },
  { id: "A08", name: "owner apiHandler wrapped in another wrapper", src: `export const GET = withRateLimit(apiHandler(${fn(LEAK)}, { auth: "owner" }));\n`, expected: [] },
  { id: "A09", name: 'string export name of an authed handler: export { ok as "GET" }', src: `const ok = apiHandler(${fn(LEAK)}, { auth: "owner" });\nexport { ok as "GET" };\n`, expected: [] },
  { id: "A10", name: "export const HEAD = GET where GET is owner-gated", src: `export const GET = apiHandler(${fn(LEAK)}, { auth: "owner" });\nexport const HEAD = GET;\n`, expected: [] },
  { id: "A11", name: "overload signature + authed implementation", src: `export async function GET(): Promise<Response>;\nexport async function GET(req?: Request): Promise<Response> {\n  await requireSession(req!);\n  ${LEAK}\n}\n`, expected: [] },
  { id: "A12", name: "lowercase `get` is not a route handler", src: `export async function get() {\n  ${LEAK}\n}\n`, expected: [] },
  { id: "A13", name: "requireSession called at the top of GET", src: `export async function GET(req: Request) {\n  await requireSession(req);\n  ${LEAK}\n}\n`, expected: [] },
  { id: "A14", name: "session, else sync key: try { requireSession } catch { requireSyncAuth } (devices/command/[id] shape)", src: `export async function GET(req: Request) {\n  try {\n    await requireSession(req);\n  } catch {\n    await requireSyncAuth(req);\n  }\n  ${LEAK}\n}\n`, expected: [] },
  { id: "A15", name: "const ok = Boolean(secret) && safeEqual(...); if (!ok) return 401 (cron/mega shape)", src: `export async function GET(req: Request) {\n  const h = req.headers.get("authorization") ?? "";\n  const ok = Boolean(process.env.CRON_SECRET) && safeEqual(h, \`Bearer \${process.env.CRON_SECRET}\`);\n  if (!ok) return Response.json({ error: "Unauthorized" }, { status: 401 });\n  ${LEAK}\n}\n`, expected: [] },
  { id: "A16", name: "the same guard helper called in a branch, then again on every path", src: `async function guard(req: Request) {\n  await requireSession(req);\n}\nexport async function GET(req: Request) {\n  if (new URL(req.url).searchParams.has("x")) await guard(req);\n  await guard(req);\n  ${LEAK}\n}\n`, expected: [] },
  { id: "A17", name: "a validation THROW before auth ends the request without data (not a leak)", src: `export async function GET(req: Request) {\n  const id = new URL(req.url).searchParams.get("id");\n  if (!id) throw new ServiceError("id required", 400);\n  await requireSession(req);\n  ${LEAK}\n}\n`, expected: [] },
  // deny pairs of the new flow rules
  { id: "D23", name: "auth only on the 401 branch of a capability check (images/[id] shape, live on 2026-10-10)", src: `export async function GET(req: Request) {\n  const cap = authorizeImageRequest(req);\n  if (!cap.ok) {\n    if (cap.status === 401) {\n      try {\n        await requireSession(req);\n      } catch {\n        return Response.json({ error: "x" }, { status: 401 });\n      }\n    } else {\n      return Response.json({ error: "x" }, { status: cap.status });\n    }\n  }\n  ${LEAK}\n}\n`, expected: ["GET"] },
  { id: "D24", name: "try { requireSession } catch {} swallows the denial (pair of A14)", src: `export async function GET(req: Request) {\n  try {\n    await requireSession(req);\n  } catch {\n    console.info("no session");\n  }\n  ${LEAK}\n}\n`, expected: ["GET"] },
  { id: "D27", name: "B01 as an expression: isProd && (await requireSession(req));", src: `export async function GET(req: Request) {\n  process.env.NODE_ENV === "production" && (await requireSession(req));\n  ${LEAK}\n}\n`, expected: ["GET"] },
  { id: "D28", name: "B01 as a ternary initializer: const s = isProd ? await requireSession(req) : null", src: `export async function GET(req: Request) {\n  const s = process.env.NODE_ENV === "production" ? await requireSession(req) : null;\n  ${LEAK}\n}\n`, expected: ["GET"] },
  { id: "D26", name: "a same-file stub named apiHandler: its auth option is not trusted (B15, wrapper form)", src: `const apiHandler = (h: unknown, _o?: unknown) => h;\nexport const GET = apiHandler(${fn(LEAK)}, { auth: "owner" });\n`, expected: ["GET"] },
  { id: "D25", name: "env-gated compare: if (isProd && !safeEqual(...)) return 401 (pair of A15)", src: `export async function GET(req: Request) {\n  const h = req.headers.get("authorization") ?? "";\n  if (process.env.NODE_ENV === "production" && !safeEqual(h, \`Bearer \${process.env.CRON_SECRET}\`)) {\n    return Response.json({ error: "Unauthorized" }, { status: 401 });\n  }\n  ${LEAK}\n}\n`, expected: ["GET"] },
];

const ALL: Probe[] = [...BYPASSES, ...FALSE_POSITIVES, ...HANDLED];
const fileOf = (p: Probe) => p.file ?? `${p.id}.route.ts`;

let gate: { status: number | null; out: string; verdicts: Map<string, string[]> };

beforeAll(() => {
  const files = ALL.map((p) => {
    const f = join(FIXTURES, fileOf(p));
    writeFileSync(f, p.src);
    return f;
  });
  const r = runGate(files);
  gate = { ...r, verdicts: parseViolations(r.out) };
}, 120_000);

const binaryVerdict = (p: Probe) => gate.verdicts.get(fileOf(p)) ?? [];

describe("positive + negative control: the real script, one file each", () => {
  it("POSITIVE CONTROL: apiHandler(fn) with no auth is DENIED (exit 1, names file + [GET] + rule text)", () => {
    const f = join(FIXTURES, "control-deny.route.ts");
    writeFileSync(f, `export const GET = apiHandler(${fn(LEAK)});\n`);
    const r = runGate([f]);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("1 of 1 route file(s) export a read handler with no auth IN ITS BODY");
    expect(parseViolations(r.out).get("control-deny.route.ts")).toEqual(["GET"]);
  }, 60_000);

  it("NEGATIVE CONTROL: the same handler with { auth: \"owner\" } is ALLOWED (exit 0, scanned exactly 1)", () => {
    const f = join(FIXTURES, "control-allow.route.ts");
    writeFileSync(f, `export const GET = apiHandler(${fn(LEAK)}, { auth: "owner" });\n`);
    const r = runGate([f]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("scanned 1 route file(s)");
  }, 60_000);
});

describe("batch run: the real script scanned every probe fixture", () => {
  it("exits 1 and reports a total equal to the number of fixtures passed", () => {
    expect(existsSync(join(FIXTURES, fileOf(ALL[0])))).toBe(true);
    expect(gate.status, gate.out).toBe(1);
    const flagged = ALL.filter((p) => (p.observed ?? p.expected).length > 0).length;
    expect(gate.out).toContain(`${flagged} of ${ALL.length} route file(s)`);
  });
});

function lock(group: string, probes: Probe[]): void {
  describe(group, () => {
    for (const p of probes) {
      if (!p.observed) {
        it(`${p.id} handled: ${p.name}`, () => {
          expect(binaryVerdict(p), gate.out).toEqual(p.expected);
          expect(checkSource(p.src, fileOf(p))).toEqual(p.expected);
        });
        continue;
      }
      const observed = p.observed;
      it(`${p.id} OPEN [observed]: ${p.name}`, () => {
        expect(binaryVerdict(p), gate.out).toEqual(observed);
        expect(checkSource(p.src, fileOf(p))).toEqual(observed);
      });
      itOpen(`${p.id} OPEN [expected]: ${p.name}`, () => {
        expect(binaryVerdict(p)).toEqual(p.expected);
      });
    }
  });
}

lock("bypasses (fixed): unauthenticated read handler is denied", BYPASSES);
lock("false positives (fixed): authenticated read handler passes", FALSE_POSITIVES);
lock("handled correctly: deny + allow examples", HANDLED);

// ---------------------------------------------------------------------------------------
// Scan set. listRoutes() is the real function; only its `git ls-files` input is faked.
// Every case pairs the URL the file serves (via the REAL isPublic) with whether it is scanned.
// ---------------------------------------------------------------------------------------
describe("scan set: listRoutes() over a faked git listing", () => {
  const listWith = (paths: string[]): string[] => {
    vi.mocked(execFileSync).mockReturnValueOnce(`${paths.join("\0")}\0`);
    const routes = listRoutes();
    expect(execFileSync).toHaveBeenLastCalledWith("git", ["ls-files", "-z", "--", "app"], { encoding: "utf8" });
    return routes;
  };

  it("handled: route.ts / route.js under a scanned prefix, and the prefix dir itself, are listed", () => {
    const files = ["app/api/brain/x/route.ts", "app/api/brain/x/route.js", "app/api/brain/route.ts"];
    expect(listWith(files)).toEqual(files);
  });

  it("handled: a SIBLING dir sharing the prefix (app/api/brainstorm) is out of scope AND session-gated", () => {
    expect(listWith(["app/api/brainstorm/route.ts"])).toEqual([]);
    expect(isPublic("/api/brainstorm")).toBe(false);
  });

  it("handled: non-handler files (route.test.ts, route.ts.bak) are not listed", () => {
    expect(listWith(["app/api/brain/x/route.test.ts", "app/api/brain/x/route.ts.bak"])).toEqual([]);
  });

  // B22 - Next's default pageExtensions (no override in next.config.ts) serve route.tsx / route.jsx.
  it("B22 handled: route.tsx / route.jsx under a public prefix are scanned", () => {
    const jsx = ["app/api/mcp/og/route.tsx", "app/api/brain/x/route.jsx"];
    expect(isPublic("/api/mcp/og")).toBe(true);
    expect(listWith(jsx)).toEqual(jsx);
  });

  // B23 - a route group "(x)" is not part of the URL, so this file serves /api/mcp (public).
  it("B23 handled: a route-group dir is matched by the url it serves", () => {
    const grouped = ["app/api/(bridge)/mcp/route.ts"];
    expect(isPublic("/api/mcp")).toBe(true);
    expect(listWith(grouped)).toEqual(grouped);
  });

  // B24 - without -z, git (core.quotePath default true) printed a non-ASCII path C-quoted with
  // its quotes, so both the prefix and the suffix test missed it. -z prints it raw.
  it("B24 handled: a non-ASCII route path is scanned (git ls-files -z)", () => {
    const raw = [`app/api/brain/caf${String.fromCharCode(0xe9)}/route.ts`];
    expect(listWith(raw)).toEqual(raw);
  });

  // B25 - "/auth" bypasses the session gate; the scan used to list only app/api.
  it("B25 handled: a route handler whose url isPublic() is scanned; a session-gated page route is not", () => {
    expect(isPublic("/auth/callback")).toBe(true);
    expect(isPublic("/settings/export")).toBe(false);
    expect(listWith(["app/auth/callback/route.ts", "app/settings/export/route.ts"])).toEqual([
      "app/auth/callback/route.ts",
    ]);
  });
});
