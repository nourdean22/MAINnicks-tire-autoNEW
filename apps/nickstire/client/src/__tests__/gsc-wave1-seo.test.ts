/**
 * GSC audit wave 1 (2026-10-29). Search Console, lifetime 2026-03-16..10-27:
 *
 * - /alignment (2 clicks, 894 impr, linked from 271 prerendered pages) and
 *   /wheel-alignment-cleveland (27 clicks, 13,565 impr, 433 pages) were both
 *   indexed and self-canonical for one intent, both at pos ~23 for "wheel
 *   alignment cleveland". The weaker one now 301s to the stronger one.
 * - "used tires near me" lands on the homepage (pos 6.7) while the homepage
 *   had no link to /used-tires-cleveland at all.
 * - /emissions drew ~2,600 impr of "e check near me" style queries at pos
 *   8-15 with 0 clicks: the searcher asks where to get tested, the page led
 *   with "Failed E-Check?". The page now answers where first, from OHIO_ECHECK.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { PRERENDER_ROUTES, SITEMAP_ROUTES, getRouteByPath } from "@shared/routes";
import { SERVICES } from "@shared/services";
import { OHIO_ECHECK } from "@shared/echeck";
import { canonicalServicePath } from "@shared/internalLinks";
import { sliceBlock } from "../../../server/testUtils/sourceBlock";
import { REDIRECTS, REDIRECTED_PATHS, installRedirects } from "../../../server/_core/redirects";
import { getConversionDataForSlug } from "../data/serviceConversionData";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

function redirectFor(path: string): { code: number; to: string } | null {
  const handlers = new Map<string, (req: unknown, res: unknown) => void>();
  const app = { get: (p: string, h: (req: unknown, res: unknown) => void) => handlers.set(p, h) };
  installRedirects(app as never);
  const h = handlers.get(path);
  if (!h) return null;
  let out: { code: number; to: string } | null = null;
  h({}, { redirect: (code: number, to: string) => { out = { code, to }; } });
  return out;
}

describe("alignment pages merged into /wheel-alignment-cleveland", () => {
  it("/alignment answers 301 to /wheel-alignment-cleveland", () => {
    expect(redirectFor("/alignment")).toEqual({ code: 301, to: "/wheel-alignment-cleveland" });
  });

  it("the /wheel-alignment alias points straight at the survivor, no chain", () => {
    expect(redirectFor("/wheel-alignment")).toEqual({ code: 301, to: "/wheel-alignment-cleveland" });
  });

  it("no redirect lands on another redirect", () => {
    const redirected = new Set(REDIRECTED_PATHS);
    const chains = REDIRECTS.filter((r) => redirected.has(r.to.split("#")[0])).map((r) => `${r.from} -> ${r.to}`);
    expect(chains).toEqual([]);
  });

  it("/alignment is out of the sitemap and prerender lists; the survivor stays in both", () => {
    expect(SITEMAP_ROUTES.map((r) => r.path)).not.toContain("/alignment");
    expect(PRERENDER_ROUTES.map((r) => r.path)).not.toContain("/alignment");
    expect(getRouteByPath("/wheel-alignment-cleveland")?.sitemap).toBe(true);
    expect(SITEMAP_ROUTES.map((r) => r.path)).toContain("/wheel-alignment-cleveland");
  });

  it("no app source links to /alignment any more", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name === "node_modules" || name === "__tests__") continue;
          walk(p);
        } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          if (p.endsWith(join("_core", "redirects.ts"))) continue;
          if (/["'`]\/alignment["'`#?]/.test(readFileSync(p, "utf8"))) offenders.push(p.slice(ROOT.length + 1));
        }
      }
    };
    for (const d of ["client/src", "shared", "server"]) walk(resolve(ROOT, d));
    expect(offenders).toEqual([]);
  });

  it("links built from the 'alignment' service slug resolve to the survivor", () => {
    expect(canonicalServicePath("alignment")).toBe("/wheel-alignment-cleveland");
  });
});

describe("used tires: the page Google sends the query to links the used-tire page", () => {
  it("the homepage used-tire callout links /used-tires-cleveland with 'used tires' anchor text", () => {
    const src = read("client/src/pages/Home.tsx");
    expect(src).toMatch(/href="\/used-tires-cleveland"[^>]*>\s*[^<]*used tires/i);
  });

  it("/tires links /used-tires-cleveland from the used-tire card, not only the footer nav", () => {
    const src = read("client/src/pages/TireFinderV2.tsx");
    const card = sliceBlock(src, "Used tire replacement", 'id="open-sundays"', { label: "TireFinderV2.tsx" });
    expect(card).toContain('href="/used-tires-cleveland"');
  });
});

describe("/emissions answers where to get tested first", () => {
  const emissions = SERVICES.find((s) => s.slug === "emissions")!;

  it("the first body answer opens with who runs the state test, from OHIO_ECHECK", () => {
    const answer = getConversionDataForSlug("emissions").aeoAnswer ?? "";
    expect(answer.startsWith(OHIO_ECHECK.whoTests)).toBe(true);
    expect(answer).toContain(OHIO_ECHECK.freeTests.display);
  });

  it("the title and description lead with the where-to-test intent, in both title sources", () => {
    expect(emissions.metaTitle).toMatch(/^E-Check Near Me/);
    expect(emissions.metaDescription.startsWith(OHIO_ECHECK.whoTests)).toBe(true);
    expect(getRouteByPath("/emissions")?.title).toBe(emissions.metaTitle);
  });

  it("the first FAQ is the where-do-I-get-tested question", () => {
    expect(emissions.quickAnswers?.[0]?.question).toMatch(/where/i);
    expect(emissions.quickAnswers?.[0]?.answer.startsWith(OHIO_ECHECK.whoTests)).toBe(true);
  });
});
