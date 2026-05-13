/**
 * ComparisonPage — single template that renders all four comparison
 * formats from the competitor-alternatives playbook:
 *   - "alternative"  → "[Competitor] alternative in Cleveland"
 *   - "vs"           → "Nick's Tire & Auto vs [Competitor] in Cleveland"
 *   - "third-party"  → "[Competitor A] vs [Competitor B] in Cleveland"
 *                       (Nick's appears as 'the third option' at the end)
 *   - "roundup"      → "Best [Competitor] alternatives in Cleveland"
 *                       (4-7 alternatives listed; Nick's positioned first)
 *
 * One template + data-driven content = consistent quality, single source
 * of truth, easier maintenance. Update Conrad's pricing once in
 * competitors.ts and every page that pulls from it updates automatically.
 */
import { Link } from "wouter";
import { ArrowRight, Phone, MapPin, Check, X, AlertCircle } from "lucide-react";
import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import Eyebrow from "@/components/Eyebrow";
import FadeIn from "@/components/FadeIn";
import FaqWithSchema, { type FaqItem } from "@/components/competitor/FaqWithSchema";
import {
  type CompetitorProfile,
  NICKS_TIRE,
  COMPETITORS,
} from "@/data/competitors";
import { BUSINESS } from "@shared/business";

export type ComparisonFormat = "alternative" | "vs" | "third-party" | "roundup";

interface ComparisonPageProps {
  format: ComparisonFormat;
  /** Primary competitor (always present except for "roundup" generic mode) */
  primary: CompetitorProfile;
  /** Second competitor — required for "third-party" only */
  secondary?: CompetitorProfile;
  /** Alternatives list for "roundup" — defaults to all competitors */
  roundupCompetitors?: CompetitorProfile[];
  /** Override page slug; defaults to derived */
  slug: string;
  /** SEO title */
  seoTitle: string;
  /** SEO description */
  seoDescription: string;
  /** H1 — overrides default templating */
  h1?: string;
  /** Custom intro paragraph (lead) */
  intro?: string;
  /** Page-specific FAQs to append before the standard ones */
  extraFaqs?: FaqItem[];
}

/* ─── COMPARISON ROW ───────────────────────────────────────── */
function Row({
  label,
  nicks,
  comp,
  highlight,
}: {
  label: string;
  nicks: React.ReactNode;
  comp: React.ReactNode;
  highlight?: "nicks" | "comp";
}) {
  return (
    <tr className="border-t border-white/5">
      <td className="py-4 pr-4 text-foreground/70 text-sm sm:text-base font-medium align-top">
        {label}
      </td>
      <td
        className={`py-4 px-4 text-sm sm:text-base align-top ${
          highlight === "nicks" ? "text-[#FDB913] font-semibold" : "text-foreground"
        }`}
      >
        {nicks}
      </td>
      <td
        className={`py-4 pl-4 text-sm sm:text-base align-top ${
          highlight === "comp" ? "text-[#FDB913] font-semibold" : "text-foreground/80"
        }`}
      >
        {comp}
      </td>
    </tr>
  );
}

/* ─── YES / NO PILL ───────────────────────────────────────── */
function YesNo({ value, yesLabel, noLabel }: { value: boolean; yesLabel: string; noLabel: string }) {
  return value ? (
    <span className="inline-flex items-center gap-1.5">
      <Check className="w-4 h-4 text-emerald-400" />
      {yesLabel}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-foreground/55">
      <X className="w-4 h-4 text-rose-400" />
      {noLabel}
    </span>
  );
}

/* ─── HERO ────────────────────────────────────────────────── */
function ComparisonHero({
  eyebrow,
  h1,
  tldr,
}: {
  eyebrow: string;
  h1: string;
  tldr: string;
}) {
  return (
    <section className="relative bg-[oklch(0.06_0.004_260)] border-b border-border/30 overflow-hidden">
      <div className="absolute inset-0 photo-grain pointer-events-none mix-blend-overlay opacity-[0.06]" />
      <div className="container max-w-4xl py-16 lg:py-24 relative">
        <FadeIn cinematic>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="font-heading text-3xl sm:text-5xl lg:text-6xl font-extrabold uppercase text-foreground tracking-tight leading-[0.95] headline-balance mb-6">
            {h1}
          </h1>
          <p className="text-foreground/75 text-lg sm:text-xl leading-relaxed max-w-3xl body-pretty">
            <span className="font-semibold text-[#FDB913]">TL;DR:</span> {tldr}
          </p>

          {/* CTAs — magnetic physics from wave-31 */}
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <a
              href="#booking"
              className="group relative inline-flex items-center bg-[#FDB913] text-[#0A0A0A] pl-7 pr-2 py-2 rounded-lg font-bold text-base shadow-[0_4px_24px_rgba(253,185,19,0.35)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:shadow-[0_6px_32px_rgba(253,185,19,0.55)] active:scale-[0.98] btn-premium"
            >
              <span className="py-1.5">SCHEDULE DROP-OFF AT NICK'S</span>
              <span className="ml-2 inline-flex items-center justify-center w-9 h-9 rounded-md bg-black/12 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1 group-hover:-translate-y-[1px] group-hover:bg-black/16">
                <ArrowRight className="w-4 h-4" />
              </span>
            </a>
            <a
              href={BUSINESS.phone.href}
              onClick={() => trackPhoneClick("comparison-hero")}
              className="group inline-flex items-center justify-center gap-2 border-2 border-[#FDB913]/70 text-[#FDB913] px-6 py-3 rounded-lg font-bold text-base transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#FDB913]/10 hover:border-[#FDB913] active:scale-[0.98]"
            >
              <Phone className="w-4 h-4 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:rotate-[-8deg]" />
              {BUSINESS.phone.display}
            </a>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

/* ─── SIDE-BY-SIDE TABLE ─────────────────────────────────── */
function SideBySide({ a, b, aName, bName }: { a: CompetitorProfile; b: CompetitorProfile; aName: string; bName: string }) {
  return (
    <section className="bg-background py-20 lg:py-28 border-t border-border/30">
      <div className="container max-w-5xl">
        <FadeIn>
          <Eyebrow dropShadow={false}>At a glance</Eyebrow>
          <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-extrabold uppercase text-foreground tracking-tight leading-[0.95] headline-balance mb-10">
            {aName} vs {bName}
          </h2>
        </FadeIn>
        <div className="rounded-[1.5rem] p-[3px] bg-white/[0.025] ring-1 ring-white/[0.06]">
          <div className="bg-[#141414] rounded-[calc(1.5rem-3px)] p-4 sm:p-6 lg:p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left pb-3 text-foreground/40 text-[11px] uppercase tracking-[0.18em] font-bold">
                    Dimension
                  </th>
                  <th className="text-left pb-3 px-4 text-[#FDB913] text-[11px] uppercase tracking-[0.18em] font-bold">
                    {aName}
                  </th>
                  <th className="text-left pb-3 pl-4 text-foreground/70 text-[11px] uppercase tracking-[0.18em] font-bold">
                    {bName}
                  </th>
                </tr>
              </thead>
              <tbody>
                <Row
                  label="Walk-in policy"
                  nicks={
                    <YesNo
                      value={a.walkInPolicy === "walk-in"}
                      yesLabel="First-come-first-served, walk in"
                      noLabel={a.walkInPolicy.replace(/-/g, " ")}
                    />
                  }
                  comp={
                    <YesNo
                      value={b.walkInPolicy === "walk-in"}
                      yesLabel="First-come-first-served, walk in"
                      noLabel={b.walkInPolicy.replace(/-/g, " ")}
                    />
                  }
                  highlight={a.walkInPolicy === "walk-in" && b.walkInPolicy !== "walk-in" ? "nicks" : undefined}
                />
                <Row
                  label="Open Sundays"
                  nicks={<YesNo value={a.openSunday} yesLabel="9am–4pm" noLabel="Closed" />}
                  comp={<YesNo value={b.openSunday} yesLabel="9am–4pm" noLabel="Closed" />}
                  highlight={a.openSunday && !b.openSunday ? "nicks" : undefined}
                />
                <Row
                  label="Used tires"
                  nicks={
                    <YesNo
                      value={a.usedTires}
                      yesLabel={a.usedTireFloor ? `From $${a.usedTireFloor} installed` : "Yes"}
                      noLabel="New only"
                    />
                  }
                  comp={
                    <YesNo
                      value={b.usedTires}
                      yesLabel={b.usedTireFloor ? `From $${b.usedTireFloor} installed` : "Yes"}
                      noLabel="New only"
                    />
                  }
                  highlight={a.usedTires && !b.usedTires ? "nicks" : undefined}
                />
                <Row
                  label="Full-service mechanical"
                  nicks={<YesNo value={a.fullServiceMechanical} yesLabel="Tires + brakes + alignment + repair" noLabel="Tires only" />}
                  comp={<YesNo value={b.fullServiceMechanical} yesLabel="Tires + brakes + alignment + repair" noLabel="Tires only" />}
                />
                <Row
                  label="Drop-off + Uber/Lyft"
                  nicks={<YesNo value={a.dropoffWithRideshare} yesLabel="Yes — leave the car, grab a ride" noLabel="No" />}
                  comp={<YesNo value={b.dropoffWithRideshare} yesLabel="Yes" noLabel="No" />}
                  highlight={a.dropoffWithRideshare && !b.dropoffWithRideshare ? "nicks" : undefined}
                />
                <Row
                  label="Greater Cleveland locations"
                  nicks={String(a.clevelandLocations)}
                  comp={String(b.clevelandLocations)}
                />
                <Row
                  label="Ownership"
                  nicks={a.ownership ?? "—"}
                  comp={b.ownership ?? "—"}
                />
                <Row
                  label="Pricing model"
                  nicks={a.pricingNotes}
                  comp={b.pricingNotes}
                />
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── STRENGTHS / WEAKNESSES BLOCK ───────────────────────── */
function Honest({ profile, label, tone }: { profile: CompetitorProfile; label: string; tone: "primary" | "neutral" }) {
  const ringColor = tone === "primary" ? "ring-[#FDB913]/30" : "ring-white/[0.06]";
  const bgTint = tone === "primary" ? "bg-[#FDB913]/[0.04]" : "bg-white/[0.025]";

  return (
    <div className={`rounded-[1.5rem] p-[3px] ${bgTint} ring-1 ${ringColor}`}>
      <div className="bg-[#141414] rounded-[calc(1.5rem-3px)] p-6 lg:p-8 h-full shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <Eyebrow dropShadow={false} variant={tone === "primary" ? "yellow" : "subtle"}>
          {label}
        </Eyebrow>
        <h3 className="font-heading text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight uppercase mb-2">
          {profile.shortName}
        </h3>
        <p className="text-foreground/55 text-sm mb-5">{profile.tagline}</p>

        <div className="space-y-5 text-sm sm:text-base">
          <div>
            <h4 className="text-foreground font-bold text-xs uppercase tracking-[0.16em] mb-2 text-emerald-300/80">
              Strengths
            </h4>
            <ul className="space-y-1.5 text-foreground/80 leading-relaxed">
              {profile.strengths.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <Check className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-foreground font-bold text-xs uppercase tracking-[0.16em] mb-2 text-rose-300/80">
              Honest weaknesses
            </h4>
            <ul className="space-y-1.5 text-foreground/70 leading-relaxed">
              {profile.weaknesses.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── WHO IT'S FOR ─────────────────────────────────────── */
function WhoItsFor({ profile, fitTone }: { profile: CompetitorProfile; fitTone: "primary" | "neutral" }) {
  const ringColor = fitTone === "primary" ? "ring-[#FDB913]/30" : "ring-white/[0.06]";
  const bgTint = fitTone === "primary" ? "bg-[#FDB913]/[0.04]" : "bg-white/[0.025]";
  return (
    <div className={`rounded-[1.5rem] p-[3px] ${bgTint} ring-1 ${ringColor}`}>
      <div className="bg-[#141414] rounded-[calc(1.5rem-3px)] p-6 lg:p-8 h-full shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <Eyebrow dropShadow={false} variant={fitTone === "primary" ? "yellow" : "subtle"}>
          Who should choose {profile.shortName}
        </Eyebrow>
        <ul className="space-y-2 mt-4">
          {profile.bestFor.map((b, i) => (
            <li key={i} className="flex gap-2 text-foreground/85 text-sm sm:text-base leading-relaxed">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-1" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
        {profile.notIdealFor.length > 0 && (
          <div className="mt-6 pt-6 border-t border-white/5">
            <p className="text-foreground/40 text-xs uppercase tracking-[0.16em] font-bold mb-3">
              Not ideal for
            </p>
            <ul className="space-y-2">
              {profile.notIdealFor.map((b, i) => (
                <li key={i} className="flex gap-2 text-foreground/55 text-sm leading-relaxed">
                  <X className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── BIG CLOSING CTA ───────────────────────────────────── */
function ClosingCta({ headline, sub }: { headline: string; sub: string }) {
  return (
    <section className="bg-[#FDB913] py-20 lg:py-28 relative overflow-hidden">
      <div className="container max-w-4xl text-center relative">
        <FadeIn>
          <Eyebrow variant="filled">17625 Euclid Ave · Cleveland</Eyebrow>
          <h2 className="mt-3 font-heading text-3xl sm:text-5xl lg:text-6xl font-extrabold uppercase text-black tracking-tight leading-[0.95] headline-balance">
            {headline}
          </h2>
          <p className="mt-5 text-black/75 text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto body-pretty">
            {sub}
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href={BUSINESS.phone.href}
              onClick={() => trackPhoneClick("comparison-closing-cta")}
              className="group inline-flex items-center justify-center gap-2 bg-black text-[#FDB913] px-7 py-3.5 rounded-lg font-bold text-lg transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-black/90 active:scale-[0.98]"
            >
              <Phone className="w-5 h-5 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:rotate-[-8deg]" />
              {BUSINESS.phone.display}
            </a>
            <a
              href="https://www.google.com/maps/dir//Nick's+Tire+And+Auto+Euclid,+17625+Euclid+Ave,+Cleveland,+OH+44112"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center justify-center gap-2 border-2 border-black text-black px-7 py-3.5 rounded-lg font-bold text-lg transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-black/10 active:scale-[0.98]"
            >
              <MapPin className="w-5 h-5 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-y-[-2px]" />
              Get directions
            </a>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

/* ─── ROUNDUP TILE (used in roundup format) ──────────────── */
function RoundupTile({ profile, rank, isNicks }: { profile: CompetitorProfile; rank: number; isNicks: boolean }) {
  const link = isNicks ? "/" : `/${profile.slug}-tire-alternative-cleveland`;
  return (
    <div className={`rounded-[1.5rem] p-[3px] h-full ${isNicks ? "bg-[#FDB913]/[0.06] ring-1 ring-[#FDB913]/30" : "bg-white/[0.025] ring-1 ring-white/[0.06]"}`}>
      <div className="bg-[#141414] rounded-[calc(1.5rem-3px)] p-6 lg:p-7 h-full flex flex-col shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="flex items-center justify-between mb-3">
          <span className={`text-[11px] font-bold tracking-[0.18em] uppercase ${isNicks ? "text-[#FDB913]" : "text-foreground/45"}`}>
            #{rank} {isNicks ? "· Our pick" : ""}
          </span>
          <span className="text-[10px] font-mono text-foreground/40 uppercase">{profile.tier.replace(/-/g, " ")}</span>
        </div>
        <h3 className="font-heading text-xl sm:text-2xl font-extrabold text-foreground uppercase tracking-tight mb-1">
          {profile.shortName}
        </h3>
        <p className="text-foreground/45 text-xs mb-4">{profile.tagline}</p>
        <ul className="space-y-1.5 mb-5 flex-1">
          {profile.strengths.slice(0, 3).map((s, i) => (
            <li key={i} className="flex gap-2 text-foreground/80 text-sm leading-snug">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              <span>{s}</span>
            </li>
          ))}
        </ul>
        <Link
          href={link}
          className="group inline-flex items-center gap-1 text-sm font-semibold text-[#FDB913] hover:text-[#FDB913]/80 transition-colors"
        >
          {isNicks ? "Visit Nick's" : `Compare to Nick's`}
          <ArrowRight className="w-4 h-4 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1" />
        </Link>
      </div>
    </div>
  );
}

/* ─── DEFAULT FAQ BUILDER (brand voice) ────────────────── */
function buildDefaultFaqs(format: ComparisonFormat, primary: CompetitorProfile, secondary?: CompetitorProfile): FaqItem[] {
  const base: FaqItem[] = [];

  if (format === "alternative" || format === "vs") {
    base.push({
      question: `What's the best ${primary.shortName} alternative in Cleveland?`,
      answer: `Nick's Tire & Auto on Euclid Ave. ${primary.shortName} is fine if ${primary.bestFor[0].toLowerCase()} — we're not pretending otherwise. But ${primary.weaknesses[0].toLowerCase()} The Cleveland drivers who walk into Nick's say the same three things: open 7 days, no appointment needed, written estimate before any wrench moves. Used tires from $40 if a used tire solves it. The yellow sign on Euclid Ave you've probably driven past.`,
    });
    base.push({
      question: `Is Nick's Tire & Auto really cheaper than ${primary.shortName}?`,
      answer: `Used tires? Yes — from $40 installed (mount, balance, valve stems, TPMS reset, alignment check, all free). ${primary.shortName} won't even sell you a used tire. New tires? Competitive market-rate, but here's the difference: we hand you the estimate in writing before we touch a wrench. No surprise shop fees, no "we found other things wrong," no "while we have it on the lift" speech. The metal doesn't lie. Neither do we.`,
    });
  }

  base.push({
    question: `Is Nick's Tire & Auto really open Sundays?`,
    answer: `Yes. 9am to 4pm. Every Sunday. The chains close. We don't. Most of our customers found us on a Sunday afternoon when their regular shop was locked up — Browns Sunday, salt-on-the-roads Sunday, whatever Sunday it was.`,
  });

  base.push({
    question: `Do I need an appointment at Nick's Tire & Auto?`,
    answer: `Nope. First-come-first-served, every day we're awake. Pull up, hand us the keys, we get you in line. If you can't sit around, drop the car off — we'll Uber you back to work and call when it's ready.`,
  });

  base.push({
    question: `Where is Nick's Tire & Auto located?`,
    answer: `17625 Euclid Ave, Cleveland, OH 44112. The yellow sign you've driven past a hundred times. Phone (216) 862-0005. Mon–Sat 8a–6p · Sun 9a–4p. The chains close. We don't.`,
  });

  if (format === "third-party" && secondary) {
    base.push({
      question: `${primary.shortName} or ${secondary.shortName} — which one wins?`,
      answer: `Pick ${primary.shortName} if ${primary.bestFor[0].toLowerCase()} Pick ${secondary.shortName} if ${secondary.bestFor[0].toLowerCase()} Pick neither if you need Sunday service, walk-in availability, used tires under $80, or a written estimate before any wrench moves — that's Nick's Tire & Auto on Euclid Ave. We're the third option neither chain wants you to know about.`,
    });
  }

  return base;
}

/* ─── MAIN PAGE ────────────────────────────────────────── */
export default function ComparisonPage({
  format,
  primary,
  secondary,
  roundupCompetitors,
  slug,
  seoTitle,
  seoDescription,
  h1,
  intro,
  extraFaqs,
}: ComparisonPageProps) {
  // Default headlines per format
  const defaultH1 = (() => {
    switch (format) {
      case "alternative":
        return `${primary.shortName} alternative in Cleveland`;
      case "vs":
        return `Nick's Tire & Auto vs ${primary.shortName}`;
      case "third-party":
        return `${primary.shortName} vs ${secondary?.shortName ?? ""} — Cleveland`;
      case "roundup":
        return `Best ${primary.shortName} alternatives in Cleveland`;
    }
  })();

  const defaultEyebrow = (() => {
    switch (format) {
      case "alternative":
        return "Cleveland alternative · honest comparison";
      case "vs":
        return "Head-to-head · Cleveland";
      case "third-party":
        return "Honest comparison · Cleveland";
      case "roundup":
        return "Cleveland roundup · ranked options";
    }
  })();

  const defaultTldr = (() => {
    switch (format) {
      case "alternative":
        return `${primary.shortName} is fine for what they do. Closed Sunday. Want an appointment. New tires only. Nick's Tire & Auto is the Cleveland alternative on Euclid Ave — open 7 days including Sundays, walk in any time, used tires from $40 installed, written estimate before any wrench moves. The yellow sign you've probably driven past.`;
      case "vs":
        return `${primary.shortName} is ${primary.tier.replace(/-/g, " ")} — chain pricing, chain hours, chain upsell pressure. Nick's is mechanic-owned, single-location, first-come-first-served, open 7 days including Sunday. Pick ${primary.shortName} if you want a chain waiting room. Pick Nick's if you want a written estimate before any wrench moves.`;
      case "third-party":
        return `${primary.shortName} has ${primary.clevelandLocations} Cleveland locations. ${secondary?.shortName} has ${secondary?.clevelandLocations}. Both close Sunday. Both want an appointment. Both write the estimate after the work starts. The third option neither chain wants you to know about: Nick's Tire & Auto on Euclid Ave — walk in 7 days, used tires from $40, the estimate in writing before the wrench moves.`;
      case "roundup":
        return `Cleveland's got plenty of options if you're done with ${primary.shortName}. The chains. The tire-only specialists. The independents. Below — the honest ranking. Nick's leads on Sunday hours + walk-in + used tire pricing. The chains lead on location count and brand familiarity. You decide which matters.`;
    }
  })();

  const faqs = [
    ...buildDefaultFaqs(format, primary, secondary),
    ...(extraFaqs ?? []),
  ];

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Comparisons", href: "/best-tire-shops-cleveland" },
    { label: h1 ?? defaultH1 },
  ];

  // Roundup list — Nick's first, then competitors
  const roundupList: CompetitorProfile[] = format === "roundup"
    ? [NICKS_TIRE, ...(roundupCompetitors ?? Object.values(COMPETITORS).slice(0, 6))]
    : [];

  return (
    <PageLayout activeHref="/compare">
      <SEOHead
        title={seoTitle}
        description={seoDescription}
        canonicalPath={`/${slug}`}
      />
      <LocalBusinessSchema />

      <div className="container max-w-6xl pt-6">
        <Breadcrumbs items={breadcrumbs} />
      </div>

      <ComparisonHero eyebrow={defaultEyebrow} h1={h1 ?? defaultH1} tldr={intro ?? defaultTldr} />

      {/* SIDE-BY-SIDE TABLE — for alternative + vs + third-party */}
      {format !== "roundup" && (
        <SideBySide
          a={NICKS_TIRE}
          b={format === "third-party" ? primary : primary}
          aName={format === "third-party" ? primary.shortName : NICKS_TIRE.shortName}
          bName={format === "third-party" ? secondary?.shortName ?? "" : primary.shortName}
        />
      )}

      {/* HONEST STRENGTHS/WEAKNESSES */}
      {format !== "roundup" && (
        <section className="bg-[oklch(0.055_0.004_260)] py-20 lg:py-28 border-t border-border/30">
          <div className="container max-w-6xl">
            <FadeIn>
              <Eyebrow dropShadow={false}>Honest assessment · both sides</Eyebrow>
              <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-extrabold uppercase text-foreground tracking-tight leading-[0.95] headline-balance mb-3">
                What each shop is good at. Where each falls apart.
              </h2>
              <p className="text-foreground/65 text-base sm:text-lg max-w-3xl mb-12 body-pretty">
                Pretending {primary.shortName} has no strengths would be a lie and you'd catch it in 30 seconds on Yelp. Here's the real read — both sides, no spin.
              </p>
            </FadeIn>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Honest
                profile={format === "third-party" ? primary : NICKS_TIRE}
                label={format === "third-party" ? primary.shortName : "Nick's Tire & Auto"}
                tone={format === "third-party" ? "neutral" : "primary"}
              />
              <Honest
                profile={format === "third-party" ? secondary ?? primary : primary}
                label={format === "third-party" ? secondary?.shortName ?? "" : primary.shortName}
                tone="neutral"
              />
            </div>
          </div>
        </section>
      )}

      {/* WHO IT'S FOR */}
      {format !== "roundup" && (
        <section className="bg-background py-20 lg:py-28 border-t border-border/30">
          <div className="container max-w-6xl">
            <FadeIn>
              <Eyebrow dropShadow={false}>Pick the shop that fits you</Eyebrow>
              <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-extrabold uppercase text-foreground tracking-tight leading-[0.95] headline-balance mb-12">
                Who should pull up where
              </h2>
            </FadeIn>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <WhoItsFor profile={NICKS_TIRE} fitTone="primary" />
              <WhoItsFor profile={primary} fitTone="neutral" />
              {format === "third-party" && secondary && <WhoItsFor profile={secondary} fitTone="neutral" />}
            </div>
          </div>
        </section>
      )}

      {/* ROUNDUP LIST */}
      {format === "roundup" && (
        <section className="bg-[oklch(0.055_0.004_260)] py-20 lg:py-28 border-t border-border/30">
          <div className="container max-w-6xl">
            <FadeIn>
              <Eyebrow dropShadow={false}>The honest ranking</Eyebrow>
              <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-extrabold uppercase text-foreground tracking-tight leading-[0.95] headline-balance mb-3">
                Cleveland's tire shops — ranked for real life
              </h2>
              <p className="text-foreground/65 text-base sm:text-lg max-w-3xl mb-12 body-pretty">
                Ranked by what actually matters: walk-in policy, Sunday hours, written estimate up front, used tire access. Chains stay competitive on location count and warranty paperwork. You decide which matters more.
              </p>
            </FadeIn>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {roundupList.map((p, i) => (
                <FadeIn key={p.slug} delay={i * 0.08}>
                  <RoundupTile profile={p} rank={i + 1} isNicks={p.slug === "nicks-tire"} />
                </FadeIn>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* FAQ + SCHEMA */}
      <FaqWithSchema
        faqs={faqs}
        heading={`Frequently asked: ${primary.shortName} ${format === "roundup" ? "alternatives" : "vs Nick's"}`}
      />

      {/* CLOSING CTA */}
      <ClosingCta
        headline={
          format === "alternative"
            ? `Skip the ${primary.shortName} wait. Pull up to Nick's.`
            : format === "roundup"
            ? "Cleveland's first-come-first-served shop on Euclid Ave."
            : `Done with chain pricing? Pull up to Nick's.`
        }
        sub="17625 Euclid Ave · Open 7 days · Walk in any day we're awake. Used tires from $40 installed. Written estimate before any wrench moves."
      />
    </PageLayout>
  );
}
