/**
 * Careers — Nick's Tire & Auto talent magnet page.
 * Targets skilled technicians who are tired of dealership chaos and flat-rate grind.
 * Built for search: JobPosting schema, plain-language job descriptions, local SEO.
 */
import PageLayout from "@/components/PageLayout";
import { SEOHead } from "@/components/SEO";
import { Link } from "wouter";
import { BUSINESS, SITE_URL } from "@shared/business";
import {
  Wrench,
  Shield,
  TrendingUp,
  Users,
  Clock,
  CheckCircle2,
  ArrowRight,
  Phone,
  Mail,
} from "lucide-react";

// ─── TYPES ────────────────────────────────────────────────
interface Position {
  title: string;
  type: string;
  level: string;
  description: string;
  responsibilities: string[];
  requirements: string[];
  nice: string[];
  schemaId: string;
}

// ─── POSITIONS ────────────────────────────────────────────
const POSITIONS: Position[] = [
  {
    title: "Automotive Technician",
    type: "Full-Time",
    level: "Mid to Senior",
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
    schemaId: "automotive-technician",
  },
  {
    title: "Service Advisor",
    type: "Full-Time",
    level: "Entry to Mid",
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
      "Genuine communication skills — you explain things clearly to non-experts",
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
    schemaId: "service-advisor",
  },
  {
    title: "Tire Technician",
    type: "Full-Time",
    level: "Entry to Mid",
    description:
      "The role that keeps us running. Fast hands, attention to TPMS sensors, and the discipline to torque lug nuts to spec without skipping steps. We're one of Cleveland's busiest tire operations — there's always work, and the pace is real.",
    responsibilities: [
      "Mount, balance, and install tires on a wide range of vehicles",
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
    schemaId: "tire-technician",
  },
];

// ─── WHY WORK HERE ────────────────────────────────────────
const WHY_WORK = [
  {
    icon: Shield,
    heading: "Systems, not chaos",
    body: "We have documented processes for intake, diagnosis, and customer communication. You don't have to improvise your way through every shift.",
  },
  {
    icon: Wrench,
    heading: "Respect for the craft",
    body: "We don't skip steps to turn cars faster. We do the job right, document it, and stand behind it. Techs who take pride in their work fit here.",
  },
  {
    icon: TrendingUp,
    heading: "Room to grow",
    body: "If you want to develop diagnostics skills, move into a senior role, or eventually advise on shop operations, we're interested in growing with you.",
  },
  {
    icon: Users,
    heading: "A team that treats people right",
    body: "We have regulars who've been coming here for years. That doesn't happen when you rip people off. We're the shop people send their mothers to.",
  },
  {
    icon: Clock,
    heading: "Predictable schedule",
    body: `${BUSINESS.hours.display}. Sunday hours available for those who want them. We don't ask you to be on call at midnight.`,
  },
];

// ─── CHARACTER EXPECTATIONS ───────────────────────────────
const CHARACTER_TRAITS = [
  "You do the job right even when no one is watching",
  "You tell the customer what you found — not what they want to hear, not more than they need",
  "You ask when you're unsure rather than guessing on someone's safety",
  "You treat every vehicle like it belongs to someone who depends on it",
  "You leave your bay cleaner than you found it",
];

// ─── JSON-LD JOB POSTING SCHEMAS ─────────────────────────
function JobPostingSchemas() {
  const schemas = POSITIONS.map((pos) => ({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: pos.title,
    description: [pos.description, ...pos.responsibilities].join(" "),
    identifier: {
      "@type": "PropertyValue",
      name: BUSINESS.name,
      value: pos.schemaId,
    },
    datePosted: "2025-01-01",
    employmentType: "FULL_TIME",
    hiringOrganization: {
      "@type": "Organization",
      name: BUSINESS.name,
      sameAs: SITE_URL,
      logo: `${SITE_URL}/favicon.ico`,
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        streetAddress: BUSINESS.address.street,
        addressLocality: BUSINESS.address.city,
        addressRegion: BUSINESS.address.state,
        postalCode: BUSINESS.address.zip,
        addressCountry: "US",
      },
    },
    baseSalary: {
      "@type": "MonetaryAmount",
      currency: "USD",
      value: {
        "@type": "QuantitativeValue",
        minValue: pos.title === "Automotive Technician" ? 20 : pos.title === "Service Advisor" ? 15 : 14,
        maxValue: pos.title === "Automotive Technician" ? 35 : pos.title === "Service Advisor" ? 25 : 20,
        unitText: "HOUR",
      },
    },
  }));

  return (
    <>
      {schemas.map((schema, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
    </>
  );
}

// ─── POSITION CARD ────────────────────────────────────────
function PositionCard({ pos }: { pos: Position }) {
  return (
    <div className="rounded-2xl border border-border/25 bg-[oklch(0.07_0.004_260)] overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-border/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-heading text-2xl font-extrabold uppercase text-foreground tracking-wide">
              {pos.title}
            </h3>
            <p className="mt-1 text-sm text-foreground/50">{pos.level}</p>
          </div>
          <span className="text-xs font-semibold tracking-wide uppercase text-primary bg-primary/10 border border-primary/20 px-3 py-1 rounded-full shrink-0">
            {pos.type}
          </span>
        </div>
        <p className="mt-4 text-sm text-foreground/70 leading-relaxed">{pos.description}</p>
      </div>

      {/* Body */}
      <div className="p-6 space-y-6">
        {/* Responsibilities */}
        <div>
          <p className="text-xs font-semibold tracking-[0.1em] uppercase text-foreground/40 mb-3">
            What you'll do
          </p>
          <ul className="space-y-2">
            {pos.responsibilities.map((r) => (
              <li key={r} className="flex items-start gap-2 text-sm text-foreground/75">
                <CheckCircle2 className="w-3.5 h-3.5 text-primary/60 shrink-0 mt-0.5" />
                {r}
              </li>
            ))}
          </ul>
        </div>

        {/* Requirements */}
        <div>
          <p className="text-xs font-semibold tracking-[0.1em] uppercase text-foreground/40 mb-3">
            What we need
          </p>
          <ul className="space-y-2">
            {pos.requirements.map((r) => (
              <li key={r} className="flex items-start gap-2 text-sm text-foreground/75">
                <span className="mt-2 w-1 h-1 rounded-full bg-foreground/40 shrink-0" />
                {r}
              </li>
            ))}
          </ul>
        </div>

        {/* Nice to have */}
        {pos.nice.length > 0 && (
          <div>
            <p className="text-xs font-semibold tracking-[0.1em] uppercase text-foreground/40 mb-3">
              Nice to have
            </p>
            <ul className="space-y-2">
              {pos.nice.map((n) => (
                <li key={n} className="flex items-start gap-2 text-sm text-foreground/50">
                  <span className="mt-2 w-1 h-1 rounded-full bg-foreground/25 shrink-0" />
                  {n}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Apply CTA */}
      <div className="px-6 pb-6">
        <a
          href={`mailto:jobs@nickstire.org?subject=Application: ${pos.title}`}
          className="flex items-center justify-center gap-2 w-full bg-primary text-primary-foreground py-3 rounded-xl font-semibold text-sm tracking-wide hover:opacity-90 transition-opacity"
        >
          Apply for {pos.title}
          <ArrowRight className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}

// ─── PAGE ─────────────────────────────────────────────────
export default function Careers() {
  return (
    <PageLayout activeHref="/careers">
      <SEOHead
        title="Careers | Nick's Tire & Auto Cleveland — We're Hiring"
        description="We're hiring automotive technicians, service advisors, and tire techs in Cleveland, Ohio. Family-owned shop. Honest work environment. No flat-rate grind. Apply now."
        canonicalPath="/careers"
      />
      <JobPostingSchemas />

      {/* ─── HERO ───────────────────────────────────────── */}
      <section className="relative bg-[oklch(0.055_0.004_260)] pt-28 pb-20 lg:pt-36 lg:pb-28 border-b border-border/20">
        <div className="container">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold tracking-[0.12em] uppercase text-foreground/40 mb-4">
              Now Hiring · Cleveland, Ohio
            </p>
            <h1 className="font-heading text-5xl lg:text-7xl font-extrabold uppercase text-foreground leading-[0.95] tracking-tight">
              Work at a Shop
              <br />
              <span className="text-nick-yellow">You're Proud Of</span>
            </h1>
            <p className="mt-6 text-lg lg:text-xl text-foreground/65 max-w-xl leading-relaxed">
              We're Cleveland's most-reviewed auto repair shop for a reason. We hire people who care
              about doing the job right. If that's you, we want to talk.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <a
                href="#positions"
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-xl font-semibold text-sm tracking-wide hover:opacity-90 transition-opacity"
              >
                See Open Positions
                <ArrowRight className="w-4 h-4" />
              </a>
              <a
                href={BUSINESS.phone.href}
                className="inline-flex items-center gap-2 border border-border/40 text-foreground/80 px-6 py-3 rounded-xl font-semibold text-sm tracking-wide hover:border-primary/40 transition-colors"
              >
                <Phone className="w-4 h-4" />
                Call to Inquire
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ─── WHY WORK HERE ─────────────────────────────── */}
      <section className="bg-[oklch(0.065_0.004_260)] py-20 lg:py-28">
        <div className="container">
          <div className="mb-12">
            <p className="text-xs font-semibold tracking-[0.12em] uppercase text-foreground/40 mb-3">
              Why Nick's
            </p>
            <h2 className="font-heading text-4xl lg:text-5xl font-extrabold uppercase text-foreground leading-tight">
              What makes this shop{" "}
              <span className="text-nick-yellow">different</span>
            </h2>
            <p className="mt-4 text-foreground/55 max-w-xl leading-relaxed">
              If you've worked at shops where speed trumps quality, where advisors upsell without
              shame, or where techs are blamed when customers are unhappy — this is a different
              operation.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {WHY_WORK.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.heading}
                  className="flex items-start gap-4 rounded-xl border border-border/25 bg-[oklch(0.07_0.004_260)] p-5"
                >
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-foreground/90 leading-snug">
                      {item.heading}
                    </p>
                    <p className="mt-1.5 text-xs text-foreground/55 leading-relaxed">{item.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── CHARACTER EXPECTATIONS ────────────────────── */}
      <section className="bg-[oklch(0.055_0.004_260)] py-16 lg:py-20">
        <div className="container">
          <div className="max-w-2xl">
            <h2 className="font-heading text-3xl font-extrabold uppercase text-foreground mb-6">
              What We Look For
            </h2>
            <p className="text-sm text-foreground/55 mb-6 leading-relaxed">
              Beyond technical skills, these are the character traits we consistently see in the
              people who thrive here:
            </p>
            <ul className="space-y-3">
              {CHARACTER_TRAITS.map((trait) => (
                <li key={trait} className="flex items-start gap-3 text-sm text-foreground/80">
                  <CheckCircle2 className="w-4 h-4 text-nick-yellow shrink-0 mt-0.5" />
                  {trait}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ─── OPEN POSITIONS ────────────────────────────── */}
      <section id="positions" className="bg-[oklch(0.065_0.004_260)] py-20 lg:py-28">
        <div className="container">
          <div className="mb-12">
            <p className="text-xs font-semibold tracking-[0.12em] uppercase text-foreground/40 mb-3">
              Open Roles
            </p>
            <h2 className="font-heading text-4xl lg:text-5xl font-extrabold uppercase text-foreground leading-tight">
              Current <span className="text-nick-yellow">Openings</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {POSITIONS.map((pos) => (
              <PositionCard key={pos.schemaId} pos={pos} />
            ))}
          </div>
        </div>
      </section>

      {/* ─── HOW TO APPLY ──────────────────────────────── */}
      <section className="bg-[oklch(0.055_0.004_260)] py-16 lg:py-20 border-t border-border/20">
        <div className="container">
          <div className="max-w-2xl">
            <h2 className="font-heading text-3xl font-extrabold uppercase text-foreground mb-4">
              How to Apply
            </h2>
            <p className="text-sm text-foreground/55 leading-relaxed mb-8">
              No long application forms. Send us an email with your name, the position you're
              interested in, and a brief description of your experience. We respond to every
              application within 48 hours.
            </p>

            <div className="space-y-4">
              <div className="flex items-start gap-4 rounded-xl border border-border/25 bg-[oklch(0.07_0.004_260)] p-5">
                <Mail className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground/90">Email us directly</p>
                  <a
                    href="mailto:jobs@nickstire.org"
                    className="text-sm text-primary hover:opacity-80 transition-opacity"
                  >
                    jobs@nickstire.org
                  </a>
                  <p className="mt-1 text-xs text-foreground/45">
                    Subject line: "Application: [Position Name]"
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 rounded-xl border border-border/25 bg-[oklch(0.07_0.004_260)] p-5">
                <Phone className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground/90">Call or stop in</p>
                  <a
                    href={BUSINESS.phone.href}
                    className="text-sm text-primary hover:opacity-80 transition-opacity"
                  >
                    {BUSINESS.phone.display}
                  </a>
                  <p className="mt-1 text-xs text-foreground/45">
                    Ask for the manager. Walk-in introductions welcome during business hours.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 rounded-xl border border-border/25 bg-[oklch(0.07_0.004_260)] p-5">
                <Wrench className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground/90">Come in person</p>
                  <p className="text-sm text-foreground/65">{BUSINESS.address.full}</p>
                  <p className="mt-1 text-xs text-foreground/45">{BUSINESS.hours.display}</p>
                </div>
              </div>
            </div>

            <p className="mt-8 text-xs text-foreground/35 leading-relaxed">
              Nick's Tire & Auto is an equal opportunity employer. We evaluate all candidates on
              skill, character, and fit — nothing else.
            </p>
          </div>
        </div>
      </section>
    </PageLayout>
  );
}
