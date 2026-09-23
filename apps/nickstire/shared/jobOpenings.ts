/**
 * Canonical job-opening lifecycle source.
 *
 * WHY THIS FILE EXISTS (measured against production 2026-09-10). The three
 * roles lived as a `POSITIONS` const inside client/src/pages/Careers.tsx, and
 * that page emitted a JobPosting for EACH of them. Verified live in a browser
 * against https://nickstire.org/careers: SIX ld+json blocks, THREE of them
 * `@type: JobPosting`, on ONE URL.
 *
 * Google's job-posting structured-data requirements are explicit that the
 * markup belongs on the most detailed LEAF page containing a single job, and
 * must not sit on a page listing multiple jobs. So the postings were, at best,
 * ambiguous to Google: it cannot tell which job the URL is about. The three
 * `identifier.value` slugs (automotive-technician, service-advisor,
 * tire-technician) existed only inside the schema — `/careers/automotive-
 * technician` returned the 404 page, verified live.
 *
 * Two more defects found in the same live inspection:
 *
 *   baseSalary was a HOLLOW OBJECT. It emitted
 *     { MonetaryAmount, currency: "USD", value: { QuantitativeValue,
 *       unitText: "HOUR" } }
 *   with no `value`, no `minValue`, no `maxValue`. That is a declaration that
 *   salary data exists, carrying none. Worse than omitting it: a consumer
 *   reading the field sees a salary object and finds nothing in it. Here
 *   baseSalary is built ONLY when a real hourly number exists, and omitted
 *   entirely otherwise — see buildJobPostingSchema.
 *
 *   validThrough was absent on all three. Without it a posting has no
 *   expiry, so a filled role keeps advertising itself until someone
 *   remembers to delete code.
 *
 * The lifecycle rule this file encodes: ONE object per opening drives the
 * human page, the JSON-LD, the sitemap entry and the Indexing API
 * notification. Closing a role in ONE place must reverse all four, rather
 * than leaving a stale listing that a candidate can still find and apply to.
 */

/** `open` is the only state that may be indexed or advertised. */
export type JobOpeningStatus = "open" | "filled" | "closed";

export interface JobOpening {
  /** URL slug. The leaf page is `/careers/<slug>` and that is its canonical. */
  slug: string;
  title: string;
  /** Human-facing employment label, e.g. "Full-Time". */
  type: string;
  /** Human-facing seniority label, e.g. "Mid to Senior". */
  level: string;
  /** schema.org employmentType token. */
  employmentType: "FULL_TIME" | "PART_TIME" | "CONTRACTOR" | "TEMPORARY" | "INTERN";
  description: string;
  responsibilities: string[];
  requirements: string[];
  nice: string[];
  status: JobOpeningStatus;
  /**
   * Fixed original posting date — NOT recomputed on render. Google's
   * job-posting content policy bans resetting datePosted when nothing about
   * the job changed; doing so can trigger a manual action removing EVERY
   * posting on the site from Google Jobs, not just one role. Update by hand,
   * deliberately, only when a role's actual terms change.
   */
  datePosted: string;
  /**
   * ISO date after which the posting is no longer valid. Required for an open
   * role: a posting with no expiry outlives the job it advertises. Refresh it
   * deliberately alongside a real review of the role — do not auto-extend, or
   * it becomes decoration.
   */
  validThrough: string;
  /**
   * Real hourly pay band in CENTS, or null when the shop genuinely will not
   * publish one. NEVER emit a baseSalary object without these — see the file
   * header. Both null means baseSalary is omitted from the schema entirely.
   */
  salaryMinHourlyCents: number | null;
  salaryMaxHourlyCents: number | null;
  /**
   * Minimum hands-on experience in months, or null for none. Must agree with
   * the visible requirements list (e.g. "2+ years" = 24). Emitted as Google's
   * experienceRequirements.monthsOfExperience.
   */
  experienceMonths: number | null;
}

export const JOB_OPENINGS: JobOpening[] = [
  {
    slug: "automotive-technician",
    title: "Automotive Technician",
    type: "Full-Time",
    level: "Mid to Senior",
    employmentType: "FULL_TIME",
    description:
      "You diagnose correctly the first time, explain your findings clearly, and take pride in work you'd put on your own car. We have the equipment, the workflow, and the customer base. You bring the skill and the standards.",
    responsibilities: [
      "Perform accurate diagnosis using OBD-II scanners and live data analysis",
      "Complete brake, suspension, engine, and drivetrain repairs to manufacturer spec",
      "Document findings clearly so the service advisor can explain them to the customer",
      "Flag safety-critical issues and communicate urgency without pressure tactics",
      "Maintain a clean bay and organized toolset",
      "Mentor entry-level techs when appropriate",
    ],
    requirements: [
      "2+ years of hands-on automotive repair experience",
      "Competence in brakes, suspension, basic engine and drivetrain work",
      "Valid Ohio driver's license",
      "Your own tools (specialty tools provided by the shop)",
      "Ability to communicate findings to non-technical service staff",
    ],
    nice: [
      "ASE certification (one or more areas)",
      "Experience with domestic and import vehicles",
      "Diagnostic experience with intermittent faults",
    ],
    status: "open",
    datePosted: "2026-09-09",
    validThrough: "2026-12-31",
    // 2026-09-23 · owner decision: match Enterprise Mobility's Euclid service
    // center ($30/hr start, up to $37.50 with ASE step-ups, posted 2026). This
    // is a public pay floor the shop must honour — change it only with the
    // owner. Research: docs/recruiting/RECRUITING-ENGINE-2026-09.md.
    salaryMinHourlyCents: 3000,
    salaryMaxHourlyCents: 3750,
    experienceMonths: 24,
  },
  {
    slug: "service-advisor",
    title: "Service Advisor",
    type: "Full-Time",
    level: "Entry to Mid",
    employmentType: "FULL_TIME",
    description:
      "You're the bridge between the technician and the customer. Your job is to translate what the mechanic found into language the customer can act on — without pressure, without omission, and without condescension. If you've been in a shop that operated differently, this is your chance to do it right.",
    responsibilities: [
      "Greet customers and listen to what they're experiencing with their vehicle",
      "Communicate technician findings clearly and honestly, including photos when available",
      "Present estimates with a priority breakdown — what's urgent, what can wait",
      "Answer questions without upselling or minimizing concerns",
      "Schedule follow-up appointments and manage repair workflow",
      "Handle phone inquiries and walk-ins with equal care",
    ],
    requirements: [
      "Genuine communication skills — you explain things clearly to people who aren't mechanics",
      "Basic automotive knowledge sufficient to understand and relay repair findings",
      "Comfort with a fast-paced, customer-facing environment",
      "Ability to stay organized during busy periods",
      "Valid Ohio driver's license",
    ],
    nice: [
      "Previous service advisor or customer-facing automotive experience",
      "Experience with shop management software",
      "Bilingual (Spanish, Arabic, or other languages common in our community)",
    ],
    status: "open",
    datePosted: "2026-09-09",
    validThrough: "2026-12-31",
    // Owner has not set a service advisor range yet (2026-09-23). Null means
    // no baseSalary and no visible figure — never a guessed number.
    salaryMinHourlyCents: null,
    salaryMaxHourlyCents: null,
    experienceMonths: null,
  },
  {
    slug: "tire-technician",
    title: "Tire / Hybrid Technician",
    type: "Full-Time",
    level: "Entry to Mid",
    employmentType: "FULL_TIME",
    description:
      "The role that keeps us running. Fast hands, attention to TPMS sensors, and the discipline to torque lug nuts to spec without skipping steps. Tires are the core of this shop — the pace is real, and the pay is hourly.",
    responsibilities: [
      "Mount, balance, and install tires on cars, trucks, SUVs, and fleet vans",
      "Perform TPMS sensor service and resets",
      "Repair flats using proper plug-and-patch method (no rope plugs)",
      "Inspect tires for wear patterns that indicate alignment or suspension issues",
      "Rotate tires and torque to spec",
      "Maintain a clean, organized workspace",
    ],
    requirements: [
      "Physical ability to lift tires and work on your feet throughout the shift",
      "Mechanical aptitude — you follow specs, not shortcuts",
      "Valid Ohio driver's license",
      "Attention to detail (TPMS, torque spec, valve stem condition)",
    ],
    nice: [
      "Previous tire shop or automotive experience",
      "Comfort operating tire mounting and balancing equipment",
      "Ability to work efficiently during high-volume periods",
    ],
    status: "open",
    datePosted: "2026-09-09",
    validThrough: "2026-12-31",
    // 2026-09-23 · owner decision: matched to Enterprise Euclid's associate
    // range. Public pay floor — change only with the owner.
    salaryMinHourlyCents: 2200,
    salaryMaxHourlyCents: 2550,
    experienceMonths: null,
  },
];

/** Canonical leaf path for an opening. The ONLY URL its JobPosting may claim. */
export function jobOpeningPath(slug: string): string {
  return `/careers/${slug}`;
}

/** Openings eligible to be indexed, advertised and notified. */
export function openJobOpenings(): JobOpening[] {
  return JOB_OPENINGS.filter((j) => j.status === "open");
}

export function jobOpeningBySlug(slug: string): JobOpening | undefined {
  return JOB_OPENINGS.find((j) => j.slug === slug);
}

/**
 * Visible hourly pay string, e.g. "$30.00–$37.50/hr", or null when the role
 * has no published band. The job page renders THIS so the visible figure and
 * baseSalary can never disagree — Google requires markup to match the page.
 */
export function formatHourlyPayRange(job: JobOpening): string | null {
  const { salaryMinHourlyCents: lo, salaryMaxHourlyCents: hi } = job;
  if (lo == null && hi == null) return null;
  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
  if (lo != null && hi != null && lo !== hi) return `${fmt(lo)}–${fmt(hi)}/hr`;
  return `${fmt((lo ?? hi)!)}/hr`;
}

function escapeHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function htmlList(heading: string, items: string[]): string {
  if (items.length === 0) return "";
  return `<p><strong>${heading}</strong></p><ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
}

/**
 * Google: description is "the full description of the job in HTML format".
 * The first version joined description + responsibilities into one run-on
 * plain-text string and dropped the requirements list entirely. Every string
 * here is also rendered visibly on the job page.
 */
export function buildJobDescriptionHtml(job: JobOpening, shopHours: string): string {
  const pay = formatHourlyPayRange(job);
  return [
    `<p>${escapeHtml(job.description)}</p>`,
    htmlList("What you'll do", job.responsibilities),
    htmlList("What we need", job.requirements),
    htmlList("Nice to have", job.nice),
    pay ? `<p><strong>Pay:</strong> ${escapeHtml(pay)}, hourly.</p>` : "",
    `<p><strong>Shop hours:</strong> ${escapeHtml(shopHours)}</p>`,
  ].join("");
}

/**
 * Build the JobPosting for ONE opening.
 *
 * Returns null for a non-open role, so a filled job cannot emit structured
 * data by accident — the caller renders nothing rather than a stale listing.
 */
export function buildJobPostingSchema(
  job: JobOpening,
  ctx: {
    siteUrl: string;
    orgName: string;
    logoUrl: string;
    /** Visible shop-hours line, e.g. BUSINESS.hours.display. */
    shopHours: string;
    address: { street: string; city: string; state: string; zip: string };
  },
): Record<string, unknown> | null {
  if (job.status !== "open") return null;

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: buildJobDescriptionHtml(job, ctx.shopHours),
    identifier: { "@type": "PropertyValue", name: ctx.orgName, value: job.slug },
    datePosted: job.datePosted,
    validThrough: job.validThrough,
    employmentType: job.employmentType,
    // The application form lives ON this leaf page and submits straight to
    // candidates.submit — no third-party redirect, no intermediate step — so
    // directApply is a truthful claim here. It stops being true the moment
    // applying routes anywhere else; re-check before changing the form.
    directApply: true,
    hiringOrganization: {
      "@type": "Organization",
      name: ctx.orgName,
      sameAs: ctx.siteUrl,
      logo: ctx.logoUrl,
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        streetAddress: ctx.address.street,
        addressLocality: ctx.address.city,
        addressRegion: ctx.address.state,
        postalCode: ctx.address.zip,
        addressCountry: "US",
      },
    },
  };

  // baseSalary ONLY when a real number backs it. The production defect this
  // replaces emitted the wrapper with an empty QuantitativeValue inside.
  const { salaryMinHourlyCents: lo, salaryMaxHourlyCents: hi } = job;
  if (lo != null || hi != null) {
    const value: Record<string, unknown> = { "@type": "QuantitativeValue", unitText: "HOUR" };
    if (lo != null && hi != null && lo !== hi) {
      value.minValue = lo / 100;
      value.maxValue = hi / 100;
    } else {
      value.value = (lo ?? hi)! / 100;
    }
    schema.baseSalary = { "@type": "MonetaryAmount", currency: "USD", value };
  }

  if (job.experienceMonths != null) {
    schema.experienceRequirements = {
      "@type": "OccupationalExperienceRequirements",
      monthsOfExperience: job.experienceMonths,
    };
  }

  return schema;
}
