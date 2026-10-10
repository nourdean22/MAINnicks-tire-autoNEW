/**
 * A link that lib/ hands the operator must open a page that exists (audit
 * 2026-10-10 · 02-F9).
 *
 * THE DEFECT. Server code writes links into Telegram pushes and emails, where
 * no type checker or page router ever sees them:
 *
 *   camera-intelligence   "Check cameras at bdnick.info/cameras"    (404)
 *   email.ts              deviceOfflineEmail -> bdnick.info/devices (404,
 *                         and the template had no caller at all)
 *   autonomous-engine     bdnick.info/appointments, bdnick.info/loops (404)
 *
 * tests/repo/system-nav-targets.test.ts already guards `/system/<seg>` hrefs.
 * This guards every other page path lib/ emits, in the two forms that can only
 * mean "go here": a `bdnick.info/<path>` URL, and an `href`-named key or prop
 * set to a "/<path>" literal. A path resolves when an app/** page.tsx serves it
 * or a next.config.ts redirect source matches it. `/api/` paths are routes, not
 * pages, and are skipped.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

function walk(dir: string, keep: (f: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

/** app/(mastery)/decisions/[id]/page.tsx -> ["decisions", "[id]"] (groups and slots dropped). */
function pageRoutes(): string[][] {
  return walk("app", (f) => /[\\/]page\.(tsx|ts|jsx|js)$/.test(f)).map((f) =>
    relative("app", f)
      .split(sep)
      .slice(0, -1)
      .filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@")),
  );
}

/** Redirect sources only (headers() also has `source:` keys, e.g. "/:path*"). */
function redirectSources(): string[][] {
  const cfg = readFileSync("next.config.ts", "utf8");
  const at = cfg.indexOf("redirects:");
  if (at < 0) throw new Error("next.config.ts has no redirects block");
  return [...cfg.slice(at).matchAll(/source:\s*"([^"]+)"/g)].map((m) => m[1].split("/").filter(Boolean));
}

/** Does a target path (segments; "*" = a template hole) match a route pattern? */
function matches(target: string[], pattern: string[]): boolean {
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    if (/^\[\[?\.\.\./.test(p) || /^:\w+\*$/.test(p)) return true; // catch-all
    if (i >= target.length) return false;
    if (/^\[.+\]$/.test(p) || /^:\w+$/.test(p) || target[i] === "*") continue;
    if (p !== target[i]) return false;
  }
  return target.length === pattern.length;
}

/**
 * Page paths a source emits as navigation. Comment lines are not links. Block
 * comments are stripped only when they open a line: a string like "*\/*" or a
 * glob "app/**\/*.ts" would otherwise open a fake comment and hide real links.
 */
function deepLinks(input: string): string[] {
  const src = input.replace(/^\s*\/\*[\s\S]*?\*\//gm, "").replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  for (const m of src.matchAll(/bdnick\.info(\/[^\s"'`<>)\]\\]*)/g)) out.push(m[1]);
  for (const m of src.matchAll(/\b\w*[hH]ref\s*[:=]\s*["'`](\/[^"'`]*)/g)) out.push(m[1]);
  return out
    .map((p) => p.replace(/\$\{[^}]*\}/g, "*").split(/[?#]/)[0].replace(/[.,;:]+$/, ""))
    .filter((p) => !p.startsWith("/api/"));
}

function resolves(path: string, routes: string[][]): boolean {
  const target = path.split("/").filter(Boolean);
  return routes.some((r) => matches(target, r));
}

/**
 * Owned by the autonomous-engine task of the same audit wave; this task may
 * not edit that file. The reverse canary below fails as soon as one is fixed,
 * naming the entry to delete here.
 */
const KNOWN_DEAD = new Set([
  "lib/brain/autonomous-engine.ts -> /appointments",
  "lib/brain/autonomous-engine.ts -> /loops",
]);

const ROUTES = [...pageRoutes(), ...redirectSources()];

function sweep(): string[] {
  return walk("lib", (f) => /\.(ts|tsx)$/.test(f)).flatMap((f) => {
    const rel = relative(".", f).split(sep).join("/");
    return deepLinks(readFileSync(f, "utf8"))
      .filter((p) => !resolves(p, ROUTES))
      .map((p) => `${rel} -> ${p}`);
  });
}

describe("lib deep links resolve to a page or a redirect", () => {
  it("SUBJECT: the route table and the lib sweep are both real", () => {
    expect(pageRoutes().length).toBeGreaterThan(20);
    expect(redirectSources().length).toBeGreaterThan(30);
    expect(walk("lib", (f) => /\.(ts|tsx)$/.test(f)).length).toBeGreaterThan(200);
  });

  it("POSITIVE CONTROL: a planted dead link is flagged, in both forms", () => {
    const planted = 'sendTelegram(`Check at bdnick.info/cameras`); const x = { href: "/nowhere-page" };';
    expect(deepLinks(planted).filter((p) => !resolves(p, ROUTES))).toEqual(["/cameras", "/nowhere-page"]);
  });

  it("NEGATIVE CONTROL: real pages, dynamic pages, redirects, API paths and comments pass", () => {
    const fine = [
      '`bdnick.info/system/camera`',
      'href: `/decisions/${dec.id}`',
      'href: "/stats?tab=body"',
      '"https://bdnick.info/mastery"', // redirect -> /stats
      '"https://bdnick.info/api/inngest"',
      "  // bdnick.info/no-such-page in a comment",
      '"https://bdnick.info/"',
    ].join("\n");
    expect(deepLinks(fine).filter((p) => !resolves(p, ROUTES))).toEqual([]);
  });

  it("no lib deep link points at a page that does not exist", () => {
    const broken = sweep().filter((b) => !KNOWN_DEAD.has(b));
    expect(
      broken,
      "these send the operator to a 404. Repoint to a real page, add a next.config " +
        "redirect, or delete the link:\n  " + broken.join("\n  "),
    ).toEqual([]);
  });

  it("REVERSE CANARY: every KNOWN_DEAD entry is still dead (delete it once fixed)", () => {
    const live = new Set(sweep());
    const fixed = [...KNOWN_DEAD].filter((k) => !live.has(k));
    expect(fixed, "fixed, so remove from KNOWN_DEAD:\n  " + fixed.join("\n  ")).toEqual([]);
  });
});
