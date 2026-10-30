/**
 * The free multi-point (27-point) inspection is real, but Nour said on 2026-10-30 that it is
 * not done on every visit ("deponds on situation"). No customer page, server prompt or SMS
 * template may promise it on every visit, every oil change, or as part of an oil change
 * package. Offering it ("ask for a free 27-point inspection") is fine.
 *
 * The wording lives in ONE place, BUSINESS.freeInspection (shared/business.ts); pages render
 * it, so the copies cannot disagree again. This test is the second fence: it catches a new
 * hand-typed promise anywhere under client/src, shared/ or server/. SHOP-SOUL section 11
 * question 8 records the answer.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BUSINESS } from "@shared/business";

const APP = path.resolve(import.meta.dirname, "..", "..", "..");

const INSPECTION = /multi-point|27-point|21-point|27 checkpoints?|courtesy inspection|free inspection/i;
// Wording that makes the inspection part of every visit or of the oil change package.
const PROMISE =
  /every (visit|oil change|service)|each (visit|oil change)|with any (oil change|service)|(oil change|service)s? (includes?|comes with)|includ\w+ (a |an )?(new filter|free|complimentary|courtesy|multi)|(new filter|top-off)[^.]{0,40}(free )?(multi-point|\d+-point)|included free|inspection included|check included|while you wait/i;
const OFFER = /\bask\b/i;

export function promisesInspectionEveryVisit(line: string): boolean {
  return INSPECTION.test(line) && PROMISE.test(line) && !OFFER.test(line);
}

/** Drop block comments and whole-line // comments so a doc comment cannot trip or satisfy the scan. */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split(/\r?\n/)
    .map((l) => (/^\s*\/\//.test(l) ? "" : l))
    .join("\n");
}

export function scan(file: string, src: string): string[] {
  const hits: string[] = [];
  stripComments(src)
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (promisesInspectionEveryVisit(line)) hits.push(`${file}:${i + 1}`);
    });
  return hits;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", "__tests__", "admin", "dist"].includes(e.name)) continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

// Customer-facing copy: client pages, shared copy, server prompts and the SMS catalog.
// Real customer quotes (customer-testimonials.ts) are theirs, not a promise.
const FILES = [
  ...walk(path.join(APP, "client", "src")),
  ...walk(path.join(APP, "server")),
  ...fs
    .readdirSync(path.join(APP, "shared"))
    .filter((f) => /\.ts$/.test(f) && f !== "customer-testimonials.ts")
    .map((f) => path.join(APP, "shared", f)),
];

describe("free inspection is offered, never promised on every visit", () => {
  it("positive control: the detector flags the old promises", () => {
    expect(promisesInspectionEveryVisit('relief="Free 27-point check on every oil change."')).toBe(true);
    expect(promisesInspectionEveryVisit("27 checkpoints. Every visit, free. multi-point")).toBe(true);
    expect(promisesInspectionEveryVisit("Includes new filter + free multi-point check.")).toBe(true);
    expect(promisesInspectionEveryVisit("Free multi-point inspection with every oil change")).toBe(true);
  });

  it("negative control: the offer wording passes", () => {
    expect(promisesInspectionEveryVisit("Ask for a free 27-point inspection.")).toBe(false);
    expect(promisesInspectionEveryVisit("Free brake check on any visit.")).toBe(false);
  });

  it("positive control: the file scan finds a planted promise, and ignores one inside a comment", () => {
    const planted = ['const a = "Free 27-point inspection on every oil change.";', "// Free 27-point inspection on every oil change.", "/* every visit: free 27-point inspection */"].join("\n");
    expect(scan("planted.ts", planted)).toEqual(["planted.ts:1"]);
  });

  it("the scan located its subjects: it read the pages, the server prompts and the SMS catalog", () => {
    const rel = FILES.map((f) => path.relative(APP, f).replace(/\\/g, "/"));
    expect(FILES.length).toBeGreaterThan(300);
    for (const must of ["client/src/pages/Home.tsx", "client/src/pages/About.tsx", "shared/services.ts", "server/gemini.ts", "server/services/smsOrchestrator.ts"]) {
      expect(rel, must).toContain(must);
    }
  });

  it("the shared constant itself offers, never promises", () => {
    for (const line of Object.values(BUSINESS.freeInspection)) {
      expect(line.length).toBeGreaterThan(10);
      expect(promisesInspectionEveryVisit(line), line).toBe(false);
    }
    expect(BUSINESS.freeInspection.offer).toMatch(/27-point/);
  });

  it("no customer page, prompt or SMS template promises it every visit or with every oil change", () => {
    const hits = FILES.flatMap((file) => scan(path.relative(APP, file).replace(/\\/g, "/"), fs.readFileSync(file, "utf8")));
    expect(hits).toEqual([]);
  });
});
