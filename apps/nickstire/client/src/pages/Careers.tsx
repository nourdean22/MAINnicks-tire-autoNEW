/**
 * Careers — Nick's Tire & Auto talent magnet page.
 * Targets skilled technicians who are tired of dealership chaos and flat-rate grind.
 * Built for search: leaf job pages carry the JobPosting schema (this list page
 * deliberately carries none), plain-language job descriptions, local SEO.
 */
import { useEffect, useState } from "react";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs, trackEvent, trackPhoneClick } from "@/components/SEO";
import { openJobOpenings, jobOpeningPath, formatHourlyPayRange } from "@shared/jobOpenings";
import { Link } from "wouter";
import { BUSINESS, SITE_URL } from "@shared/business";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { getUtmData } from "@/lib/utm";
import {
  CANDIDATE_INTENTS,
  CANDIDATE_INTENT_LABELS,
  MOVE_REASONS,
  MOVE_REASON_LABELS,
  type CandidateIntent,
  type MoveReason,
} from "@shared/candidateLifecycle";
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
  /** Visible hourly band, identical to the leaf page's baseSalary, or null. */
  pay: string | null;
  /**
   * Fixed original JobPosting date — NOT recomputed on render. Google's
   * job-posting content policy explicitly bans resetting datePosted when
   * nothing about the job changed ("don't update the DatePosted property if
   * there was no change to the job post"); doing so can trigger a manual
   * action removing every posting on the site from Google Jobs, not just one
   * role. Update this by hand, deliberately, only when a role's actual terms
   * change (pay, title, responsibilities) — never automatically.
   */
  datePosted: string;
}

// ─── POSITIONS ────────────────────────────────────────────
// Derived from the canonical lifecycle source so the list page and the leaf
// pages can never disagree about what is open. Closing a role in
// shared/jobOpenings.ts removes it from BOTH.
const POSITIONS: Position[] = openJobOpenings().map((j) => ({
  title: j.title,
  type: j.type,
  level: j.level,
  description: j.description,
  responsibilities: j.responsibilities,
  requirements: j.requirements,
  nice: j.nice,
  schemaId: j.slug,
  pay: formatHourlyPayRange(j),
  datePosted: j.datePosted,
}));

// One line per role that has a published band, e.g.
// "Automotive Technician $30.00–$37.50/hr". Derived, never typed: the old
// hardcoded ceiling-only helper text disagreed with the structured data.
const PAY_SUMMARY = POSITIONS.filter((p) => p.pay).map((p) => `${p.title} ${p.pay}`);

// ─── WHY WORK HERE ────────────────────────────────────────
function buildWhyWork(reviewRating: number, reviewCountDisplay: string) {
  // 2026-09-23 · rewritten to claims the shop can back. The previous first card
  // said "one of Cleveland's busiest shops ... your hours are full" — the
  // recruiting research could not verify that, and our own invoice mirror
  // does not yet support it (docs/recruiting/RECRUITING-ENGINE-2026-09.md,
  // Sec. 6). Workload numbers go here only once they are measured.
  return [
    {
      icon: Shield,
      heading: "Hourly pay, not flat rate",
      body: `You're paid for the hours you work. ${PAY_SUMMARY.join(" · ")}. A slow afternoon doesn't come out of your check.`,
    },
    {
      icon: Wrench,
      heading: "You won't be dropping motors",
      body: "Most of our work is tires, brakes, diagnostics, and general maintenance — the bread and butter that keeps a shop alive. You're not pulling engines on 20-year-old trucks. You're doing real work at a real pace without destroying your body.",
    },
    {
      icon: TrendingUp,
      heading: "Room to grow",
      body: "If you want to develop diagnostics skills, move into a senior role, or eventually advise on shop operations, we're interested in growing with you. ASE certifications and diagnostic skill move you up the posted range.",
    },
    {
      icon: Users,
      heading: `${reviewRating} stars. ${reviewCountDisplay} Google reviews.`,
      body: "That's our customers talking, not our employees — it shows the cars keep coming. What it's like to work here, ask the techs. Stop by during business hours and see the bays yourself.",
    },
    {
      icon: Clock,
      heading: "Predictable schedule",
      body: `${BUSINESS.hours.display}. Sunday hours available for those who want them. No midnight calls. No drama. Show up, do good work, go home to your family.`,
    },
  ];
}

// ─── CHARACTER EXPECTATIONS ───────────────────────────────
const CHARACTER_TRAITS = [
  "You do the job right even when no one is watching",
  "You tell the customer what you found — not what they want to hear, not more than they need",
  "You ask when you're unsure rather than guessing on someone's safety",
  "You treat every vehicle like it belongs to someone who depends on it",
  "You leave your bay cleaner than you found it",
];

// JobPosting markup deliberately does NOT live on this page. Google requires
// it on the LEAF page for a SINGLE job and forbids it on a list page.
// Verified live 2026-09-10: this URL carried three JobPosting objects at once.
// The leaf pages are client/src/pages/JobPage.tsx; the invariant is pinned by
// server/jobPostingLifecycle.test.ts.

// ─── POSITION CARD ────────────────────────────────────────
function PositionCard({ pos }: { pos: Position }) {
  return (
    <div className="rounded-2xl border border-border/25 bg-[oklch(0.07_0.004_260)] overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-border/20">
        <div className="flex flex-wrap items-start justify-between gap-3 stagger-in">
          <div>
            {/* wave-147 — was h3 which skipped from page h1 → h3 with no
                intervening h2. Breaks document outline + JobPosting rich-
                result eligibility. Position title is the most semantically
                important heading per card; h2 is the right level. */}
            <h2 className="font-heading text-2xl font-extrabold uppercase text-foreground tracking-wide">
              {pos.title}
            </h2>
            <p className="mt-1 text-sm text-foreground/50">{pos.level}</p>
          </div>
          <span className="text-xs font-semibold tracking-wide uppercase text-primary bg-primary/10 border border-primary/20 px-3 py-1 rounded-full shrink-0">
            {pos.type}
          </span>
        </div>
        {pos.pay && (
          <p className="mt-3 text-base font-bold text-nick-yellow">{pos.pay} · hourly</p>
        )}
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
        {/* Points at the LEAF page, not #apply. Two reasons: the leaf is the
            canonical URL for this job and carries its JobPosting, and these
            are the only internal links by which Google discovers the leaves —
            an orphaned leaf is an unindexed leaf. */}
        <Link
          href={jobOpeningPath(pos.schemaId)}
          onClick={() => trackEvent("careers_apply_cta_click", { position: pos.title, surface: "position_card" })}
          className="flex items-center justify-center gap-2 stagger-in w-full bg-primary text-primary-foreground btn-premium py-3 rounded-xl font-semibold text-sm tracking-wide hover:opacity-90 transition-opacity"
        >
          View role &amp; apply
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}

// ─── APPLICATION FORM ─────────────────────────────────────
// Deep links into a specific lane: /careers#talk opens the form on "talk
// privately", #tour on "see the shop", #stay on "keep me in mind". The hero's
// confidential CTA uses #talk.
const HASH_TO_INTENT: Record<string, CandidateIntent> = {
  // #apply is the hero "Apply Now" target: it must RESET a lane chosen earlier
  // (#talk then Apply Now used to submit as confidential — Codex on #2557).
  "#apply": "apply",
  "#talk": "confidential",
  "#tour": "shop_tour",
  "#stay": "talent_network",
  "#apprentice": "apprentice",
};

const INTENT_HINT: Record<CandidateIntent, string> = {
  apply: "No resume required. We respond within 48 hours.",
  confidential:
    "Already working somewhere? This goes to the owner only. We won't call your shop — say how you'd like to be reached.",
  shop_tour: "Come look at the bays and meet the owner before you decide anything. After hours works.",
  talent_network: "Not ready to move? Leave your info and we'll check in when it makes sense for you.",
  apprentice: "Want to learn the trade? Tell us about school, experience, and when you're available.",
};

export function ApplicationForm({ defaultPosition }: { defaultPosition?: string } = {}) {
  const [intent, setIntent] = useState<CandidateIntent>("apply");
  const [moveReasons, setMoveReasons] = useState<MoveReason[]>([]);
  // Honeypot — see candidates.submit. Off-screen, never focusable.
  const [website, setWebsite] = useState("");
  useEffect(() => {
    const apply = () => {
      const next = HASH_TO_INTENT[window.location.hash];
      if (next) setIntent(next);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    // A job page passes its own title so the applicant never has to re-pick
    // the role they are already reading about.
    position:
      defaultPosition && POSITIONS.some((p) => p.title === defaultPosition)
        ? defaultPosition
        : POSITIONS[0].title,
    experience: "",
    message: "",
    referredBy: "",
    referredByPhone: "",
  });
  const [submitted, setSubmitted] = useState(false);
  // Best-effort, fire-and-forget: this gives the $300 referral bonus a real
  // tracked record instead of a free-text note. It must never block or fail
  // the applicant's own submission — see onSuccess below.
  const submitTechReferral = trpc.technicianReferrals.submit.useMutation();
  // Cut over from trpc.lead.submit (the customer pipeline — scoreLead,
  // leadConfirmationSms, opportunity queue, none of which belong on a job
  // application) to trpc.candidates.submit, gated on drizzle/0122_candidates.sql
  // being applied to production — see drizzle/schema.ts's `candidates` doc
  // comment for the full rationale. candidates.submit THROWS on a real
  // failure (unlike technicianReferrals.submit below), so onError here means
  // the application genuinely was not saved.
  const submitCandidate = trpc.candidates.submit.useMutation({
    onSuccess: (data) => {
      setSubmitted(true);
      trackEvent("careers_application_submitted", { position: form.position, intent });
      const referrerName = form.referredBy.trim();
      // id 0 is the honeypot's decoy success — nothing was saved, so there is
      // no candidate to attach a $300 referral claim to.
      if (referrerName && data.id) {
        submitTechReferral.mutate({
          candidateId: data.id,
          referrerName,
          referrerPhone: form.referredByPhone.trim() || null,
          positionTitle: form.position,
        });
      }
    },
    onError: () => toast.error("Something went wrong. Please call us instead."),
  });

  if (submitted) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center">
        <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-4" />
        <h3 className="font-heading text-xl font-extrabold uppercase text-foreground mb-2">
          {intent === "apply" ? "Application Received" : "Got It"}
        </h3>
        <p className="text-sm text-foreground/60">
          {intent === "confidential"
            ? "This went to the owner only. We'll reach out the way you asked — never through your current shop."
            : intent === "talent_network"
              ? "You're on our list. We'll check in when it makes sense — no pressure."
              : "We'll review your info and reach out within 48 hours."}{" "}
          If you'd like to follow up,
          call us at <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick("careers-post-submit")} className="text-primary font-semibold">{BUSINESS.phone.display}</a>.
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
    // position/experience are their own columns on `candidates` now (not
    // concatenated into a free-text blob the way lead.submit's `problem`
    // field worked) — only the applicant's own free-text and the referrer's
    // name/phone go into `message`. The referrer's phone still rides along
    // here too: if technicianReferrals.submit ever hits a real DB error, this
    // is the one place that survives it — see technicianReferrals.submit's
    // own soft-fail comment.
    const message = [
      form.message,
      form.referredBy && `Referred by: ${form.referredBy}${form.referredByPhone ? ` (${form.referredByPhone})` : ""}`,
    ].filter(Boolean).join("\n");

    // candidates.submit's UTM fields mirror leads' own convention but are a
    // narrower set (no utmTerm/utmContent/gclid) — pick only what the schema
    // declares rather than spreading getUtmData()'s full return, which would
    // include fields candidates.submit doesn't accept.
    const { utmSource, utmMedium, utmCampaign, utmTerm, utmContent, gclid, landingPage, referrer, sessionId } =
      getUtmData();
    submitCandidate.mutate({
      intent,
      moveReasons: moveReasons.length ? moveReasons : null,
      utmTerm,
      utmContent,
      gclid,
      website: website || null,
      name: form.name,
      phone: form.phone,
      email: form.email || undefined,
      positionTitle: form.position,
      experienceLevel: form.experience || null,
      message: message || null,
      utmSource,
      utmMedium,
      utmCampaign,
      landingPage,
      referrer,
      sessionId,
    });
  };

  const toggleReason = (r: MoveReason) =>
    setMoveReasons((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <fieldset>
        <legend className="text-xs font-semibold tracking-[0.05em] uppercase text-foreground/40 mb-2">
          What do you want to do?
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {CANDIDATE_INTENTS.map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={intent === i}
              onClick={() => {
                setIntent(i);
                trackEvent("careers_intent_selected", { intent: i });
              }}
              className={`min-h-[48px] rounded-lg border px-3 py-2 text-left text-sm font-semibold transition-colors ${
                intent === i
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/30 text-foreground/60 hover:border-primary/40"
              }`}
            >
              {CANDIDATE_INTENT_LABELS[i]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-foreground/50">{INTENT_HINT[intent]}</p>
      </fieldset>

      {/* Honeypot: off-screen, not tabbable, hidden from assistive tech. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label>
          Website
          <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>

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
            Hourly pay: {PAY_SUMMARY.join(" · ")}. Where you land depends on experience and certifications.
          </p>
        </div>
      </div>

      {intent !== "apply" && intent !== "apprentice" && (
        <fieldset>
          <legend className="text-xs font-semibold tracking-[0.05em] uppercase text-foreground/40 mb-2">
            What would make you consider moving? (optional)
          </legend>
          <div className="flex flex-wrap gap-2">
            {MOVE_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={moveReasons.includes(r)}
                onClick={() => toggleReason(r)}
                className={`min-h-[40px] rounded-full border px-3 text-xs font-semibold transition-colors ${
                  moveReasons.includes(r)
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border/30 text-foreground/55 hover:border-primary/40"
                }`}
              >
                {MOVE_REASON_LABELS[r]}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <div>
        <label className="text-xs font-semibold tracking-[0.05em] uppercase text-foreground/40 block mb-1.5">
          {intent === "confidential" ? "Your question, and the best way to reach you" : "Tell us about yourself"}
        </label>
        <textarea
          value={form.message}
          onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
          placeholder="What kind of work have you done? What are you looking for? Keep it brief — we'll talk details in person."
          rows={3}
          className="w-full bg-[oklch(0.08_0.004_260)] border border-border/30 rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-foreground/25 focus:border-primary/50 focus:outline-none resize-none"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
        <div>
          <label className="text-xs font-semibold tracking-[0.05em] uppercase text-foreground/40 block mb-1.5">
            Their phone (optional)
          </label>
          <input
            type="tel"
            value={form.referredByPhone}
            onChange={(e) => setForm((f) => ({ ...f, referredByPhone: e.target.value }))}
            placeholder="So we can reach them about the $300"
            className="w-full bg-[oklch(0.08_0.004_260)] border border-border/30 rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-foreground/25 focus:border-primary/50 focus:outline-none"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={submitCandidate.isPending}
        className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground btn-premium py-3.5 rounded-xl font-semibold text-sm tracking-wide hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {submitCandidate.isPending ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Submitting...</>
        ) : (
          <><Send className="w-4 h-4" /> {intent === "apply" ? "Submit Application" : "Send"}</>
        )}
      </button>
    </form>
  );
}

// ─── PAGE ─────────────────────────────────────────────────
export default function Careers() {
  const { data: googleData } = trpc.reviews.google.useQuery(undefined, { staleTime: 60 * 60 * 1000, retry: 1 });
  const reviewRating = googleData?.rating ?? BUSINESS.reviews.rating;
  const reviewCountDisplay = `${(googleData?.totalReviews ?? BUSINESS.reviews.count).toLocaleString("en-US")}+`;

  return (
    <PageLayout activeHref="/careers" showChat={true}>
      <SEOHead
        title="Careers | Nick's Tire & Auto Cleveland — We're Hiring"
        description="We're hiring automotive technicians, service advisors, and tire techs in Cleveland, Ohio. Family-run shop. Honest work environment. No flat-rate grind. Apply now."
        canonicalPath="/careers"
      />
      {/* v1.7 SEO · BreadcrumbList */}
      <Breadcrumbs items={[{ label: "Careers" }]} />
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
              We're rated {reviewRating} stars across {reviewCountDisplay} Google reviews for a
              reason. We hire people who care about doing the job right. If that's you, we want to talk.
            </p>
            <div className="mt-8 flex flex-wrap gap-4 stagger-in">
              <a
                href="#apply"
                onClick={() => trackEvent("careers_apply_cta_click", { position: "any", surface: "hero" })}
                className="inline-flex items-center gap-2 stagger-in bg-primary text-primary-foreground btn-premium px-6 py-3 rounded-xl font-semibold text-sm tracking-wide hover:opacity-90 transition-opacity"
              >
                Apply Now
                <ArrowRight className="w-4 h-4" />
              </a>
              <a
                href={BUSINESS.phone.href}
                onClick={() => trackPhoneClick("careers-hero-inquire")}
                className="inline-flex items-center gap-2 stagger-in border border-border/40 text-foreground/80 px-6 py-3 rounded-xl font-semibold text-sm tracking-wide hover:border-primary/40 transition-colors"
              >
                <Phone className="w-4 h-4" />
                Call to Inquire
              </a>
            </div>
            <a
              href="#talk"
              onClick={() => trackEvent("careers_apply_cta_click", { position: "any", surface: "hero_confidential" })}
              className="mt-5 inline-block text-sm text-foreground/60 underline underline-offset-4 hover:text-foreground"
            >
              Already working somewhere? Talk privately first — no application.
            </a>
            <Link
              href="/mechanic-pay-calculator"
              className="mt-2 block text-sm text-foreground/50 underline underline-offset-4 hover:text-foreground"
            >
              Flat rate vs hourly — run your own numbers
            </Link>
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
              If you've worked at shops where speed trumps doing it right, where advisors upsell without
              shame, or where techs are blamed when customers are unhappy — this is a different
              operation.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 stagger-in">
            {buildWhyWork(reviewRating, reviewCountDisplay).map((item) => {
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

      {/* ─── APPLY NOW ────────────────────────────────────── */}
      <section id="apply" className="relative bg-[oklch(0.065_0.004_260)] py-16 lg:py-20 border-t border-border/20">
        {/* Scroll targets for the lane deep links; ApplicationForm reads the hash. */}
        <span id="talk" className="absolute top-0" aria-hidden="true" />
        <span id="tour" className="absolute top-0" aria-hidden="true" />
        <span id="stay" className="absolute top-0" aria-hidden="true" />
        <span id="apprentice" className="absolute top-0" aria-hidden="true" />
        <div className="container">
          <div className="max-w-2xl mx-auto">
            <h2 className="font-heading text-3xl font-extrabold uppercase text-foreground mb-2">
              Apply — or Just Talk
            </h2>
            <p className="text-sm text-foreground/55 leading-relaxed mb-8">
              No resume required. Apply in 2 minutes, ask a private question, set up a shop visit, or
              just get on our list. We respond within 48 hours.
            </p>
            <ApplicationForm />
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-start gap-4 stagger-in rounded-xl border border-border/25 bg-[oklch(0.07_0.004_260)] p-5">
                <Phone className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground/90">Call or stop in</p>
                  <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick("careers-call-or-stop-in")} className="text-sm text-primary hover:opacity-80 transition-opacity">{BUSINESS.phone.display}</a>
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
              Customer, parts rep, tool-truck driver, fellow tech — anyone can refer.
              Just tell them to put your name and phone in the "Referred by" box when they apply.
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
    </PageLayout>
  );
}
