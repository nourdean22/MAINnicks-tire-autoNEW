/**
 * Careers — Nick's Tire & Auto talent magnet page.
 * Targets skilled technicians who are tired of dealership chaos and flat-rate grind.
 * Built for search: JobPosting schema, plain-language job descriptions, local SEO.
 */
import { useState } from "react";
import InternalLinks from "@/components/InternalLinks";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import PageLayout from "@/components/PageLayout";
import { SEOHead } from "@/components/SEO";
import { Link } from "wouter";
import { BUSINESS, SITE_URL } from "@shared/business";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
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
  Star,
  Send,
  Loader2,
  Gift,
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
    title: "Tire / Hybrid Technician",
    type: "Full-Time",
    level: "Entry to Mid",
    description:
      "The role that keeps us running. Fast hands, attention to TPMS sensors, and the discipline to torque lug nuts to spec without skipping steps. We're one of Cleveland's busiest tire operations — there's always work, the pace is real, and the money is consistent.",
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
    heading: "Consistent work, consistent money",
    body: "We're one of Cleveland's busiest shops. The volume is here every single day. You won't sit around waiting for cars — you'll stay busy, your hours are full, and your check is reliable. This is the kind of place where you can raise a family.",
  },
  {
    icon: Wrench,
    heading: "You won't be dropping motors",
    body: "Most of our work is tires, brakes, diagnostics, and general maintenance — the bread and butter that keeps a shop alive. You're not pulling engines on 20-year-old trucks. You're doing real work at a real pace without destroying your body.",
  },
  {
    icon: TrendingUp,
    heading: "Room to grow",
    body: "If you want to develop diagnostics skills, move into a senior role, or eventually advise on shop operations, we're interested in growing with you. Pay scales with experience and what you bring to the table.",
  },
  {
    icon: Users,
    heading: "4.9 stars. 1,685+ reviews.",
    body: "That's not marketing — that's what our customers actually say. You'll work at a shop people trust and recommend. That kind of reputation means steady customers and a team that does things right.",
  },
  {
    icon: Clock,
    heading: "Predictable schedule",
    body: `${BUSINESS.hours.display}. Sunday hours available for those who want them. No midnight calls. No drama. Show up, do good work, go home to your family.`,
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
    datePosted: new Date().toISOString().split("T")[0],
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
        unitText: "HOUR",
      },
    },
    qualifications: "Compensation depends on experience, skill level, and what you bring to the table. Competitive hourly pay — we take care of people who take care of our customers.",
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
        <div className="flex flex-wrap items-start justify-between gap-3 stagger-in">
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
              <li key={r} className="flex items-start gap-2 stagger-in text-sm text-foreground/75">
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
              <li key={r} className="flex items-start gap-2 stagger-in text-sm text-foreground/75">
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
                <li key={n} className="flex items-start gap-2 stagger-in text-sm text-foreground/50">
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
          href="#apply"
          className="flex items-center justify-center gap-2 stagger-in w-full bg-primary text-primary-foreground btn-premium py-3 rounded-xl font-semibold text-sm tracking-wide hover:opacity-90 transition-opacity"
        >
          Apply for {pos.title}
          <ArrowRight className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}

// ─── APPLICATION FORM ─────────────────────────────────────
function ApplicationForm() {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    position: POSITIONS[0].title,
    experience: "",
    message: "",
    referredBy: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const submitLead = trpc.lead.submit.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: () => toast.error("Something went wrong. Please call us instead."),
  });

  if (submitted) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center">
        <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-4" />
        <h3 className="font-heading text-xl font-extrabold uppercase text-foreground mb-2">
          Application Received
        </h3>
        <p className="text-sm text-foreground/60">
          We'll review your info and reach out within 48 hours. If you'd like to follow up,
          call us at <a href={BUSINESS.phone.href} className="text-primary font-semibold">{BUSINESS.phone.display}</a>.
        </p>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) {
      toast.error("Name and phone are required.");
      return;
    }
    const problemText = [
      `Position: ${form.position}`,
      form.experience && `Experience: ${form.experience}`,
      form.message && `About: ${form.message}`,
      form.referredBy && `Referred by: ${form.referredBy}`,
    ].filter(Boolean).join("\n");

    submitLead.mutate({
      name: form.name,
      phone: form.phone,
      email: form.email || undefined,
      problem: problemText,
      source: "careers",
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold tracking-[0.05em] uppercase text-foreground/40 block mb-1.5">
            Name *
          </label>
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Your full name"
            className="w-full bg-[oklch(0.08_0.004_260)] border border-border/30 rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-foreground/25 focus:border-primary/50 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-xs font-semibold tracking-[0.05em] uppercase text-foreground/40 block mb-1.5">
            Phone *
          </label>
          <input
            type="tel"
            required
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="(216) 555-0000"
            className="w-full bg-[oklch(0.08_0.004_260)] border border-border/30 rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-foreground/25 focus:border-primary/50 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold tracking-[0.05em] uppercase text-foreground/40 block mb-1.5">
          Email (optional)
        </label>
        <input
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          placeholder="your@email.com"
          className="w-full bg-[oklch(0.08_0.004_260)] border border-border/30 rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-foreground/25 focus:border-primary/50 focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold tracking-[0.05em] uppercase text-foreground/40 block mb-1.5">
            Position
          </label>
          <select
            value={form.position}
            onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
            className="w-full bg-[oklch(0.08_0.004_260)] border border-border/30 rounded-lg px-4 py-3 text-sm text-foreground focus:border-primary/50 focus:outline-none"
          >
            {POSITIONS.map((p) => (
              <option key={p.schemaId} value={p.title}>{p.title}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold tracking-[0.05em] uppercase text-foreground/40 block mb-1.5">
            Experience Level
          </label>
          <select
            value={form.experience}
            onChange={(e) => setForm((f) => ({ ...f, experience: e.target.value }))}
            className="w-full bg-[oklch(0.08_0.004_260)] border border-border/30 rounded-lg px-4 py-3 text-sm text-foreground focus:border-primary/50 focus:outline-none"
          >
            <option value="">Select...</option>
            <option value="entry">Entry Level (0-1 years)</option>
            <option value="mid">Mid Level (2-4 years)</option>
            <option value="senior">Senior (5+ years)</option>
            <option value="master">Master Tech (10+ years)</option>
          </select>
          <p className="text-[10px] text-foreground/30 mt-1">
            Pay depends on experience and what you bring. Up to $35/hr for master techs, up to $25/hr for tire/hybrid techs.
          </p>
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold tracking-[0.05em] uppercase text-foreground/40 block mb-1.5">
          Tell us about yourself
        </label>
        <textarea
          value={form.message}
          onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
          placeholder="What kind of work have you done? What are you looking for? Keep it brief — we'll talk details in person."
          rows={3}
          className="w-full bg-[oklch(0.08_0.004_260)] border border-border/30 rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-foreground/25 focus:border-primary/50 focus:outline-none resize-none"
        />
      </div>

      <div>
        <label className="text-xs font-semibold tracking-[0.05em] uppercase text-foreground/40 block mb-1.5">
          Referred by (optional)
        </label>
        <input
          type="text"
          value={form.referredBy}
          onChange={(e) => setForm((f) => ({ ...f, referredBy: e.target.value }))}
          placeholder="Who told you about us?"
          className="w-full bg-[oklch(0.08_0.004_260)] border border-border/30 rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-foreground/25 focus:border-primary/50 focus:outline-none"
        />
      </div>

      <button
        type="submit"
        disabled={submitLead.isPending}
        className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground btn-premium py-3.5 rounded-xl font-semibold text-sm tracking-wide hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {submitLead.isPending ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Submitting...</>
        ) : (
          <><Send className="w-4 h-4" /> Submit Application</>
        )}
      </button>
    </form>
  );
}

// ─── PAGE ─────────────────────────────────────────────────
export default function Careers() {
  return (
    <PageLayout activeHref="/careers" showChat={true}>
      <SEOHead
        title="Careers | Nick's Tire & Auto Cleveland — We're Hiring"
        description="We're hiring automotive technicians, service advisors, and tire techs in Cleveland, Ohio. Family-owned shop. Honest work environment. No flat-rate grind. Apply now."
        canonicalPath="/careers"
      />
      <JobPostingSchemas />
      <LocalBusinessSchema />

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
            <div className="mt-8 flex flex-wrap gap-4 stagger-in">
              <a
                href="#apply"
                className="inline-flex items-center gap-2 stagger-in bg-primary text-primary-foreground btn-premium px-6 py-3 rounded-xl font-semibold text-sm tracking-wide hover:opacity-90 transition-opacity"
              >
                Apply Now
                <ArrowRight className="w-4 h-4" />
              </a>
              <a
                href={BUSINESS.phone.href}
                className="inline-flex items-center gap-2 stagger-in border border-border/40 text-foreground/80 px-6 py-3 rounded-xl font-semibold text-sm tracking-wide hover:border-primary/40 transition-colors"
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 stagger-in">
            {WHY_WORK.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.heading}
                  className="flex items-start gap-4 stagger-in rounded-xl border border-border/25 bg-[oklch(0.07_0.004_260)] p-5"
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
                <li key={trait} className="flex items-start gap-3 stagger-in text-sm text-foreground/80">
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 stagger-in">
            {POSITIONS.map((pos) => (
              <PositionCard key={pos.schemaId} pos={pos} />
            ))}
          </div>
        </div>
      </section>

      {/* ─── WHAT OUR CUSTOMERS SAY ─────────────────────── */}
      <section className="bg-[oklch(0.055_0.004_260)] py-16 lg:py-20 border-t border-border/20">
        <div className="container">
          <div className="mb-10">
            <p className="text-xs font-semibold tracking-[0.12em] uppercase text-foreground/40 mb-3">
              Don't take our word for it
            </p>
            <h2 className="font-heading text-4xl lg:text-5xl font-extrabold uppercase text-foreground leading-tight">
              What Our <span className="text-nick-yellow">Customers</span> Say
            </h2>
            <p className="mt-4 text-foreground/55 max-w-xl leading-relaxed">
              4.9 stars across 1,685+ Google reviews. When customers trust a shop like this, it means the
              work is real, the team is solid, and the money keeps coming in.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 stagger-in">
            {[
              { text: "Fastest tire shop in Cleveland. I was in and out in 20 minutes. The guys know what they're doing and they don't waste your time.", author: "Mike R." },
              { text: "I've been coming here for 3 years. They always tell me what's actually wrong — no upselling, no pressure. Honest shop, honest people.", author: "Jasmine T." },
              { text: "They showed me my brakes before doing anything. Explained exactly what needed to be done and what could wait. This is how every shop should operate.", author: "David K." },
            ].map((review) => (
              <div key={review.author} className="stagger-in rounded-xl border border-border/25 bg-[oklch(0.07_0.004_260)] p-5">
                <div className="flex items-center gap-0.5 mb-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="w-3.5 h-3.5 fill-nick-yellow text-nick-yellow" />
                  ))}
                </div>
                <p className="text-sm text-foreground/70 leading-relaxed italic mb-3">"{review.text}"</p>
                <p className="text-xs font-semibold text-foreground/50">{review.author}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 text-center">
            <a href="https://www.google.com/maps/place/Nick's+Tire+%26+Auto/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-primary hover:opacity-80 transition-opacity">
              See all 1,685+ reviews on Google <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>

      {/* ─── APPLY NOW ────────────────────────────────────── */}
      <section id="apply" className="bg-[oklch(0.065_0.004_260)] py-16 lg:py-20 border-t border-border/20">
        <div className="container">
          <div className="max-w-2xl mx-auto">
            <h2 className="font-heading text-3xl font-extrabold uppercase text-foreground mb-2">
              Apply in 2 Minutes
            </h2>
            <p className="text-sm text-foreground/55 leading-relaxed mb-8">
              No resume required. Tell us who you are and what you can do. We respond within 48 hours.
            </p>
            <ApplicationForm />
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-start gap-4 stagger-in rounded-xl border border-border/25 bg-[oklch(0.07_0.004_260)] p-5">
                <Phone className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground/90">Call or stop in</p>
                  <a href={BUSINESS.phone.href} className="text-sm text-primary hover:opacity-80 transition-opacity">{BUSINESS.phone.display}</a>
                  <p className="mt-1 text-xs text-foreground/45">Walk-ins welcome during business hours.</p>
                </div>
              </div>
              <div className="flex items-start gap-4 stagger-in rounded-xl border border-border/25 bg-[oklch(0.07_0.004_260)] p-5">
                <Wrench className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground/90">Come in person</p>
                  <p className="text-sm text-foreground/65">{BUSINESS.address.full}</p>
                  <p className="mt-1 text-xs text-foreground/45">{BUSINESS.hours.display}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── REFERRAL BONUS ───────────────────────────────── */}
      <section className="bg-[oklch(0.055_0.004_260)] py-12 lg:py-16 border-t border-border/20">
        <div className="container">
          <div className="max-w-2xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 bg-nick-yellow/10 border border-nick-yellow/20 text-nick-yellow px-4 py-2 rounded-full mb-4">
              <Gift className="w-4 h-4" />
              <span className="text-sm font-semibold tracking-wide">REFERRAL BONUS</span>
            </div>
            <h3 className="font-heading text-2xl font-extrabold uppercase text-foreground mb-3">
              Know a Good Mechanic?
            </h3>
            <p className="text-sm text-foreground/60 leading-relaxed max-w-lg mx-auto">
              Refer a technician who gets hired and stays 90 days — you get <span className="font-bold text-nick-yellow">$300 cash</span>.
              Customers who refer a new hire get <span className="font-bold text-nick-yellow">free services on us</span>.
              Just tell them to mention your name when they apply.
            </p>
          </div>
        </div>
      </section>

      <div className="bg-[oklch(0.055_0.004_260)] py-8 border-t border-border/10">
        <div className="container">
          <p className="text-xs text-foreground/35 leading-relaxed text-center">
            Nick's Tire & Auto is an equal opportunity employer. We evaluate all candidates on skill, character, and fit — nothing else.
          </p>
        </div>
      </div>
      <InternalLinks />
    </PageLayout>
  );
}
