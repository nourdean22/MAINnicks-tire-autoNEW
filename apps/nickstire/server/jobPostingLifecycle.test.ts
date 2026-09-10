/**
 * Google Jobs invariants. Measured against PRODUCTION on 2026-09-10, in a
 * browser, before any of this was written:
 *
 *   https://nickstire.org/careers  ->  6 ld+json blocks, THREE of @type
 *   JobPosting, on ONE URL. https://nickstire.org/careers/automotive-technician
 *   -> the 404 page. Every posting carried
 *   baseSalary.value = { QuantitativeValue, unitText: "HOUR" } with no number
 *   in it, and neither validThrough nor directApply.
 *
 * Google requires JobPosting markup to sit on the most detailed LEAF page for
 * a SINGLE job and forbids it on a page listing several. Three postings on one
 * URL leaves Google unable to say which job the page is about.
 *
 * These are source-level structural assertions, deliberately: the failure they
 * guard is a page SHIPPING with the wrong markup, which a runtime test in this
 * repo cannot observe (the admin/browser surface is not reachable from CI).
 * Each one is written to fail loudly on the exact regression it names.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  JOB_OPENINGS,
  buildJobPostingSchema,
  jobOpeningBySlug,
  jobOpeningPath,
  openJobOpenings,
} from "../shared/jobOpenings";
import { ALL_ROUTES as ROUTES } from "../shared/routes";

const APP = process.cwd();
const CTX = {
  siteUrl: "https://nickstire.org",
  orgName: "Nick's Tire & Auto",
  logoUrl: "https://nickstire.org/favicon.ico",
  address: { street: "17625 Euclid Ave", city: "Cleveland", state: "OH", zip: "44112" },
};

describe("one job per leaf page", () => {
  it("every open opening has a registered route at its canonical leaf path", () => {
    // The production defect: three slugs existed ONLY as schema identifiers,
    // and /careers/automotive-technician returned the 404 page.
    for (const job of openJobOpenings()) {
      const path = jobOpeningPath(job.slug);
      const route = ROUTES.find((r) => r.path === path);
      expect(route, `${path} has no route — the JobPosting would 404`).toBeTruthy();
    }
  });

  it("every open opening's leaf route is in the sitemap and prerendered", () => {
    for (const job of openJobOpenings()) {
      const route = ROUTES.find((r) => r.path === jobOpeningPath(job.slug));
      expect(route?.sitemap, `${job.slug} leaf is not in the sitemap`).toBe(true);
      expect(route?.prerender, `${job.slug} leaf is not prerendered`).toBe(true);
    }
  });

  it("the /careers LIST page emits ZERO JobPosting objects", () => {
    // This is the exact production violation. Careers.tsx used to map
    // POSITIONS into a JobPosting each and render all three inline.
    const src = readFileSync(resolve(APP, "client/src/pages/Careers.tsx"), "utf8");
    expect(src, "/careers still emits JobPosting markup").not.toContain('"@type": "JobPosting"');
    expect(src, "/careers still emits JobPosting markup").not.toContain('"JobPosting"');
  });

  it("slugs are unique — two openings cannot claim one canonical URL", () => {
    const slugs = JOB_OPENINGS.map((j) => j.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("JobPosting schema correctness", () => {
  it("a CLOSED opening produces no schema at all", () => {
    // A filled role that keeps advertising itself is the failure mode
    // validThrough exists to prevent; this makes it structurally impossible.
    const filled = { ...JOB_OPENINGS[0], status: "filled" as const };
    expect(buildJobPostingSchema(filled, CTX)).toBeNull();
  });

  it("every open opening carries datePosted, validThrough, employmentType, directApply", () => {
    for (const job of openJobOpenings()) {
      const s = buildJobPostingSchema(job, CTX)!;
      expect(s.datePosted, `${job.slug} datePosted`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.validThrough, `${job.slug} validThrough`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.employmentType, `${job.slug} employmentType`).toBeTruthy();
      expect(s.directApply, `${job.slug} directApply`).toBe(true);
    }
  });

  it("validThrough is in the FUTURE relative to datePosted", () => {
    // A validThrough already past on the day it ships is worse than none: it
    // tells Google to drop a job that is genuinely open.
    for (const job of openJobOpenings()) {
      expect(
        new Date(job.validThrough).getTime(),
        `${job.slug}: validThrough is not after datePosted`,
      ).toBeGreaterThan(new Date(job.datePosted).getTime());
    }
  });

  it("baseSalary is either ABSENT or carries a real number — never a hollow object", () => {
    // THE production defect. It emitted
    //   { MonetaryAmount, currency: USD, value: { QuantitativeValue,
    //     unitText: HOUR } }
    // declaring that salary data exists while carrying none.
    for (const job of JOB_OPENINGS) {
      const s = buildJobPostingSchema(job, CTX);
      if (!s) continue;
      if (!("baseSalary" in s)) continue;
      const v = (s.baseSalary as { value?: Record<string, unknown> }).value ?? {};
      const hasNumber =
        typeof v.value === "number" ||
        (typeof v.minValue === "number" && typeof v.maxValue === "number");
      expect(hasNumber, `${job.slug}: baseSalary present but carries no numeric value`).toBe(true);
    }
  });

  it("a salary band round-trips as minValue/maxValue in DOLLARS, not cents", () => {
    // Positive control. Without it, every assertion above is satisfied by a
    // builder that simply never emits baseSalary.
    const paid = { ...JOB_OPENINGS[0], salaryMinHourlyCents: 2200, salaryMaxHourlyCents: 3500 };
    const v = (buildJobPostingSchema(paid, CTX)!.baseSalary as { value: Record<string, number> })
      .value;
    expect(v.minValue).toBe(22);
    expect(v.maxValue).toBe(35);
    expect(v.value).toBeUndefined();
  });

  it("a single salary figure emits value, not a degenerate min==max range", () => {
    const flat = { ...JOB_OPENINGS[0], salaryMinHourlyCents: 2500, salaryMaxHourlyCents: 2500 };
    const v = (buildJobPostingSchema(flat, CTX)!.baseSalary as { value: Record<string, number> })
      .value;
    expect(v.value).toBe(25);
    expect(v.minValue).toBeUndefined();
  });

  it("schema title matches the opening's visible title — no schema-only copy", () => {
    // Google penalises structured data that disagrees with the visible page.
    for (const job of openJobOpenings()) {
      const s = buildJobPostingSchema(job, CTX)!;
      expect(s.title).toBe(job.title);
      expect(String(s.description)).toContain(job.description);
    }
  });

  it("identifier.value is the slug, so schema and URL agree on the job's identity", () => {
    for (const job of openJobOpenings()) {
      const s = buildJobPostingSchema(job, CTX)!;
      expect((s.identifier as { value: string }).value).toBe(job.slug);
      expect(jobOpeningBySlug(job.slug)).toBeTruthy();
    }
  });
});
