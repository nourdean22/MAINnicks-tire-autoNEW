/**
 * RED TEAM · the repo canary gates of the 2026-10-10 audit waves (1 and 2).
 *
 * Subjects: tests/repo/deep-link-targets, tests/contracts/nick-bridge-query-contract,
 * tests/repo/ui-v2-grammar (nothing animates at rest), tests/repo/a11y-chrome-contract,
 * tests/ai/prompt-block-fencing-gate, tests/repo/regen-telemetry-strict, and the anti-slop gate
 * (scripts/check-anti-slop.sh + lib/utils/doc-claim-audit.ts).
 *
 * HOW THE GATES ARE PROBED. Each gate lives inside a test file and scans the real tree, so it
 * cannot be fed a planted input directly, and a hand copy of its logic would prove only the copy.
 * `load()` and `gate()` below read the gate's OWN source at run time (TypeScript syntax tree),
 * transpile the named declarations or the `it(...)` body, and run that code with injected inputs:
 * a planted source string, or a virtual file overlaid on the real tree (`overlayFs`). Edit a gate
 * and this file runs the edit. If a gate is renamed or moved, `load`/`gate` throw and name it.
 * check-anti-slop.sh is run for real, by bash, in throwaway git repos under REDTEAM_FIXTURE_ROOT.
 *
 * HOW VERDICTS ARE LOCKED.
 *   · `it(...)`        a probe the gate handles correctly (a deny observed denied, an allow allowed).
 *   · `it.fails(...)`  a VERIFIED bypass or false positive: the body asserts the CORRECT verdict,
 *                      so it fails today and vitest reports it as an expected failure. When the gate
 *                      is fixed the body passes, vitest turns it red, and the fixer flips it to `it`.
 *   · every `it.fails` has an `OBSERVED` twin (`it`) that pins today's wrong verdict through the
 *     same harness call: the `it.fails` cannot be "passing" on a harness crash, because its twin
 *     proves the same call ran and returned that verdict.
 *
 * 2026-10-10 hardening pass: every bypass closed in a TEST-FILE gate was flipped to `it` (now a
 * locked DENY or ALLOW) and its OBSERVED twin deleted, because the twin pinned the old wrong verdict.
 * Still `it.fails`: the same-file partial fence (needs data flow). The check-anti-slop.sh and
 * doc-claim-audit.ts rows were closed the same way by R3-10 (the gates themselves were fixed);
 * REDTEAM_GATE_OVERRIDE="scripts/check-anti-slop.sh=<mutant>" runs the bash rows against a mutant.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import ts from "typescript";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { auditGateClaims } from "@/lib/utils/doc-claim-audit";
import { catalogue, queryHandlerKeys } from "../contracts/bridge-registry";

const APP = process.cwd(); // vitest runs from apps/statenour
// Per process: a fixed path let two sessions running this file delete each other's fixtures (EPERM, R3-10).
const FIXTURE_ROOT = process.env.REDTEAM_FIXTURE_ROOT ?? mkdtempSync(join(tmpdir(), "statenour-redteam-repo-canary-gates-"));
const req = createRequire(import.meta.url);

// Most of this file's ~120 gate probes are synchronous (they sweep the tree in-process), and the runner
// awaits synchronous tests back to back, so the worker's event loop does not turn between them. Measured
// 2026-10-15 with a lag probe: one 62.9 s stretch, ending inside the first anti-slop test, in which no timer
// fired and no runner message was read. Past vitest's 60 s RPC timeout that fires an unhandled
// `Timeout calling "onTaskUpdate"` the moment the stretch ends, and `pnpm test` exits 1 with 0 failing tests.
// One macrotask turn before each test lets the runner's messages through; no probe or assertion changes.
beforeEach(() => new Promise<void>((resolve) => setImmediate(resolve)));

// ─────────────────────────────────────────────────────────────────────────────
// Harness: run a gate's own code
// ─────────────────────────────────────────────────────────────────────────────

type Deps = Record<string, unknown>;
interface Verdict {
  red: boolean;
  message: string;
}

/**
 * Mutation runs only: REDTEAM_GATE_OVERRIDE="<gate path>=<fixed copy path>;..." reads a fixed copy of a
 * gate in its place, to prove each `it.fails` flips red once its bypass is closed.
 */
const OVERRIDE: Record<string, string> = Object.fromEntries(
  (process.env.REDTEAM_GATE_OVERRIDE ?? "").split(";").filter(Boolean).map((pair) => pair.split("=") as [string, string]),
);

function sourceOf(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(resolve(APP, OVERRIDE[file] ?? file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function declNames(n: ts.Node): string[] {
  if (ts.isFunctionDeclaration(n) && n.name) return [n.name.text];
  if (ts.isVariableStatement(n)) return n.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []));
  return [];
}

const stmtText = (sf: ts.SourceFile, n: ts.Node) => n.getText(sf).replace(/^export\s+/, "");

function compile<T>(code: string, deps: Deps, ret: string): T {
  const js = ts
    .transpileModule(code.replaceAll("import.meta.url", "__importMetaUrl"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    })
    .outputText.replace(/^export \{\};?\s*$/m, "");
  return new Function(...Object.keys(deps), `${js}\nreturn ${ret};`)(...Object.values(deps)) as T;
}

/** Named declarations (top level or nested; first by source order) from a gate file, live. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function load(file: string, names: string[], deps: Deps): Record<string, any> {
  const sf = sourceOf(file);
  const picked: ts.Node[] = [];
  (function walk(n: ts.Node): void {
    const own = declNames(n);
    if ((ts.isFunctionDeclaration(n) || ts.isVariableStatement(n)) && own.some((x) => names.includes(x))) {
      if (!picked.some((p) => declNames(p).some((x) => own.includes(x)))) picked.push(n);
    }
    ts.forEachChild(n, walk);
  })(sf);
  const missing = names.filter((x) => !picked.some((p) => declNames(p).includes(x)));
  if (missing.length) throw new Error(`${file}: declarations not found: ${missing.join(", ")} (gate moved: update the red-team file)`);
  picked.sort((a, b) => a.pos - b.pos);
  return compile(picked.map((n) => stmtText(sf, n)).join("\n"), deps, `{ ${names.join(", ")} }`);
}

/** The body of `it(title, fn)` plus the consts/functions declared beside it in its describe, as a runnable gate. */
function gate(file: string, title: string): (deps: Deps) => Verdict {
  const sf = sourceOf(file);
  let found: { body: string; prelude: string } | undefined;
  (function walk(n: ts.Node): void {
    if (
      !found &&
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "it" &&
      n.arguments.length >= 2 &&
      ts.isStringLiteralLike(n.arguments[0]) &&
      n.arguments[0].text === title
    ) {
      const fn = n.arguments[1];
      if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) throw new Error(`${file}: it("${title}") has no inline body`);
      const block = n.parent?.parent;
      const prelude =
        block && ts.isBlock(block)
          ? block.statements.filter((s) => ts.isVariableStatement(s) || ts.isFunctionDeclaration(s)).map((s) => stmtText(sf, s)).join("\n")
          : "";
      found = { body: fn.body.getText(sf), prelude };
    }
    ts.forEachChild(n, walk);
  })(sf);
  if (!found) throw new Error(`${file}: no it("${title}") (gate renamed: update the red-team file)`);
  const { body, prelude } = found;
  return (deps) => {
    const run = compile<() => unknown>(`${prelude}\nconst __gate = () => ${body};`, { expect, require: req, ...deps }, "__gate");
    try {
      run();
      return { red: false, message: "" };
    } catch (e) {
      // vitest truncates long arrays/strings in .message; the assertion's own actual/expected are whole.
      const err = e as { message?: string; actual?: unknown; expected?: unknown };
      const whole = "actual" in (err as object) ? `\nACTUAL: ${JSON.stringify(err.actual)}\nEXPECTED: ${JSON.stringify(err.expected)}` : "";
      return { red: true, message: `${err.message ?? String(e)}${whole}` };
    }
  };
}

/** The real fs, plus virtual files (paths relative to apps/statenour) visible to read/list/stat/exists. */
function overlayFs(virtual: Record<string, string>) {
  const norm = (p: string) => relative(APP, resolve(APP, String(p))).split(sep).join("/");
  const files = new Map(Object.entries(virtual).map(([k, v]) => [norm(k), v]));
  const parent = (f: string) => f.slice(0, f.lastIndexOf("/"));
  return {
    readFileSync: (p: string, enc?: BufferEncoding) => (files.has(norm(p)) ? files.get(norm(p)) : readFileSync(p, enc)),
    readdirSync: (d: string) => {
      const real = readdirSync(d);
      const extra = [...files.keys()].filter((f) => parent(f) === norm(d)).map((f) => f.slice(f.lastIndexOf("/") + 1));
      return [...real, ...extra.filter((e) => !real.includes(e))];
    },
    statSync: (p: string) => (files.has(norm(p)) ? { isDirectory: () => false, isFile: () => true } : statSync(p)),
    existsSync: (p: string) => files.has(norm(p)) || existsSync(p),
  };
}

function fixtureDir(...parts: string[]): string {
  const d = join(FIXTURE_ROOT, ...parts);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
}

function writeTree(root: string, files: Record<string, string>): void {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c, "utf8");
  }
}

describe("harness · the loaded code IS the gate", () => {
  it("load() and gate() refuse a declaration or test title that does not exist", () => {
    expect(() => load("tests/repo/deep-link-targets.test.ts", ["noSuchThing"], {})).toThrow(/declarations not found: noSuchThing/);
    expect(() => gate("tests/repo/deep-link-targets.test.ts", "no such test")).toThrow(/no it\("no such test"\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1 · tests/repo/deep-link-targets.test.ts (KNOWN_DEAD now empty)
// ─────────────────────────────────────────────────────────────────────────────

const DEEP = "tests/repo/deep-link-targets.test.ts";
const DEEP_NAMES = [
  "walk", "pageRoutes", "redirectSources", "matches", "HOLE", "LINK_KEY", "BDNICK_URL", "deepLinks", "resolves",
  "KNOWN_DEAD", "ROUTES", "SWEEP_DIRS", "SHIPPED", "treeLinks", "sweep",
];
const deepFs = (virtual: Record<string, string> = {}) => {
  const fs = overlayFs(virtual);
  return load(DEEP, DEEP_NAMES, {
    ts, existsSync, readFileSync: fs.readFileSync, readdirSync: fs.readdirSync, statSync: fs.statSync, join, relative, sep,
  });
};
const deep = deepFs();
/** The gate's exact per-file composition (sweep): links in the source that resolve to no page or redirect. */
const dead = (src: string): string[] => deep.deepLinks(src).filter((p: string) => !deep.resolves(p, deep.ROUTES));
const deepGate = gate(DEEP, "no deep link points at a page that does not exist");
const sweepWith = (virtual: Record<string, string>) => deepGate({ sweep: deepFs(virtual).sweep, KNOWN_DEAD: deep.KNOWN_DEAD });

describe("deep-link-targets · the gate fires", () => {
  it("POSITIVE CONTROL: the real gate passes the real tree and turns red on a planted lib file, naming it", () => {
    expect(deep.KNOWN_DEAD.size, "KNOWN_DEAD is empty after wave 2").toBe(0);
    expect(deepGate({ sweep: deep.sweep, KNOWN_DEAD: deep.KNOWN_DEAD })).toEqual({ red: false, message: "" });
    const v = sweepWith({ "lib/__redteam_probe__.ts": 'sendTelegram("Check cameras at bdnick.info/cameras");' });
    expect(v.red).toBe(true);
    expect(v.message).toContain("lib/__redteam_probe__.ts -> /cameras");
    // Two synchronous sweeps of the real tree: a few seconds on a quiet machine, over the
    // default 20 s on a saturated one (measured under an 8-core burner, 2026-10-15).
  }, 120_000);

  it.each([
    ["URL form", "sendTelegram(`Check at bdnick.info/cameras`);", ["/cameras"]],
    ["href key", 'const x = { href: "/nowhere-page" };', ["/nowhere-page"]],
    ["any *href key (navHref)", 'const x = { navHref: "/nowhere-page" };', ["/nowhere-page"]],
    ["href assignment", 'item.href = "/nowhere-page";', ["/nowhere-page"]],
    ["query string and hash stripped", '"https://bdnick.info/cameras?x=1#top"', ["/cameras"]],
    ["double slash", '"https://bdnick.info//cameras"', ["//cameras"]],
    ["trailing slash", '"https://bdnick.info/cameras/"', ["/cameras/"]],
    ["www host", '"https://www.bdnick.info/cameras"', ["/cameras"]],
    ["sibling of a real prefix (/systems vs /system)", '"https://bdnick.info/systems"', ["/systems"]],
    ["dead child under a real page", '"https://bdnick.info/system/cameras"', ["/system/cameras"]],
    ["case: /System is not /system (Next routes are case-sensitive)", '"https://bdnick.info/System"', ["/System"]],
    ["dead segment before a template hole", "`https://bdnick.info/cameras/${id}`", ["/cameras/*"]],
    ["redirect source deeper than the redirect (/mastery/x)", '"https://bdnick.info/mastery/x"', ["/mastery/x"]],
  ])("DENY · %s", (_label, src, expected) => {
    expect(dead(src)).toEqual(expected);
  });

  it.each([
    ["real page", "`bdnick.info/system/camera`"],
    ["dynamic page", "href: `/decisions/${dec.id}`"],
    ["query string on a real page", 'href: "/stats?tab=body"'],
    ["redirect source", '"https://bdnick.info/mastery"'],
    ["catch-all redirect source", '"https://bdnick.info/relationships/anything/deep"'],
    ["api path", '"https://bdnick.info/api/inngest"'],
    ["whole-line comment", "  // bdnick.info/no-such-page in a comment"],
    ["block comment opening a line", "/* bdnick.info/no-such-page */\nconst a = 1;"],
    ["root", '"https://bdnick.info/"'],
    ["hole as a whole segment (cannot be known)", "`https://bdnick.info/${page}`"],
  ])("ALLOW · %s", (_label, src) => {
    expect(dead(src)).toEqual([]);
  });
});

/**
 * Closed 2026-10-10 (were BYPASS rows): [label, source, the dead link the gate reports].
 * `link:` / `deepLink:` / `url:` are not hypothetical — lib/brain/cross-system-nudge.ts (link:),
 * lib/inngest/functions/cron-heartbeat.ts (deepLink:) and morning-brief.ts (url:) emit 40+ page
 * paths in those keys; all resolve (swept 2026-10-10).
 */
const DEEP_CLOSED: Array<[string, string, string]> = [
  ["`link:` key (cross-system-nudge / brain-insights / pulse-digest form)", 'return { severity: "warning", link: "/cameras" };', "/cameras"],
  ["`deepLink:` key (cron-heartbeat / quality-bench form)", 'await push({ deepLink: "/cameras" });', "/cameras"],
  ["`url:` key (morning-brief / task-due-reminder form)", 'await notify({ url: "/cameras" });', "/cameras"],
  ["JSX attribute in braces", 'return <a href={"/cameras"}>x</a>;', "/cameras"],
  ["base-URL const + path", 'const BASE = "https://bdnick.info";\nsend(`${BASE}/cameras`);', "/cameras"],
  ["upper-case host", '"https://BDNICK.INFO/cameras"', "/cameras"],
];

describe("deep-link-targets · link forms the gate now reads", () => {
  it.each(DEEP_CLOSED)("DENY · %s → reported", (_label, src, expected) => {
    expect(dead(src)).toContain(expected);
  });
});

/** Closed 2026-10-10: the sweep walked lib/**.ts(x) only. app/api/cron/* routes emit the same operator deep links. */
const DEEP_SCOPE: Array<[string, string]> = [
  ["app/api/cron/__redteam_probe__.ts", 'await alert({ text: "see bdnick.info/cameras" });'],
  ["components/__redteam_probe__.tsx", 'export const L = () => <a href="/nowhere-page">x</a>;'],
  ["features/__redteam_probe__.tsx", 'export const L = () => <a href="/nowhere-page">x</a>;'],
  ["lib/__redteam_probe__.mjs", 'export const msg = "see bdnick.info/cameras";'],
];

describe("deep-link-targets · files the sweep now reads", () => {
  it.each(DEEP_SCOPE)("DENY · a dead link in %s → gate red, naming it", (file, src) => {
    const v = sweepWith({ [file]: src });
    expect(v.red).toBe(true);
    expect(v.message).toContain(file);
  });
});

/** Closed 2026-10-10 (were FALSE POSITIVE rows): [label, source]. Each is a mention or an unknowable hole. */
const DEEP_FP: Array<[string, string]> = [
  ["trailing line comment (mention, not a link)", 'sendTelegram(text); // was bdnick.info/cameras before the move'],
  ["mid-line block comment (mention)", 'const t = 1; /* old bdnick.info/cameras */'],
  ["whole-segment template hole holding a call", "send(`https://bdnick.info/${encodeURIComponent(page)}`);"],
  ["whole-segment template hole with spaces", "send(`https://bdnick.info/${ page }`);"],
];

describe("deep-link-targets · mentions and holes are not dead links", () => {
  it.each(DEEP_FP)("ALLOW · %s → green", (_label, src) => {
    expect(dead(src)).toEqual([]);
  });
});

describe("deep-link-targets · the redirect table parser", () => {
  const routesFrom = (cfg: string) =>
    load(DEEP, ["redirectSources"], { ts, readFileSync: (p: string, e: BufferEncoding) => (p === "next.config.ts" ? cfg : readFileSync(p, e)) }).redirectSources();
  const headersThenRedirects =
    "export default {\n  headers: async () => [{ source: \"/:path*\", headers: [] }],\n  redirects: async () => [{ source: \"/old\", destination: \"/\" }],\n};";

  it("ALLOW · headers() before redirects: its /:path* is not read as a redirect", () => {
    expect(routesFrom(headersThenRedirects)).toEqual([["old"]]);
  });

  it("ALLOW · the method form `async redirects() { return [...] }` is read too", () => {
    expect(routesFrom('export default { async redirects() { return [{ source: "/old/:id", destination: "/" }]; } };')).toEqual([["old", ":id"]]);
  });

  it("DENY · a config with no redirects block throws (fails closed)", () => {
    expect(() => routesFrom("export default { async headers() { return []; } };")).toThrow(/no redirects block/);
  });

  it("DENY (closed 2026-10-10) · a mention of `redirects:` above headers() does not blind the gate", () => {
    const routes = routesFrom(`// see redirects: further down\n${headersThenRedirects}`);
    expect(routes).toEqual([["old"]]);
    expect(deep.resolves("/cameras", routes)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 · tests/contracts/nick-bridge-query-contract.test.ts (KNOWN_PENDING shrunk)
// ─────────────────────────────────────────────────────────────────────────────

const BRIDGE = "tests/contracts/nick-bridge-query-contract.test.ts";
const NICK_REGISTRY = resolve(APP, "../nickstire/server/routes/nour-os-query.ts");
const BRIDGE_NAMES = [
  "QUERY_HELPERS", "BATCH_HELPER", "BRIDGE_ENDPOINT", "BRIDGE_CLIENT", "SCAN_DIRS", "DYNAMIC_BY_DESIGN", "KNOWN_PENDING",
  "walk", "checkerFor", "unwrap", "scanSource", "scanCallsites", "localImports", "unexcused", "offendersOf", "liveHandlers",
];
const bridgeWith = (fs: ReturnType<typeof overlayFs>, deps: Deps = {}) =>
  load(BRIDGE, BRIDGE_NAMES, {
    ts, dirname, join, relative, resolve, sep, NICK_REGISTRY, STATENOUR_ROOT: APP, queryHandlerKeys,
    existsSync: fs.existsSync, readFileSync: fs.readFileSync, readdirSync: fs.readdirSync, statSync: fs.statSync,
    ...deps,
  });
const bridge = bridgeWith(overlayFs({}));
type Scan = { hits: Array<{ query: string; file: string; line: number }>; unresolved: Array<{ file: string; arg: string }> };
let realScanCache: Scan | undefined;
const realScan = (): Scan => (realScanCache ??= bridge.scanCallsites());
/** The real tree's scan plus one or more planted files: what scanCallsites returns with those files added. */
const plantedScan = (files: Record<string, string>) => (): Scan => {
  const out: Scan = { hits: [...realScan().hits], unresolved: [...realScan().unresolved] };
  for (const [f, src] of Object.entries(files)) {
    const s = bridge.scanSource(f, src) as Scan;
    out.hits.push(...s.hits);
    out.unresolved.push(...s.unresolved);
  }
  return out;
};
const offendersGate = gate(BRIDGE, "every bridge callsite targets a live handler or a catalogued newly-required query");
const blindGate = gate(BRIDGE, "every bridge callsite names its query where this guard can read it");
const engineGate = gate(BRIDGE, "every query the autonomous engine's rules read is a live handler, with no exemption");
const pendingGate = gate(BRIDGE, "KNOWN_PENDING only lists queries nickstire has NOT shipped (promote when shipped)");
/** Both call-site gates over the real tree plus `files`: red if EITHER fires. */
const bridgeVerdict = (files: Record<string, string>): Verdict => {
  const scanCallsites = plantedScan(files);
  const a = offendersGate({ liveHandlers: bridge.liveHandlers, scanCallsites, offendersOf: bridge.offendersOf });
  const b = blindGate({ unexcused: bridge.unexcused, scanCallsites });
  return { red: a.red || b.red, message: `${a.message}\n${b.message}` };
};
const PROBE = "lib/__redteam_probe__.ts";

describe("nick-bridge-query-contract · the gate fires", () => {
  it("POSITIVE CONTROL (end to end): a planted lib file read by the REAL scanCallsites turns the gate red, naming the query and file", () => {
    const fs = overlayFs({ [PROBE]: 'import { queryNick } from "@/lib/nickstire/query";\nawait queryNick("no_such_handler");' });
    const live = bridgeWith(fs);
    const v = offendersGate({ liveHandlers: live.liveHandlers, scanCallsites: live.scanCallsites, offendersOf: live.offendersOf });
    expect(v.red).toBe(true);
    expect(v.message).toContain('"no_such_handler"  @ ./lib/__redteam_probe__.ts:2');
  }, 120_000);

  it("the real tree is green on both call-site gates (the planted-scan shortcut adds nothing on its own)", () => {
    expect(bridgeVerdict({})).toEqual({ red: false, message: "\n" });
  }, 120_000);

  it.each([
    ["a dead literal", 'await queryNick("no_such_handler");', "no_such_handler"],
    ["optional call", 'await queryNick?.("no_such_handler");', "no_such_handler"],
    ["batch entry", 'await queryNickBatch([{ query: "no_such_handler" }]);', "no_such_handler"],
    ["dead name in a same-file const", 'const Q = "no_such_handler";\nawait fetchBridge(Q);', "no_such_handler"],
    ["template literal with a hole", "await queryNick(`revenue_${period}`);", "`revenue_${period}`"],
    ["string concatenation", 'await queryNick("revenue_" + "today");', '"revenue_" + "today"'],
    ["property of a const map", 'const QUERIES = { r: "revenue_today" } as const;\nawait queryNick(QUERIES.r);', "QUERIES.r"],
    ["comma-operator callee", 'await (0, queryNick)("no_such_handler");', "queryNick"],
    ["tagged template", "await queryNick`no_such_handler`;", "queryNick"],
    ["helper re-exported as a value", 'import { queryNick } from "@/lib/nickstire/query";\nexport const ask = queryNick;', "queryNick"],
    ["wrapper whose default parameter is the name", 'async function r(q = "no_such_handler") { return queryNick(q); }\nawait r();', "r()"],
  ])("DENY · %s → red, naming it", (_label, src, named) => {
    const v = bridgeVerdict({ [PROBE]: src });
    expect(v.red).toBe(true);
    expect(v.message).toContain(named);
  }, 120_000);

  it.each([
    ["a live handler", 'await queryNick("revenue_today");'],
    ["a KNOWN_PENDING name outside the engine", 'await queryNick("quotes_stale");'],
    ["the name only quoted in prose", '// was queryNick("no_such_handler")\nconst doc = "queryNick(no_such_handler)";'],
    ["`quotes_pending`, removed from KNOWN_PENDING because nickstire shipped it", 'await queryNick("quotes_pending");'],
  ])("ALLOW · %s → green", (_label, src) => {
    expect(bridgeVerdict({ [PROBE]: src }).red).toBe(false);
  }, 120_000);

  const engineFixture = (extra: string) =>
    ["revenue_today", "callbacks_pending", "leads_urgent", "shop_pulse", "quotes_pending"].map((q) => `await queryNick("${q}");`).join("\n") + `\n${extra}`;
  it("DENY · the engine gives KNOWN_PENDING no exemption: a pending name in autonomous-engine.ts is red", () => {
    const scanCallsites = () => bridge.scanSource("lib/brain/autonomous-engine.ts", engineFixture('await queryNick("quotes_stale");'));
    const v = engineGate({ liveHandlers: bridge.liveHandlers, scanCallsites, localImports: bridge.localImports });
    expect(v.red).toBe(true);
    expect(v.message).toContain("quotes_stale");
  });
  it("ALLOW · the engine fixture with only live names is green", () => {
    const scanCallsites = () => bridge.scanSource("lib/brain/autonomous-engine.ts", engineFixture('await queryNick("bookings_pending_stale");'));
    expect(engineGate({ liveHandlers: bridge.liveHandlers, scanCallsites, localImports: bridge.localImports })).toEqual({ red: false, message: "" });
  });

  it("DENY · a shipped name left in KNOWN_PENDING is red (the allow-list shrinks when nickstire ships)", () => {
    const v = pendingGate({ liveHandlers: bridge.liveHandlers, catalogue, KNOWN_PENDING: new Set([...bridge.KNOWN_PENDING, "revenue_today"]) });
    expect(v.red).toBe(true);
    expect(v.message).toContain("revenue_today");
  });
});

/** Re-export: file A renames the helper on its way out; file B imports the new name and calls it. */
const REEXPORT = {
  "lib/__redteam_a__.ts": 'export { queryNick as ask } from "@/lib/nickstire/query";',
  "lib/__redteam_b__.ts": 'import { ask } from "@/lib/__redteam_a__";\nawait ask("no_such_handler");',
};
const RAW_FETCH = {
  [PROBE]:
    'const res = await fetch(`${url}/api/nour-os/query`, {\n  method: "POST",\n  headers: { "x-sync-key": key },\n  body: JSON.stringify({ query: "no_such_handler" }),\n});',
};
const ENGINE_VIA_HELPER = {
  "lib/brain/__redteam_engine_reads__.ts": 'import { queryNick } from "@/lib/nickstire/query";\nexport function readStale() { return queryNick("quotes_stale"); }',
};

/** The engine imports the helper (one hop): what scanCallsites returns, and the fs localImports reads it from. */
const ENGINE_SRC =
  ["revenue_today", "callbacks_pending", "leads_urgent", "shop_pulse", "quotes_pending", "bookings_pending_stale"]
    .map((q) => `await queryNick("${q}");`)
    .join("\n") + '\nimport { readStale } from "@/lib/brain/__redteam_engine_reads__";\nawait readStale();';
const engineReadsThroughHelper = () => {
  const engine = bridge.scanSource("lib/brain/autonomous-engine.ts", ENGINE_SRC) as Scan;
  const helper = bridge.scanSource(Object.keys(ENGINE_VIA_HELPER)[0], Object.values(ENGINE_VIA_HELPER)[0]) as Scan;
  return { hits: [...engine.hits, ...helper.hits], unresolved: [...engine.unresolved, ...helper.unresolved] };
};

describe("nick-bridge-query-contract · bypasses closed 2026-10-10", () => {
  it("DENY · a helper renamed by `export { queryNick as ask }` and called from another file → red, naming it", () => {
    const v = bridgeVerdict(REEXPORT);
    expect(v.red).toBe(true);
    expect(v.message).toContain("queryNick as ask");
  }, 120_000);

  it("DENY · a raw fetch to /api/nour-os/query that skips queryNick → red", () => {
    const v = bridgeVerdict(RAW_FETCH);
    expect(v.red).toBe(true);
    expect(v.message).toContain("/api/nour-os/query");
  }, 120_000);

  it("DENY · an engine rule that reads a KNOWN_PENDING name through a helper the engine imports → engine gate red", () => {
    // The original BYPASS row checked the MAIN gate with an engine that never imported the helper, which
    // no fix could turn red; the engine gate, given an engine that imports it, is the subject.
    const live = bridgeWith(overlayFs({ "lib/brain/autonomous-engine.ts": ENGINE_SRC, ...ENGINE_VIA_HELPER }));
    const v = engineGate({ liveHandlers: bridge.liveHandlers, scanCallsites: engineReadsThroughHelper, localImports: live.localImports });
    expect(v.red).toBe(true);
    expect(v.message).toContain("quotes_stale");
  }, 120_000);
  it("ALLOW · the same helper NOT imported by the engine keeps the KNOWN_PENDING exemption (main gate green)", () => {
    expect(bridgeVerdict(ENGINE_VIA_HELPER).red).toBe(false);
  }, 120_000);

  it("DENY · a KNOWN_PENDING entry the contract pre-flight never probes as newly-required → red", () => {
    const v = pendingGate({ liveHandlers: bridge.liveHandlers, catalogue, KNOWN_PENDING: new Set([...bridge.KNOWN_PENDING, "typo_query"]) });
    expect(v.red).toBe(true);
    expect(v.message).toContain("typo_query");
  });
  it("today KNOWN_PENDING equals the pre-flight newly-required tier (the invariant the gate now enforces)", () => {
    const newlyRequired = catalogue().filter((e) => e.tier === "newly-required").map((e) => e.query).sort();
    expect([...bridge.KNOWN_PENDING].sort()).toEqual(newlyRequired);
    expect(pendingGate({ liveHandlers: bridge.liveHandlers, catalogue, KNOWN_PENDING: bridge.KNOWN_PENDING })).toEqual({ red: false, message: "" });
  });
});

describe("nick-bridge-query-contract · the registry parser (liveHandlers)", () => {
  const registry = (src: string) => {
    const dir = fixtureDir("bridge-registry");
    const file = join(dir, "nour-os-query.ts");
    writeFileSync(file, src, "utf8");
    return load(BRIDGE, ["liveHandlers"], { existsSync, readFileSync, queryHandlerKeys, NICK_REGISTRY: file }).liveHandlers() as Set<string>;
  };
  const FIXTURE =
    "export const QUERY_HANDLERS: Record<string, QueryHandler> = {\n" +
    '  "revenue_today": async () => ({}),\n' +
    '  // "retired_handler": async () => ({}),   (removed 2026-10-01)\n' +
    "  cars_today: async () => ({}),\n" +
    "};\n" +
    'const FORMATTERS = { "not_a_handler": async (x: unknown) => String(x) };\n';

  it("ALLOW · a quoted async handler in QUERY_HANDLERS is live", () => {
    expect(registry(FIXTURE).has("revenue_today")).toBe(true);
  });
  it("DENY (closed 2026-10-10) · a commented-out handler, or a key outside QUERY_HANDLERS, is not live", () => {
    const live = registry(FIXTURE);
    expect([live.has("retired_handler"), live.has("not_a_handler")]).toEqual([false, false]);
  });
  it("ALLOW (closed 2026-10-10) · an unquoted handler key (cars_today: async) is live", () => {
    expect(registry(FIXTURE).has("cars_today")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 · tests/repo/ui-v2-grammar.test.ts · nothing animates at rest
// ─────────────────────────────────────────────────────────────────────────────

const GRAMMAR = "tests/repo/ui-v2-grammar.test.ts";
const effects = readFileSync(join(APP, "app/styles/effects.css"), "utf8");
const base = readFileSync(join(APP, "app/styles/base.css"), "utf8");
const tokens = readFileSync(join(APP, "app/styles/tokens.css"), "utf8");
const { UI_FILES } = load(GRAMMAR, ["uiFiles", "UI_FILES"], { readdirSync, statSync, join, relative, ROOT: APP });
const sheetsGate = gate(GRAMMAR, "only working-state selectors loop: live pulse, loading skeleton, running tool");
const classGate = gate(GRAMMAR, "no component applies a retired at-rest animation class");
const withEffects = (css: string) => sheetsGate({ effects: `${effects}\n${css}\n`, base, tokens });
const withComponent = (file: string, append: string) =>
  classGate({ UI_FILES, read: (p: string) => readFileSync(join(APP, p), "utf8") + (p === file ? `\n${append}\n` : "") });

describe("ui-v2-grammar · nothing animates at rest", () => {
  it("POSITIVE CONTROL: the real sheets are green; a retired breathe re-added to effects.css is red, naming it", () => {
    expect(sheetsGate({ effects, base, tokens })).toEqual({ red: false, message: "" });
    const v = withEffects(".pin-stale-breathe { animation: breathe 3s ease-in-out infinite; }");
    expect(v.red).toBe(true);
    expect(v.message).toContain(".pin-stale-breathe");
  });

  it.each([
    ["inside @media", "@media (prefers-reduced-motion: no-preference) { .rt-rest { animation: breathe 3s infinite; } }"],
    ["inside @layer", "@layer components { .rt-rest { animation: breathe 3s infinite; } }"],
    ["longhand iteration count", ".rt-rest { animation-name: breathe; animation-iteration-count: infinite; }"],
    ["minified", ".rt-rest{animation:breathe 3s infinite}"],
    ["nested rule", ".rt-parent { color: red; .rt-child { animation: breathe 3s infinite; } }"],
    ["base.css too", null],
  ])("DENY · at-rest loop %s → red", (_label, css) => {
    const v = css === null ? sheetsGate({ effects, base: `${base}\n.rt-rest { animation: breathe 3s infinite; }`, tokens }) : withEffects(css);
    expect(v.red).toBe(true);
  });

  it.each([
    ["a finite animation", ".rt-once { animation: fade-in 200ms ease-out 1; }"],
    ["a @keyframes block (stripped before the scan)", "@keyframes rt-k { from { opacity: 0 } to { opacity: 1 } }"],
    ["infinite only in a comment", "/* .rt-rest { animation: breathe 3s infinite; } */"],
  ])("ALLOW · %s → green", (_label, css) => {
    expect(withEffects(css)).toEqual({ red: false, message: "" });
  });

  it("DENY · a retired class applied through a cn() conditional in a pinned file → red", () => {
    const v = withComponent("components/missions/mission-task-row.tsx", 'const c = cn("row", isDoing && "animate-breath");');
    expect(v.red).toBe(true);
    expect(v.message).toContain("animate-breath");
  });
});

/** Closed 2026-10-10: [label, css appended to effects.css]. */
const SHEET_CLOSED: Array<[string, string]> = [
  ["Tailwind v4 theme animation token (`--animate-*` registers an `animate-*` utility)", "@theme { --animate-breathe: breathe 3s ease-in-out infinite; }"],
  ["a huge finite iteration count", ".rt-rest { animation: breathe 3s ease-in-out 99999; }"],
];
/** Closed 2026-10-10: [label, component file, appended source]. Tailwind's built-in loops and inline styles never reach the sheets. */
const CLASS_CLOSED: Array<[string, string, string]> = [
  ["Tailwind built-in `animate-bounce` at rest (the live one in components/actions/mode-learn.tsx was removed by R3-06)", "components/missions/streak-badge.tsx", '<div className="animate-bounce">Time\'s up</div>'],
  ["Tailwind built-in `animate-pulse` on a stale pin", "components/brain/pinned-context-panel.tsx", 'className={cn("dot", stale && "animate-pulse")}'],
  ["arbitrary `animate-[..._infinite]`", "components/missions/streak-badge.tsx", '<span className="animate-[breathe_3s_ease-in-out_infinite]" />'],
  ["inline style loop", "components/missions/mission-task-row.tsx", '<span style={{ animation: "breathe 3s ease-in-out infinite" }} />'],
];

describe("ui-v2-grammar · loops the at-rest gate now sees", () => {
  it.each(SHEET_CLOSED)("DENY · %s → red", (_label, css) => {
    expect(withEffects(css).red).toBe(true);
  });
  it.each(CLASS_CLOSED)("DENY · %s → red, naming the file", (_label, file, src) => {
    const v = withComponent(file, src);
    expect(v.red).toBe(true);
    expect(v.message).toContain(file);
  });
  it("ALLOW - the real tree is green (KNOWN_AT_REST is empty since R3-06)", () => {
    expect(withComponent("components/missions/streak-badge.tsx", "")).toEqual({ red: false, message: "" });
  });
});

describe("ui-v2-grammar · names and mentions are not loops (closed 2026-10-10)", () => {
  it("ALLOW · a FINITE animation whose keyframes are named infinite-* → green", () => {
    expect(withEffects(".rt-marquee { animation: infinite-scroll 20s linear 1; }")).toEqual({ red: false, message: "" });
  });
  it("ALLOW · a comment that only names the retired class → green", () => {
    expect(withComponent("components/missions/streak-badge.tsx", "// the animate-breath loop was retired 2026-10-10 (09-F14)")).toEqual({ red: false, message: "" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 · tests/repo/a11y-chrome-contract.test.ts
// ─────────────────────────────────────────────────────────────────────────────

const A11Y = "tests/repo/a11y-chrome-contract.test.ts";
const a11y = load(A11Y, ["ROOT", "read", "walk", "SOURCE_FILES"], {
  join, readFileSync, readdirSync, statSync, relative, __dirname: join(APP, "tests", "repo"),
});
const SOURCE_FILES = a11y.SOURCE_FILES as string[];
const focusGate = gate(A11Y, "no source file carries focus-visible:outline-gold or focus-visible:shadow-none");
const smoothGate = gate(A11Y, "no smooth-scroll literal outside the shared scrollBehavior() helper");
/** `read` and `code` as the gate defines them, over the real tree plus a line appended to (or a new) file. */
const a11yFs = (file: string, append: string) => {
  const read = (p: string) => (existsSync(join(APP, p)) ? readFileSync(join(APP, p), "utf8") : "") + (p === file ? `\n${append}\n` : "");
  const { code } = load(A11Y, ["strip", "code"], { read });
  return { ts, read, code, SOURCE_FILES: SOURCE_FILES.includes(file) ? SOURCE_FILES : [...SOURCE_FILES, file] };
};
const focusWith = (file: string, append: string) => focusGate(a11yFs(file, append));
const smoothWith = (file: string, append: string) => smoothGate(a11yFs(file, append));
const ANY_TSX = "components/ui/glass-card.tsx";

describe("a11y-chrome-contract · the gates fire", () => {
  it("POSITIVE CONTROL: real tree green; a planted dead focus utility and a planted smooth scroll each turn red, naming the file", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(500);
    expect(focusGate(a11yFs(ANY_TSX, ""))).toEqual({ red: false, message: "" });
    expect(smoothGate(a11yFs(ANY_TSX, ""))).toEqual({ red: false, message: "" });
    const f = focusWith(ANY_TSX, '<button className="focus-visible:outline-gold" />');
    expect(f.red).toBe(true);
    expect(f.message).toContain(ANY_TSX);
    const s = smoothWith(ANY_TSX, 'ref.current?.scrollIntoView({ behavior: "smooth" });');
    expect(s.red).toBe(true);
    expect(s.message).toContain(ANY_TSX);
  });

  it.each([
    ["variant + opacity", 'className="md:focus-visible:outline-gold/50"'],
    ["shadow-none", 'className="focus-visible:shadow-none"'],
    ["important modifier", 'className="focus-visible:outline-gold!"'],
  ])("DENY · focus %s → red", (_label, src) => {
    expect(focusWith(ANY_TSX, src).red).toBe(true);
  });

  it.each([
    ["single quotes", "el.scrollTo({ top: 0, behavior: 'smooth' });"],
    ["cast", 'el.scrollTo({ top: 0, behavior: "smooth" as ScrollBehavior });'],
    ["in a .ts file", 'export const go = (el: Element) => el.scrollIntoView({ behavior: "smooth" });'],
  ])("DENY · smooth scroll %s → red", (label, src) => {
    expect(smoothWith(label === "in a .ts file" ? "lib/ui/__redteam_probe__.ts" : ANY_TSX, src).red).toBe(true);
  });

  it.each([
    ["the helper call", "el.scrollIntoView({ behavior: scrollBehavior() });"],
    ["a comment", '// never write behavior: "smooth" here'],
    ["auto", 'el.scrollTo({ top: 0, behavior: "auto" });'],
  ])("ALLOW · smooth-scroll gate · %s → green", (_label, src) => {
    expect(smoothWith(ANY_TSX, src)).toEqual({ red: false, message: "" });
  });
});

/** Closed 2026-10-10: [label, file, appended source]. The stale chat-v2 exemptions were deleted. */
const FOCUS_CLOSED: Array<[string, string, string]> = [
  ["features/chat-v2/components/chat-composer.tsx (its stale OWNED_ELSEWHERE exemption is gone)", "features/chat-v2/components/chat-composer.tsx", '<textarea className="focus-visible:outline-gold" />'],
  ["class string in a .ts file", "lib/ui/__redteam_probe__.ts", 'export const ring = "focus-visible:outline-gold";'],
  ["arbitrary-value spelling of the same gold outline", ANY_TSX, 'className="focus-visible:outline-[var(--gold)]"'],
];
const SMOOTH_CLOSED: Array<[string, string, string]> = [
  ["features/chat-v2/components/chat-island.tsx (its stale OWNED_ELSEWHERE exemption is gone)", "features/chat-v2/components/chat-island.tsx", 'end.current?.scrollIntoView({ behavior: "smooth" });'],
  ["backtick literal", ANY_TSX, "el.scrollIntoView({ behavior: `smooth` });"],
  ["quoted key", ANY_TSX, 'el.scrollTo({ "behavior": "smooth", top: 0 });'],
  ["named const", ANY_TSX, 'const SMOOTH = "smooth" as const;\nel.scrollTo({ top: 0, behavior: SMOOTH });'],
];

describe("a11y-chrome-contract · bypasses closed 2026-10-10", () => {
  it.each(FOCUS_CLOSED)("DENY · focus · %s → red, naming the file", (_label, file, src) => {
    const v = focusWith(file, src);
    expect(v.red).toBe(true);
    expect(v.message).toContain(file);
  });
  it.each(SMOOTH_CLOSED)("DENY · smooth · %s → red, naming the file", (_label, file, src) => {
    const v = smoothWith(file, src);
    expect(v.red).toBe(true);
    expect(v.message).toContain(file);
  });
  it("ALLOW · a comment that only names the dead utility → green (the focus gate reads code(), not raw source)", () => {
    expect(focusWith(ANY_TSX, "// do not use focus-visible:shadow-none: the unlayered :focus-visible rule overrides it")).toEqual({ red: false, message: "" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5 · tests/ai/prompt-block-fencing-gate.test.ts
// ─────────────────────────────────────────────────────────────────────────────

const FENCE = "tests/ai/prompt-block-fencing-gate.test.ts";
const BARE_RENDER = "export async function render() {\n  const rows = await prisma.brainMemory.findMany({ take: 5 });\n  return rows.map((m) => `- ${m.content}`).join(\"\\n\");\n}\n";
/** Producer modules: [spec tail, source]. All are imported by the fixture brain-context.ts. */
const PRODUCERS: Record<string, string> = {
  "rt-bare": BARE_RENDER,
  "rt-fenced": BARE_RENDER.replace("`- ${m.content}`", 'fenceContent("rt", "memory_recall", m.content)'),
  "rt-numbers": "export async function render() { const n = await countThings(); return `count ${n}`; }\n",
  "rt-relative": BARE_RENDER,
  "rt-single": BARE_RENDER,
  "rt-multiline": BARE_RENDER,
  "rt-comment-fence": `// TODO: wrap in fenceContent(...) before this ships\n${BARE_RENDER}`,
  "rt-partial-fence":
    BARE_RENDER.replace("`- ${m.content}`", 'fenceContent("rt", "memory_recall", m.content)') +
    "export async function render2() {\n  const rows = await prisma.brainMemory.findMany({ take: 5 });\n  return rows.map((m) => m.content).join(\"\\n\");\n}\n",
  "rt-raw-sql": 'export async function render() {\n  const rows = await prisma.$queryRaw<Array<{ content: string }>>`SELECT content FROM "BrainMemory" LIMIT 5`;\n  return rows.map((m) => m.content).join("\\n");\n}\n',
  "rt-db-alias": BARE_RENDER.replace("await prisma.brainMemory", "await db.brainMemory").replace("export async", "const db = prisma;\nexport async"),
  "rt-indirect": 'import { loadRows } from "@/lib/brain/rt-indirect-rows";\nexport async function render() { return (await loadRows()).map((m) => m.content).join("\\n"); }\n',
  "rt-indirect-rows": "export async function loadRows() { return prisma.brainMemory.findMany({ take: 5 }); }\n",
  "rt-comment-mention": "// numbers only: this module never reads prisma.brainMemory\nexport function render(n: number) { return `streak ${n}`; }\n",
};
const CONSUMER_SRC = [
  'import { render as a } from "@/lib/brain/rt-bare";',
  'import { render as b } from "@/lib/brain/rt-fenced";',
  'import { render as c } from "@/lib/brain/rt-numbers";',
  'import { render as d } from "../../brain/rt-relative";',
  "import { render as e } from '@/lib/brain/rt-single';",
  'const { render: f } = await import(\n  "@/lib/brain/rt-multiline"\n);',
  'import { render as g } from "@/lib/brain/rt-comment-fence";',
  'import { render as h, render2 } from "@/lib/brain/rt-partial-fence";',
  'import { render as i } from "@/lib/brain/rt-raw-sql";',
  'import { render as j } from "@/lib/brain/rt-db-alias";',
  'import { render as k } from "@/lib/brain/rt-indirect";',
  'import { render as l } from "@/lib/brain/rt-comment-mention";',
].join("\n");
/** Tool files: one scenario per file. */
const TOOL_HEAD = 'import { tool } from "ai";\nexport const tools = {\n';
const FENCED_TOOL = '  readFenced: tool({\n    execute: async () => (await prisma.brainMemory.findMany()).map((m) => fenceContent("readFenced", "memory_recall", m.content)),\n  }),\n';
const bareTool = (head: string) => `${head}\n    execute: async () => (await prisma.brainMemory.findMany()).map((m) => m.content),\n  }),\n`;
const TOOLS: Record<string, string> = {
  "t-positive.ts": `${TOOL_HEAD}${bareTool("  readRows: tool({")}};\n`,
  "t-fenced.ts": `${TOOL_HEAD}${FENCED_TOOL}};\n`,
  "t-underscore.ts": `${TOOL_HEAD}${FENCED_TOOL}${bareTool("  read_rows: tool({")}};\n`,
  "t-generic.ts": `${TOOL_HEAD}${FENCED_TOOL}${bareTool("  readMore: tool<{ q: string }, string[]>({")}};\n`,
  "t-toplevel.ts": `import { tool } from "ai";\nexport const readTop = tool({\n    execute: async () => (await prisma.brainMemory.findMany()).map((m) => m.content),\n});\n`,
  "t-comment-fence.ts": `${TOOL_HEAD}${bareTool("  readRows: tool({ // fenceContent( is a TODO")}};\n`,
};

const fenceRoot = (() => {
  const root = fixtureDir("fencing");
  writeTree(root, {
    "lib/services/chat/brain-context.ts": CONSUMER_SRC,
    ...Object.fromEntries(Object.entries(PRODUCERS).map(([k, v]) => [`lib/brain/${k}.ts`, v])),
    ...Object.fromEntries(Object.entries(TOOLS).map(([k, v]) => [`lib/ai/tools/${k}`, v])),
  });
  return root;
})();
const fence = load(
  FENCE,
  [
    "CONSUMER", "printer", "parse", "topLevel", "reachCode", "libFile", "ALLOWLIST", "INTERPOLATES", "importedLibModuleKinds",
    "importedLibModules", "resolveModule", "readingExportsCache", "readingExports", "readsThroughImport", "runtimeImported", "modules",
    "KNOWN_UNFENCED", "TOOLS_DIR", "READS_ROWS", "analyzeToolSource", "TOOL_ALLOWLIST", "toolAnalyses", "toolKey", "subjects",
  ],
  { ts, APP_ROOT: fenceRoot, readFileSync, existsSync, readdirSync, dirname, join, relative, resolve, sep },
);
const producerGate = gate(FENCE, "no producer that reads memory or chat rows renders without fenceContent, unless allowlisted with a reason");
const toolGate = gate(FENCE, "no subject tool is unfenced unless allowlisted by name with the categories it reads");
type Mod = { spec: string; file: string | null };
/** The real producer gate over the fixture consumer, restricted to the module(s) one probe planted. */
const producerVerdict = (tail: string) =>
  producerGate({
    ALLOWLIST: fence.ALLOWLIST,
    KNOWN_UNFENCED: fence.KNOWN_UNFENCED,
    modules: (fence.modules as Mod[]).filter((m) => m.spec.endsWith(`/${tail}`)),
  });
type Tool = { file: string; tool: string };
const toolVerdict = (file: string) =>
  toolGate({ TOOL_ALLOWLIST: fence.TOOL_ALLOWLIST, toolKey: fence.toolKey, subjects: (fence.subjects as Tool[]).filter((t) => t.file === file) });

describe("prompt-block-fencing-gate · the gates fire", () => {
  it("the fixture consumer is what the gate enumerated (12 imports written, 12 read: relative, single-quoted, multi-line dynamic too)", () => {
    expect((fence.modules as Mod[]).map((m) => m.spec).sort()).toEqual(
      [
        "rt-bare", "rt-comment-fence", "rt-comment-mention", "rt-db-alias", "rt-fenced", "rt-indirect", "rt-multiline", "rt-numbers",
        "rt-partial-fence", "rt-raw-sql", "rt-relative", "rt-single",
      ]
        .map((t) => `@/lib/brain/${t}`)
        .sort(),
    );
  });

  it("POSITIVE CONTROL: an unfenced producer that reads BrainMemory is red, naming it; its fenced twin is green", () => {
    const v = producerVerdict("rt-bare");
    expect(v.red).toBe(true);
    expect(v.message).toContain("@/lib/brain/rt-bare");
    expect(producerVerdict("rt-fenced")).toEqual({ red: false, message: "" });
    expect(producerVerdict("rt-numbers")).toEqual({ red: false, message: "" });
  });

  it("POSITIVE CONTROL: an unfenced tool that reads BrainMemory is red, naming it; its fenced twin is green", () => {
    const v = toolVerdict("t-positive.ts");
    expect(v.red).toBe(true);
    expect(v.message).toContain("t-positive.ts:readRows");
    expect(toolVerdict("t-fenced.ts")).toEqual({ red: false, message: "" });
  });
});

/** Closed 2026-10-10: each is now red, naming the producer or tool. */
const PRODUCER_CLOSED: Array<[string, string]> = [
  ["relative import (`../../brain/x`)", "rt-relative"],
  ["single-quoted import", "rt-single"],
  ["multi-line dynamic import", "rt-multiline"],
  ["a COMMENT mentioning fenceContent( is not a fence", "rt-comment-fence"],
  ["raw SQL read of BrainMemory", "rt-raw-sql"],
  ["a prisma alias (`db.brainMemory`)", "rt-db-alias"],
  ["rows read by a function imported from another module (one hop)", "rt-indirect"],
];
const TOOL_CLOSED: Array<[string, string]> = [
  ["a tool name with `_` (precedent: meta.ts browser_do)", "t-underscore.ts"],
  ["a generic `tool<In, Out>({` start", "t-generic.ts"],
  ["a top-level `export const x = tool({`", "t-toplevel.ts"],
  ["a comment mentioning fenceContent( is not a fence", "t-comment-fence.ts"],
];

describe("prompt-block-fencing-gate · bypasses closed 2026-10-10", () => {
  it.each(PRODUCER_CLOSED)("DENY · producer · %s → red, naming it", (_label, tail) => {
    const v = producerVerdict(tail);
    expect(v.red).toBe(true);
    expect(v.message).toContain(`@/lib/brain/${tail}`);
  });
  it.each(TOOL_CLOSED)("DENY · tool · %s → red, naming the file", (_label, file) => {
    const v = toolVerdict(file);
    expect(v.red).toBe(true);
    expect(v.message).toContain(file);
  });
  it("ALLOW · a module whose only mention of prisma.brainMemory is a comment → green", () => {
    expect(producerVerdict("rt-comment-mention")).toEqual({ red: false, message: "" });
  });
});

/**
 * STILL OPEN: one fenced render vouches for an unfenced render in the same file. Closing it needs data
 * flow (which value reaches the prompt): a per-function rule, measured on the real tree 2026-10-10,
 * flagged ten correctly fenced producers whose fence lives in a different function than the read.
 */
describe("prompt-block-fencing-gate · BYPASSES", () => {
  it("OBSERVED · producer · one fenced render vouches for an unfenced render in the same file → green", () => {
    expect(producerVerdict("rt-partial-fence")).toEqual({ red: false, message: "" });
  });
  it.fails("BYPASS · producer · one fenced render vouches for an unfenced render in the same file → must be red", () => {
    expect(producerVerdict("rt-partial-fence").red).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6 · tests/repo/regen-telemetry-strict.test.ts
// ─────────────────────────────────────────────────────────────────────────────

const REGEN = "tests/repo/regen-telemetry-strict.test.ts";
const regenGate = gate(REGEN, "writes through recordMetricStrict inside the warn-on-failure try/catch");
const alternatePaths = readFileSync(join(APP, "app/api/ai/chat/alternate-paths.ts"), "utf8");
const mutate = (from: string | RegExp, to: string) => {
  const out = alternatePaths.replace(from, to);
  if (out === alternatePaths) throw new Error(`mutation did not apply: ${String(from)} (alternate-paths.ts changed: update the red-team file)`);
  return out;
};

describe("regen-telemetry-strict · the gate fires", () => {
  it("POSITIVE CONTROL: the real file is green; swapping back to the fail-soft recordMetric is red", () => {
    expect(regenGate({ ts, src: alternatePaths })).toEqual({ red: false, message: "" });
    const failSoft = mutate(/recordMetricStrict/g, "recordMetric");
    const v = regenGate({ ts, src: failSoft });
    expect(v.red).toBe(true);
    expect(v.message).toContain("await recordMetricStrict(regenMetric.metric");
  });
  it("DENY · the strict writer fired without await (void) → red", () => {
    expect(regenGate({ ts, src: mutate("await recordMetricStrict(regenMetric.metric", "void recordMetricStrict(regenMetric.metric") }).red).toBe(true);
  });
  it("DENY · the warn-on-failure try/catch gone → red (fails closed on a missing anchor)", () => {
    // The anchor is the catch that warns verified_regen_telemetry_failed (the old text anchor was the formatter's name).
    expect(regenGate({ ts, src: mutate("verified_regen_telemetry_failed", "verified_regen_telemetry_skipped") }).red).toBe(true);
    expect(regenGate({ ts, src: mutate(/\} catch \(err\) \{\s*log\.warn\("verified_regen_telemetry_failed"/, '} finally {\n          log.info("x"') }).red).toBe(true);
  });
});

const REGEN_CLOSED: Array<[string, () => string]> = [
  [
    "the strict write's rejection re-swallowed with .catch(() => {}) (the exact original defect: the warn can never fire)",
    () => mutate(/(source: regenMetric\.source,\s*\}\))(;)/, "$1.catch(() => {})$2"),
  ],
  [
    "fail-soft writer under an alias, with the expected call only in a comment",
    () =>
      mutate(
        /const \{ recordMetricStrict \} = await import\("@\/lib\/services\/metrics"\);\s*await recordMetricStrict\(/,
        'const { recordMetric: write } = await import("@/lib/services/metrics");\n          // was: await recordMetricStrict(regenMetric.metric, ...)\n          await write(',
      ),
  ],
];

describe("regen-telemetry-strict · bypasses closed 2026-10-10", () => {
  it.each(REGEN_CLOSED)("DENY · %s → red", (_label, src) => {
    expect(regenGate({ ts, src: src() }).red).toBe(true);
  });
  it("DENY · the fail-soft writer bound under the strict name (`{ recordMetric: recordMetricStrict }`) → red", () => {
    expect(regenGate({ ts, src: mutate("const { recordMetricStrict } =", "const { recordMetric: recordMetricStrict } =") }).red).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7 · the anti-slop gate: scripts/check-anti-slop.sh (run for real) + auditGateClaims
// ─────────────────────────────────────────────────────────────────────────────

const SCRIPT = resolve(APP, OVERRIDE["scripts/check-anti-slop.sh"] ?? "scripts/check-anti-slop.sh").split(sep).join("/");
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))) as NodeJS.ProcessEnv;
let caseNo = 0;
/** Async, so ~35 bash runs do not starve the vitest worker's RPC (a sync loop tripped "Timeout calling onTaskUpdate"). */
const run = (cmd: string, args: string[], cwd: string) =>
  new Promise<{ code: number; out: string }>((done) => {
    execFile(cmd, args, { cwd, env: gitEnv, encoding: "utf8" }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      done({ code, out: `${stdout ?? ""}${stderr ?? ""}` });
    });
  });
/** Run the real script in a throwaway repo holding `files` (tracked unless `track: false`). */
async function antiSlop(files: Record<string, string>, opts: { git?: boolean; track?: boolean } = {}): Promise<{ code: number; out: string }> {
  const dir = fixtureDir("anti-slop", `case-${++caseNo}`);
  writeTree(dir, { "components/ok.tsx": "export const Ok = () => <div className=\"bg-canvas\" />;\n", ...files });
  if (opts.git !== false) {
    const init = await run("git", ["init", "-q"], dir);
    if (init.code !== 0) throw new Error(`fixture git init failed: ${init.out}`);
    if (opts.track !== false) {
      const add = await run("git", ["add", "-A"], dir);
      if (add.code !== 0) throw new Error(`fixture git add failed: ${add.out}`);
    }
  }
  return run("bash", [SCRIPT], dir);
}

describe("check-anti-slop.sh · the gate fires (real script, throwaway git repos)", () => {
  it("POSITIVE CONTROL: clean tree exit 0; a planted Inter import exit 1 naming the rule and the file", async () => {
    const clean = await antiSlop({});
    expect(clean.code, clean.out).toBe(0);
    expect(clean.out).toContain("no anti-slop UI patterns");
    const r = await antiSlop({ "components/x.tsx": 'import { Inter } from "next/font/google";\n' });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("Inter font imports");
    expect(r.out).toContain("components/x.tsx");
  }, 60_000);

  it.each([
    ["purple gradient", "components/x.tsx", '<div className="bg-gradient-to-r from-purple-500 to-purple-700" />', "Purple-on-white SaaS gradients"],
    ["via-purple in app/", "app/x.tsx", '<div className="from-indigo-500 via-purple-500 to-pink-500" />', "Purple-on-white SaaS gradients"],
    ["aliased Inter import", "components/x.tsx", 'import { Inter as Sans } from "next/font/google";', "Inter font imports"],
    ["Inter in a CSS font-family", "app/styles/x.css", "body { font-family: Inter, sans-serif; }", "Inter font imports"],
    ["Roboto import", "lib/x.tsx", 'import { Roboto } from "next/font/google";', "Roboto/Arial AI-default fonts"],
    ["\"Arial\" literal", "components/x.tsx", 'const f = "Arial";', "Roboto/Arial AI-default fonts"],
  ])("DENY · %s → exit 1, rule named", async (_label, file, src, rule) => {
    const r = await antiSlop({ [file]: `${src}\n` });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain(rule);
  }, 60_000);

  it.each([
    ["Interface / Internal words", "components/x.tsx", "interface InternalProps { interval: number }"],
    ["a waived purple line", "components/x.tsx", '<div className="from-purple-500" /> {/* anti-slop-allow 2026-10-10 reason */}'],
    ["purple outside a gradient", "components/x.tsx", '<div className="text-purple-500" />'],
    ["a vendored path excluded on purpose", "lib/ai/last30days/x.ts", 'import { Inter } from "next/font/google";'],
  ])("ALLOW · %s → exit 0", async (_label, file, src) => {
    const r = await antiSlop({ [file]: `${src}\n` });
    expect(r.code, r.out).toBe(0);
  }, 60_000);
});

/**
 * [label, files, git options, text the output must carry]. Each was a verified bypass until R3-10 closed it;
 * the OBSERVED twins that pinned the old exit 0 are deleted. A bare exit 1 is not proof (a crash exits 1 too),
 * so each row also names the rule it must trip.
 */
const SLOP_BYPASS: Array<[string, Record<string, string>, { git?: boolean; track?: boolean }, string]> = [
  ["prettier-wrapped multi-line Inter import", { "app/layout.tsx": 'import {\n  Inter,\n  JetBrains_Mono,\n} from "next/font/google";\n' }, {}, "Inter font imports"],
  ["Tailwind v4 theme font token (`--font-sans: Inter, ...`)", { "app/styles/tokens.css": "@theme inline {\n  --font-sans: Inter, system-ui, sans-serif;\n}\n" }, {}, "Inter font imports"],
  ["Inter inside a longer JS font string", { "components/x.tsx": 'const style = { fontFamily: "Inter, sans-serif" };\n' }, {}, "Inter font imports"],
  ["purple gradient in features/ (chat-v2 UI is never scanned)", { "features/chat-v2/components/x.tsx": '<div className="bg-gradient-to-r from-purple-500 to-purple-700" />\n' }, {}, "Purple-on-white SaaS gradients"],
  ["Inter import in features/", { "features/chat-v2/components/x.tsx": 'import { Inter } from "next/font/google";\n' }, {}, "Inter font imports"],
  ["Inter import in hooks/", { "hooks/use-font.ts": 'import { Inter } from "next/font/google";\n' }, {}, "Inter font imports"],
  ["purple gradient in lib/ (the purple scan skipped lib)", { "lib/ui/x.ts": 'export const hero = "bg-gradient-to-r from-purple-500 to-purple-700";\n' }, {}, "Purple-on-white SaaS gradients"],
  ["Arial in a CSS font-family (only Inter has that arm)", { "app/styles/x.css": "body { font-family: Arial, sans-serif; }\n" }, {}, "Roboto/Arial AI-default fonts"],
  ["Roboto first in a `--font-*` token", { "app/styles/x.css": "@theme inline {\n  --font-body: Roboto, sans-serif;\n}\n" }, {}, "Roboto/Arial AI-default fonts"],
  ["a NEW file not yet `git add`ed (verify:hard before the first commit)", { "components/x.tsx": 'import { Inter } from "next/font/google";\n' }, { track: false }, "Inter font imports"],
  ["not inside a git work tree at all (git grep errors, swallowed)", { "components/x.tsx": 'import { Inter } from "next/font/google";\n' }, { git: false }, "could not scan"],
  ["a CSS universal-selector line is code, not a comment", { "app/styles/x.css": "* { font-family: Inter, sans-serif; }\n" }, {}, "Inter font imports"],
  // Found red-teaming R3-10's own comment filter: code AFTER a closed comment on the same line is code.
  ["an import after a closed block comment on its line", { "app/layout.tsx": '/* eslint-disable */ import { Inter } from "next/font/google";\n' }, {}, "Inter font imports"],
  ["code after a JSDoc close on its line", { "components/x.tsx": ' */ export const f = { fontFamily: "Inter, sans-serif" };\n' }, {}, "Inter font imports"],
  ["code after a JSX comment on its line", { "components/x.tsx": '{/* x */} <p style={{ fontFamily: "Inter, sans-serif" }} />\n' }, {}, "Inter font imports"],
  // Only the multi-line pass can see this one (no single line names both Inter and next/font): pins that layer alone.
  ["a wrapped import opened after a block comment", { "app/layout.tsx": '/* fonts */ import {\n  Inter,\n} from "next/font/google";\n' }, {}, "Inter font imports"],
  ["a purple gradient in a comment line still fires (the live anti-slop-gate canary plants one)", { "components/x.tsx": '// canary <div className="bg-gradient-to-r from-purple-500 to-purple-700" />\n' }, {}, "Purple-on-white SaaS gradients"],
];

describe("check-anti-slop.sh · bypasses closed 2026-10-10 (R3-10)", () => {
  it.each(SLOP_BYPASS)("DENY · %s → exit 1, rule named", async (_label, files, opts, rule) => {
    const r = await antiSlop(files, opts);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain(rule);
  }, 60_000);
});

describe("check-anti-slop.sh · false positives closed 2026-10-10 (R3-10)", () => {
  it.each([
    ["a comment that only quotes \"Inter\"", "components/x.tsx", '// brand rule: never ship "Inter" as the primary face'],
    ["a JSDoc line quoting \"Inter\"", "components/x.tsx", '/**\n *   NO purple gradient, NO "Inter", NO symmetric stack\n */'],
    ["Roboto as a FALLBACK in a system stack (weekly-digest email shape)", "app/x.ts", 'const css = `font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;`;'],
    ["a font name that only starts with Inter", "components/x.tsx", 'const f = "Interstate, sans-serif";'],
    ["a multi-line next/font import of another face beside an Inter comment", "app/layout.tsx", 'import {\n  Geist,\n} from "next/font/google";\n// no Inter here'],
  ])("ALLOW · %s → exit 0", async (_label, file, src) => {
    const r = await antiSlop({ [file]: `${src}\n` });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("no anti-slop UI patterns");
  }, 60_000);
});

describe("auditGateClaims · the live DESIGN.md arm", () => {
  const VOCAB = ["Inter", "Roboto", "Arial", "purple", "rounded corners", "symmetrical centered layouts", "contrast ratio"] as const;
  const design = readFileSync(join(APP, "docs/DESIGN.md"), "utf8");
  const gateSource = readFileSync(join(APP, "scripts/check-anti-slop.sh"), "utf8");
  const BULLET = "- ❌ No purple-on-white SaaS gradients (gold-on-dark is the brand)";
  const overClaiming = design.replace(BULLET, `${BULLET}\n- ❌ No uniform rounded corners`);

  it("POSITIVE CONTROL: the audit flags an over-claim in a block shaped like its own fixture", () => {
    const doc = "gate-checked\n- No Inter\n- No rounded corners\n";
    expect(auditGateClaims(doc, gateSource, "gate-checked", VOCAB).unbacked).toEqual(["rounded corners"]);
    expect(overClaiming).not.toBe(design);
  });
  // Closed 2026-10-10 (R3-10): rows flipped from it.fails, OBSERVED twins deleted.
  it("DENY · crediting the gate with `rounded corners` in the REAL doc's gate-checked list is flagged (blank line after the heading)", () => {
    expect(auditGateClaims(overClaiming, gateSource, "gate-checked", VOCAB).unbacked).toEqual(["rounded corners"]);
  });
  const claim = "gate-checked\n- No Inter\n- Contrast ratio >= 4.5\n";
  it("DENY · a term only mentioned in the gate's comments does not back a claim (whole-line and trailing #)", () => {
    expect(auditGateClaims(claim, `# NOTE: contrast ratio is NOT checked here\n${gateSource}`, "gate-checked", VOCAB).unbacked).toEqual(["contrast ratio"]);
    expect(auditGateClaims(claim, `${gateSource}\nset -e  # contrast ratio lives in a11y\n`, "gate-checked", VOCAB).unbacked).toEqual(["contrast ratio"]);
  });
  it("ALLOW · only the bullet run right after the heading is attributed, not a later section's bullets", () => {
    const doc = "gate-checked by the script.\n\nSome prose about the gate.\n\n- No rounded corners\n";
    expect(auditGateClaims(doc, gateSource, "gate-checked", VOCAB)).toEqual({ unbacked: [], ok: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8 · the file's own loop-turn guard (the beforeEach at the top)
// ─────────────────────────────────────────────────────────────────────────────

describe("the worker's event loop turns between this file's synchronous tests", () => {
  // A 5 ms timer is overdue after every 30 ms busy test. If the runner chains the tests without a macrotask
  // turn (no beforeEach yield), the timer cannot fire between them. Each test compares itself with the one
  // that ran before it, so the check holds for any subset or order of these tests (the first has nothing
  // to compare with and passes by itself; the rest fail when the yield is gone).
  let ticks = 0;
  let timer: ReturnType<typeof setInterval>;
  let previous: number | undefined;
  const busy = () => {
    for (const end = Date.now() + 30; Date.now() < end; ) {
      /* spin: a synchronous test body */
    }
    const before = previous;
    previous = ticks;
    if (before !== undefined) expect(ticks, `the loop did not turn since the previous synchronous test (timer count stayed ${before})`).toBeGreaterThan(before);
  };
  beforeAll(() => {
    timer = setInterval(() => void ticks++, 5);
  });
  afterAll(() => clearInterval(timer));

  it("synchronous test 1", busy);
  it("synchronous test 2: a timer fired since test 1", busy);
  it("synchronous test 3: a timer fired since test 2", busy);
  it("synchronous test 4: a timer fired since test 3", busy);
});
