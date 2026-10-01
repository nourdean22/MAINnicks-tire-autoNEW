/**
 * Internal route target gate · 2026-10-01 UI convergence.
 *
 * Literal UI destinations must resolve to a real App Router page or to a
 * declared Next redirect source. This catches stale links after route
 * consolidation (for example the retired /system/decision-drift target).
 *
 * Deliberately scans only literal destinations. Template/dynamic URLs need
 * domain-specific tests because pretending to validate runtime interpolation
 * statically would create false confidence.
 */
import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("@sentry/nextjs/config", () => ({ withSentryConfig: (config: unknown) => config }));
vi.mock("@next/bundle-analyzer", () => ({ default: () => (config: unknown) => config }));
import nextConfig from "../../next.config";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCAN_ROOTS = ["app", "components", "lib", "features", "hooks", "config"].map((name) => resolve(APP_ROOT, name));
const SKIP_DIRS = new Set(["node_modules", ".next", "tests", "docs", "prisma", "scripts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|mjs|jsx?)$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(full);
  }
  return out;
}

function routeForPage(file: string): string | null {
  const appDir = resolve(APP_ROOT, "app");
  const rel = relative(appDir, file).split(/[\\/]/).join("/");
  if (!rel.endsWith("/page.tsx") && rel !== "page.tsx") return null;
  const raw = rel === "page.tsx" ? "" : rel.slice(0, -"/page.tsx".length);
  const segments = raw.split("/").filter(Boolean).filter((seg) => !/^\(.+\)$/.test(seg));
  return "/" + segments.join("/");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}

function appRouteRegex(route: string): RegExp {
  if (route === "/") return /^\/$/;
  const parts = route.slice(1).split("/");
  let source = "^";
  for (const part of parts) {
    if (/^\[\[\.\.\..+\]\]$/.test(part)) source += "(?:/.*)?";
    else if (/^\[\.\.\..+\]$/.test(part)) source += "/.+";
    else if (/^\[.+\]$/.test(part)) source += "/[^/]+";
    else source += "/" + escapeRegex(part);
  }
  return new RegExp(source + "/?$");
}

function redirectSourceRegex(source: string): RegExp {
  let pattern = escapeRegex(source);
  pattern = pattern.replace(/\\:([A-Za-z0-9_]+)\\\*/g, ".*");
  pattern = pattern.replace(/\\:([A-Za-z0-9_]+)/g, "[^/]+");
  return new RegExp("^" + pattern + "/?$");
}

function sampleParameterizedRoute(value: string): string {
  return value
    .replace(/:[A-Za-z0-9_]+\*/g, "sample")
    .replace(/:[A-Za-z0-9_]+/g, "sample");
}

function isUiDestination(target: string): boolean {
  if (!target.startsWith("/") || target.startsWith("//")) return false;
  if (/^\/(api|trpc|_next)(\/|$)/.test(target)) return false;
  if (/\.(?:png|jpe?g|gif|webp|svg|ico|mp3|wav|mp4|webm|pdf|json|txt|xml|webmanifest)$/i.test(target)) return false;
  return true;
}

const TARGET_PATTERNS = [
  /\bhref\s*=\s*["'](\/[^"'?#]*)[^"']*["']/g,
  /\b(?:href|link|route|path|url|to|destination|[A-Za-z0-9_]+Href|[A-Za-z0-9_]+Link)\s*:\s*["'](\/[^"'?#]*)[^"']*["']/g,
  // Bare route maps are common in keyboard shortcuts and registries:
  // { h: "/", d: "/system/fleet" }. These were invisible to the narrower
  // property-name sweep even though the strings are operator navigation.
  /^\s*[A-Za-z0-9_]+\s*:\s*["'](\/[^"'?#]*)[^"']*["']/gm,
  /\b(?:router\.)?(?:push|replace)\(\s*["'](\/[^"'?#]*)[^"']*["']/g,
  /\bredirect\(\s*["'](\/[^"'?#]*)[^"']*["']/g,
  /\b(?:navigate|assign)\(\s*["'](\/[^"'?#]*)[^"']*["']/g,
  /\b(?:window\.)?location\.href\s*=\s*["'](\/[^"'?#]*)[^"']*["']/g,
  /\bwindow\.open\(\s*["'](\/[^"'?#]*)[^"']*["']/g,
];

describe("internal UI route targets", () => {
  it("Stats deep links name the tab explicitly before any hash anchor", () => {
    const files = [
      ...SCAN_ROOTS.flatMap((root) => walk(root)),
      resolve(APP_ROOT, "next.config.ts"),
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        if (line.includes("/stats#")) {
          offenders.push(`${relative(APP_ROOT, file)}:${index + 1} → ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `hash-only /stats links can open the wrong tab; use /stats?tab=<key>#anchor:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("every internal redirect destination resolves instead of chaining into a deleted surface", async () => {
    const pageFiles = walk(resolve(APP_ROOT, "app")).filter((file) => file.endsWith("page.tsx"));
    const pageRoutes = pageFiles.map(routeForPage).filter((route): route is string => !!route);
    const pageMatchers = pageRoutes.map((route) => appRouteRegex(route));
    const redirects = await nextConfig.redirects!();
    const redirectMatchers = redirects.map((row) => redirectSourceRegex(row.source));

    const dead = redirects
      .filter((row) => row.destination.startsWith("/"))
      .filter((row) => {
        const clean = row.destination.replace(/[?#].*$/, "") || "/";
        const sampled = sampleParameterizedRoute(clean);
        return !pageMatchers.some((re) => re.test(sampled)) &&
          !redirectMatchers.some((re) => re.test(sampled));
      })
      .map((row) => `${row.source} → ${row.destination}`);

    expect(
      dead.sort(),
      `redirect destinations that terminate at no page or redirect:\n${dead.sort().join("\n")}`,
    ).toEqual([]);
  });

  it("every literal UI destination resolves to a page or declared redirect", async () => {
    const pageFiles = walk(resolve(APP_ROOT, "app")).filter((file) => file.endsWith("page.tsx"));
    const pageRoutes = pageFiles.map(routeForPage).filter((route): route is string => !!route);
    const pageMatchers = pageRoutes.map((route) => appRouteRegex(route));

    const redirects = await nextConfig.redirects!();
    const redirectMatchers = redirects.map((row) => redirectSourceRegex(row.source));

    const dead: string[] = [];
    for (const file of SCAN_ROOTS.flatMap((root) => walk(root))) {
      const source = readFileSync(file, "utf8");
      for (const pattern of TARGET_PATTERNS) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(source)) !== null) {
          const target = match[1].replace(/\/$/, "") || "/";
          if (!isUiDestination(target)) continue;
          const exists =
            pageMatchers.some((re) => re.test(target)) ||
            redirectMatchers.some((re) => re.test(target));
          if (!exists) {
            const line = source.slice(0, match.index).split("\n").length;
            dead.push(
              `${relative(APP_ROOT, file).split(/[\\/]/).join("/")}:${line} → ${target}`,
            );
          }
        }
      }
    }

    expect(
      [...new Set(dead)].sort(),
      `literal internal UI destinations with no page or redirect:\n${[...new Set(dead)].sort().join("\n")}`,
    ).toEqual([]);
  });
});
