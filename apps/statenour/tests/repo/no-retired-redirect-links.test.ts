/**
 * No shipped link rides a retired redirect (audit 02-X4-N1 = NEW-02-F20b, 2026-10-10).
 *
 * next.config.ts keeps redirects for retired pages so old bookmarks still
 * land somewhere. A link the app emits TODAY must not depend on one: the
 * redirect lands on a different page than the label promises ("Decisions"
 * -> /system/calibration, "Telemetry" -> the reasoner it sits on). Next.js
 * applies redirects before the filesystem, so a matching source wins even
 * when a page exists; the sweep still reports both conditions.
 *
 * Sweeps lib/ and components/ for link-named string values (href, link, url,
 * deepLink, ctaHref ...: key, prop or JSX attribute). tests/repo/
 * deep-link-targets.test.ts keeps its own parser private, so this is a
 * minimal one: redirect sources are read line by line from next.config.ts.
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

/** `{ source: "/x", destination: ... }` entries: each redirect is one line in next.config.ts. */
function redirectSources(cfg = readFileSync("next.config.ts", "utf8")): string[][] {
  return [...cfg.matchAll(/source:[ \t]*"([^"]+)",[ \t]*destination:/g)].map((m) => m[1].split("/").filter(Boolean));
}

/** app/(mastery)/brain/page.tsx -> ["brain"] (groups and slots dropped). */
function pageRoutes(): string[][] {
  return walk("app", (f) => /[\\/]page\.(tsx|ts|jsx|js)$/.test(f)).map((f) =>
    relative("app", f).split(sep).slice(0, -1).filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@")),
  );
}

function matches(target: string[], pattern: string[]): boolean {
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    if (/^\[\[?\.\.\./.test(p) || /^:\w+\*$/.test(p)) return true; // catch-all
    if (i >= target.length) return false;
    if (/^\[.+\]$/.test(p) || /^:\w+$/.test(p)) continue;
    if (p !== target[i]) return false;
  }
  return target.length === pattern.length;
}

const LINK_VALUE = /\b(?:\w*href|\w*link|\w*url|deepLink)\s*[:=]\s*\{?\s*(["'`])(\/[^"'`\s]*)\1/gi;

/** Link-named literal paths in one source ("${" holes skipped: unknowable). */
function links(src: string): string[] {
  return [...src.matchAll(LINK_VALUE)]
    .map((m) => m[2])
    .filter((p) => !p.includes("${") && !p.startsWith("/api/"))
    .map((p) => p.split(/[?#]/)[0]);
}

const REDIRECTS = redirectSources();
const PAGES = pageRoutes();

/** "<file> -> <path>" for every link whose path is a redirect source. */
function offenders(files: Array<[string, string]>): string[] {
  return files.flatMap(([file, src]) =>
    links(src)
      .filter((p) => REDIRECTS.some((r) => matches(p.split("/").filter(Boolean), r)))
      .map((p) => {
        const seg = p.split("/").filter(Boolean);
        return `${file} -> ${p}${PAGES.some((r) => matches(seg, r)) ? " (page exists, redirect still wins)" : ""}`;
      }),
  );
}

const SHIPPED = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\.tsx?$|\.d\.ts$/.test(f);

describe("no shipped link rides a retired redirect", () => {
  it("SUBJECT: the redirect table, the page table and the sweep are real", () => {
    expect(REDIRECTS.length).toBeGreaterThan(30);
    expect(REDIRECTS.some((r) => r.join("/") === "system/costs")).toBe(true);
    expect(PAGES.length).toBeGreaterThan(20);
    const files = ["lib", "components"].flatMap((d) => walk(d, SHIPPED));
    expect(files.length).toBeGreaterThan(300);
    expect(files.flatMap((f) => links(readFileSync(f, "utf8"))).length).toBeGreaterThan(100);
  });

  it("POSITIVE CONTROL: a planted link through a redirect is flagged, in every form", () => {
    const planted = [
      'push({ href: "/system/costs" });',
      'const x = { link: "/system/cron-diagnostics" };',
      '<a href="/reason/telemetry">t</a>',
      'action: { kind: "navigate", href: "/system/devices" },',
      'ctaHref: "/system/quality?view=decisions",',
    ].join("\n");
    expect(offenders([["probe.tsx", planted]])).toEqual([
      "probe.tsx -> /system/costs",
      "probe.tsx -> /system/cron-diagnostics",
      "probe.tsx -> /reason/telemetry",
      "probe.tsx -> /system/devices",
      "probe.tsx -> /system/quality",
    ]);
  });

  it("NEGATIVE CONTROL: real pages, template holes and API paths pass", () => {
    const fine = [
      'link: { href: "/system/ai-cost", label: "Cost" },',
      'href: "/system/crons",',
      "href: `/decisions/${o.id}`,",
      'href: "/brain?tab=reason",',
      'url: "/api/oauth/google-data/start",',
    ].join("\n");
    expect(offenders([["probe.tsx", fine]])).toEqual([]);
  });

  it("lib/ and components/ emit no link through a redirect", () => {
    const files = ["lib", "components"].flatMap((d) => walk(d, SHIPPED));
    const bad = offenders(files.map((f) => [relative(".", f).split(sep).join("/"), readFileSync(f, "utf8")]));
    expect(bad, "repoint to the real page, or delete the link:\n  " + bad.join("\n  ")).toEqual([]);
  });
});
