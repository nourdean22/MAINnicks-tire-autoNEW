/**
 * Canary for scripts/validate-route-registry.mjs — the route-parity gate.
 *
 * AGENTS.md: no gate ships without a test that BREAKS it and asserts it fails,
 * next to a healthy run that passes. This runs the real script as a child
 * process against fixture trees with one planted defect each, and once
 * against the real repo as the live control. Exit codes, not internals:
 * the gate is what CI runs.
 *
 * Fixtures are minimal on purpose — a registry entry needs path/title/
 * description/prerender for Rule 2's block parser, and the two lists Rule 5
 * reads (DYNAMIC_ROUTE_PREFIXES, NON_REGISTRY_PUBLIC_PATHS) must exist.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(process.cwd(), "scripts", "validate-route-registry.mjs");

const HEALTHY_APP = `
<Route path={"/"} component={Home} />
<Route path="/brakes" component={Brakes} />
<Route path={"/blog/:slug"} component={BlogPost} />
<Route path={"/admin"} component={Admin} />
<Route path={"/track"} component={TrackJob} />
<Route path={"/404"} component={NotFound} />
<Route component={NotFound} />
`;

const HEALTHY_ROUTES = `
export const CORE_PAGES = [
  { path: "/", title: "Home", description: "Home page.", group: "core", sitemap: true, prerender: true },
  { path: "/brakes", title: "Brakes", description: "Brake repair.", group: "service", sitemap: true, prerender: true },
];
export const DYNAMIC_ROUTE_PREFIXES = ["/blog/"] as const;
export const NON_REGISTRY_PUBLIC_PATHS = ["/404", "/track"] as const;
`;

const tmpDirs: string[] = [];

function fixture(appTsx: string, routesTs: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "route-registry-canary-"));
  tmpDirs.push(root);
  fs.mkdirSync(path.join(root, "client", "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "shared"), { recursive: true });
  fs.writeFileSync(path.join(root, "client", "src", "App.tsx"), appTsx);
  fs.writeFileSync(path.join(root, "shared", "routes.ts"), routesTs);
  return root;
}

function run(root: string) {
  const res = spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, ROUTE_REGISTRY_ROOT: root },
    encoding: "utf8",
  });
  return { status: res.status, out: `${res.stdout}\n${res.stderr}` };
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("validate-route-registry.mjs — behavioural canary", () => {
  it("passes a healthy fixture (control)", () => {
    const r = run(fixture(HEALTHY_APP, HEALTHY_ROUTES));
    expect(r.out).toContain("route registry OK");
    expect(r.status).toBe(0);
  });

  it("passes the real repo (live control — the gate is green on main)", () => {
    const res = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(`${res.stdout}${res.stderr}`).toContain("route registry OK");
    expect(res.status).toBe(0);
  });

  it("FAILS when App.tsx adds a :param route whose prefix is not declared (Rule 5)", () => {
    const app = `${HEALTHY_APP}\n<Route path={"/guides/:slug"} component={GuidePage} />\n`;
    const r = run(fixture(app, HEALTHY_ROUTES));
    expect(r.status).toBe(1);
    expect(r.out).toContain('dynamic route under "/guides/"');
  });

  it("FAILS when DYNAMIC_ROUTE_PREFIXES carries a prefix App.tsx no longer has (Rule 5, stale)", () => {
    const routes = HEALTHY_ROUTES.replace('["/blog/"]', '["/blog/", "/guides/"]');
    const r = run(fixture(HEALTHY_APP, routes));
    expect(r.status).toBe(1);
    expect(r.out).toContain('DYNAMIC_ROUTE_PREFIXES lists "/guides/"');
  });

  it("FAILS when NON_REGISTRY_PUBLIC_PATHS carries a path App.tsx no longer has (stale)", () => {
    const routes = HEALTHY_ROUTES.replace('["/404", "/track"]', '["/404", "/track", "/pay"]');
    const r = run(fixture(HEALTHY_APP, routes));
    expect(r.status).toBe(1);
    expect(r.out).toContain('NON_REGISTRY_PUBLIC_PATHS lists "/pay"');
  });

  it("FAILS when App.tsx adds a static route the registry does not know (Rule 1)", () => {
    const app = `${HEALTHY_APP}\n<Route path={"/tires"} component={Tires} />\n`;
    const r = run(fixture(app, HEALTHY_ROUTES));
    expect(r.status).toBe(1);
    expect(r.out).toContain('App.tsx route "/tires" is NOT in shared/routes.ts');
  });

  it("measures a title and description past the apostrophe in \"Nick's\" (Rules 3-4)", () => {
    // Until 2026-10-01 the field pattern was ["']([^"']*)["'], which ended this
    // title at "Nick" (45 chars) and this description at "Nick" (7 chars), so
    // neither limit was ever reached.
    const title = "Brake Repair Cleveland · Pads & Rotors | Nick's Tire & Auto Open 7 Days";
    const description = `At Nick's Tire & Auto ${"the brake check is free and the quote is written first. ".repeat(3)}`;
    expect(title.length).toBeGreaterThan(70);
    expect(description.length).toBeGreaterThan(165);
    const routes = HEALTHY_ROUTES.replace('title: "Brakes", description: "Brake repair."', `title: "${title}", description: "${description}"`);
    const r = run(fixture(HEALTHY_APP, routes));
    expect(r.out).toContain(`"/brakes" title is ${title.length} chars (> 70)`);
    expect(r.out).toContain(`"/brakes" description is ${description.length} chars (> 165)`);
    expect(r.status).toBe(0); // length is a warning, never a block
  });

  it("checks an entry that opens with a comment before path: (Rules 2-4)", () => {
    const routes = HEALTHY_ROUTES.replace(
      '  { path: "/brakes", title: "Brakes", description: "Brake repair.",',
      '  {\n    // 2026-10-01 rationale comment, the shape many real entries open with\n    path: "/brakes", title: "Brakes", description: "",',
    );
    expect(routes).toContain("// 2026-10-01 rationale");
    const r = run(fixture(HEALTHY_APP, routes));
    expect(r.status).toBe(1);
    expect(r.out).toContain('"/brakes" has empty description');
  });

  it("FAILS closed when the SEO block parser finds no entries (Rule 0 for Rules 2-4)", () => {
    // Same paths (so Rule 1 still passes), in a field order the block parser
    // does not read: title first, then path.
    const routes = HEALTHY_ROUTES.replace(/\{ path: ("[^"]*"), title: ("[^"]*"),/g, "{ title: $2, path: $1,");
    expect(routes).toContain('{ title: "Brakes", path: "/brakes",');
    const r = run(fixture(HEALTHY_APP, routes));
    expect(r.status).toBe(1);
    expect(r.out).toContain("read 0 of 2 registry entries");
  });

  it("FAILS closed when ONE entry is unreadable, not only when all are (Rules 2-4)", () => {
    // A template-literal description is invisible to the string parser. A
    // partial blindness like this printed "OK" until 2026-10-01.
    const routes = HEALTHY_ROUTES.replace('description: "Brake repair."', "description: `Brake repair.`");
    const r = run(fixture(HEALTHY_APP, routes));
    expect(r.status).toBe(1);
    expect(r.out).toContain("read 1 of 2 registry entries");
  });

  it("a comment between two fields does not hide the entry (Rules 2-4)", () => {
    const routes = HEALTHY_ROUTES.replace(
      '{ path: "/brakes", title: "Brakes", description: "Brake repair.",',
      '{ path: "/brakes", // was {"/brake-repair"} until 2026\n    title: "Brakes", description: "",',
    );
    // The brace inside the comment is what stopped the old parser's [^}]*? span.
    expect(routes).toContain('// was {"/brake-repair"}');
    const r = run(fixture(HEALTHY_APP, routes));
    expect(r.status).toBe(1);
    expect(r.out).toContain('"/brakes" has empty description');
  });

  it("a commented-out field is not read as the live one (Rules 3-4)", () => {
    const longTitle = "Brake Repair Cleveland · Pads, Rotors, Calipers and Lines | Nick's Tire & Auto";
    expect(longTitle.length).toBeGreaterThan(70);
    const routes = HEALTHY_ROUTES.replace(
      '{ path: "/brakes", title: "Brakes",',
      `{ path: "/brakes",\n    // title: "Brakes",\n    title: "${longTitle}",`,
    );
    const r = run(fixture(HEALTHY_APP, routes));
    expect(r.out).toContain(`"/brakes" title is ${longTitle.length} chars (> 70)`);
    expect(r.status).toBe(0);
  });

  it("FAILS closed when the App.tsx parser finds nothing (Rule 0 — a blind gate must not be green)", () => {
    const r = run(fixture("// no routes here\nexport default function App() { return null; }\n", HEALTHY_ROUTES));
    expect(r.status).toBe(1);
    expect(r.out).toContain("ZERO <Route path=");
  });
});
