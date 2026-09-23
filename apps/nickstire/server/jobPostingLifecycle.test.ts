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
  formatHourlyPayRange,
  jobOpeningBySlug,
  jobOpeningPath,
  openJobOpenings,
} from "../shared/jobOpenings";
import { ALL_ROUTES as ROUTES } from "../shared/routes";

const APP = process.cwd();
const CTX = {
  siteUrl: "https://nickstire.org",
  orgName: "Nick's Tire & Auto",
  logoUrl: "https://nickstire.org/icon-512x512.png",
  shopHours: "7 days — Mon–Sat 8AM–6PM, Sun 9AM–4PM",
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

  it("every open opening's leaf route is flagged for sitemap and prerender", () => {
    for (const job of openJobOpenings()) {
      const route = ROUTES.find((r) => r.path === jobOpeningPath(job.slug));
      expect(route?.sitemap, `${job.slug} leaf is not in the sitemap`).toBe(true);
      expect(route?.prerender, `${job.slug} leaf is not FLAGGED for prerender`).toBe(true);
    }
  });

  it("the prerendered ARTIFACT Googlebot is served actually matches", () => {
    // THE GAP THIS FILE ORIGINALLY SHIPPED WITH. The assertion above checks a
    // REGISTRY BOOLEAN — a config flag saying a page ought to be prerendered.
    // Googlebot is served prerendered/<path>/index.html, and that file is
    // produced by a separate regen step. So the first version of this suite
    // went green while the artifact still carried three JobPostings on
    // /careers and no file at all for the three new leaves — a config flag
    // reporting a fix the crawler could not see.
    //
    // scripts/check-prerender.mjs did not catch it either: it only fails above
    // FIVE missing files, and this change adds exactly three.
    const read = (p: string) => {
      try {
        return readFileSync(resolve(APP, p), "utf8");
      } catch {
        return null;
      }
    };

    const list = read("prerendered/careers/index.html");
    expect(list, "prerendered/careers/index.html is missing entirely").not.toBeNull();
    const listBlocks = (list!.match(/"@type"s*:s*"JobPosting"/g) ?? []).length;
    expect(
      listBlocks,
      `the artifact Googlebot receives for /careers still carries ${listBlocks} JobPosting object(s) — run the prerender refresh`,
    ).toBe(0);

    for (const job of openJobOpenings()) {
      const html = read(`prerendered/careers/${job.slug}/index.html`);
      expect(
        html,
        `prerendered/careers/${job.slug}/index.html does not exist — this URL is in the sitemap and serves an empty SPA shell to crawlers`,
      ).not.toBeNull();
      const n = (html!.match(/"@type"s*:s*"JobPosting"/g) ?? []).length;
      expect(n, `${job.slug} artifact carries ${n} JobPosting objects, expected exactly 1`).toBe(1);
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

  it("validThrough has not already passed — checked against NOW, not datePosted", () => {
    // The first version compared validThrough to datePosted. "2026-12-31 is
    // after 2026-09-09" is true FOREVER, so on 2027-01-01 all three postings
    // would silently expire out of Google Jobs while this test stayed green —
    // an assertion that can never fail is not a guard.
    const now = Date.now();
    for (const job of openJobOpenings()) {
      expect(
        new Date(job.validThrough).getTime(),
        `${job.slug}: validThrough ${job.validThrough} has PASSED — the posting is expired in Google's eyes while the role is still open`,
      ).toBeGreaterThan(now);
      expect(
        new Date(job.validThrough).getTime(),
        `${job.slug}: validThrough precedes datePosted`,
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

describe("pay is published, and the page shows the same number the markup claims", () => {
  // 2026-09-23 · the live JobPosting for every role carried NO baseSalary
  // while the page body said "Up to $35/hr ... up to $25/hr" inside the form.
  // Google Jobs filters and ranks on pay, and 87% of techs want pay in the
  // posting (WrenchWay/ASE 2025). The owner set ranges matched to Enterprise
  // Euclid (docs/recruiting/RECRUITING-ENGINE-2026-09.md).
  //
  // Service advisor was the one exception until the owner set its range
  // (2026-09-23). Every open role now carries pay, and a new role without it
  // fails here until someone decides.
  it("every open role carries a numeric baseSalary", () => {
    for (const job of openJobOpenings()) {
      const s = buildJobPostingSchema(job, CTX)!;
      expect(s.baseSalary, `${job.slug}: open role ships with no baseSalary`).toBeTruthy();
    }
  });

  it("the locked ranges are exactly the owner's numbers", () => {
    expect(formatHourlyPayRange(jobOpeningBySlug("automotive-technician")!)).toBe("$30.00–$37.50/hr");
    expect(formatHourlyPayRange(jobOpeningBySlug("tire-technician")!)).toBe("$22.00–$25.50/hr");
    expect(formatHourlyPayRange(jobOpeningBySlug("service-advisor")!)).toBe("$22.00–$28.00/hr");
  });

  it("the job page renders the pay string, and the form no longer hardcodes a stale ceiling", () => {
    // Structured data must be visible on the page. The old visible copy
    // ("Up to $35/hr ...") disagreed with any range the markup could carry.
    const page = readFileSync(resolve(APP, "client/src/pages/JobPage.tsx"), "utf8");
    expect(page).toContain("formatHourlyPayRange(job)");
    const careers = readFileSync(resolve(APP, "client/src/pages/Careers.tsx"), "utf8");
    expect(careers).not.toMatch(/Up to \$35\/hr/);
    expect(careers).not.toMatch(/up to \$25\/hr/);
  });

  it("description is HTML with list markup and includes the requirements", () => {
    // Google: description is "the full description of the job in HTML format".
    // The live one was plain text with the bullet lists run together and the
    // "What we need" list missing entirely.
    for (const job of openJobOpenings()) {
      const d = String(buildJobPostingSchema(job, CTX)!.description);
      expect(d, job.slug).toMatch(/^<p>/);
      expect(d, job.slug).toContain("<ul><li>");
      for (const r of job.requirements) expect(d, `${job.slug} missing requirement`).toContain(r);
    }
  });

  it("experienceRequirements agrees with the visible requirements list", () => {
    // 2026-09-23 review: tire tech and service advisor emitted nothing; Google
    // asks for the literal "no requirements" when a role has none, and both
    // list prior experience only under "nice".
    const schemaFor = (slug: string) => buildJobPostingSchema(openJobOpenings().find((j) => j.slug === slug)!, CTX);
    expect(schemaFor("automotive-technician")?.experienceRequirements).toMatchObject({
      "@type": "OccupationalExperienceRequirements",
      monthsOfExperience: 24,
    });
    expect(schemaFor("tire-technician")?.experienceRequirements).toBe("no requirements");
    expect(schemaFor("service-advisor")?.experienceRequirements).toBe("no requirements");
    for (const job of openJobOpenings()) {
      if (job.experienceMonths !== 0) continue;
      // "no requirements" is only true while no required line asks for years.
      expect(job.requirements.join(" | "), job.slug).not.toMatch(/\d+\+?\s*(years?|yrs?)\b/i);
    }
  });

  it("the hiring organization logo is an image, not the favicon", () => {
    const page = readFileSync(resolve(APP, "client/src/pages/JobPage.tsx"), "utf8");
    expect(page).not.toContain("/favicon.ico");
  });

  it("route meta descriptions quote the same pay as the job data (no drift)", () => {
    // routes.ts is what the prerendered <meta description> and search
    // snippets carry. It restates the band as text, so pin it here: change the
    // pay in jobOpenings.ts and this fails until the snippet matches.
    for (const job of openJobOpenings()) {
      const pay = formatHourlyPayRange(job);
      if (!pay) continue;
      const route = ROUTES.find((r) => r.path === jobOpeningPath(job.slug));
      const band = pay.replace("/hr", "");
      expect(route?.description, `${job.slug} meta`).toContain(band);
      expect(ROUTES.find((r) => r.path === "/careers")?.description, "/careers meta").toContain(band);
    }
  });
});
