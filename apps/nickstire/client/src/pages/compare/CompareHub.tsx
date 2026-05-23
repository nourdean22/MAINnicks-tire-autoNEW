/**
 * /compare — hub for every comparison page on the site.
 *
 * Per the competitor-alternatives skill, comparison content needs a
 * dedicated index page that:
 *   1. Lets visitors browse all comparison content in one place
 *   2. Passes link equity from a single high-authority hub to each
 *      individual comparison page (hub-and-spoke topology)
 *   3. Itself ranks for broad queries like "tire shop comparisons
 *      cleveland" / "cleveland tire shop reviews compared"
 *   4. Surfaces depth of research as a trust signal — "this shop has
 *      done its homework on the competition"
 *
 * This was the missing piece in nickstire's competitor architecture.
 * 14 comparison pages existed (Conrad's/Mavis/Firestone/Monro/NTB/Big O/
 * Discount Tire alternatives + 3 Nick's-vs pages + 2 third-party pages +
 * the BestTireShopsCleveland roundup) but no hub connecting them.
 */
import { Link } from "wouter";
import { ArrowRight, ShieldCheck, MapPin } from "lucide-react";
import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import Eyebrow from "@/components/Eyebrow";
import FadeIn from "@/components/FadeIn";
import { BUSINESS } from "@shared/business";

interface ComparisonLink {
  path: string;
  label: string;
  hook: string;
}

const NICKS_VS: ComparisonLink[] = [
  { path: "/nicks-tire-vs-mavis-cleveland", label: "Nick's vs Mavis Tire", hook: "Advertised price vs total ticket — which math actually wins" },
  { path: "/nicks-tire-vs-conrads-cleveland", label: "Nick's vs Conrad's Tire", hook: "Local family shop vs Cleveland chain — Sunday hours, walk-in policy" },
  { path: "/nicks-tire-vs-firestone-cleveland", label: "Nick's vs Firestone Complete Auto Care", hook: "Independent honesty vs national warranty paperwork" },
];

const HEAD_TO_HEAD: ComparisonLink[] = [
  { path: "/conrads-vs-mavis-tire-cleveland", label: "Conrad's vs Mavis Tire", hook: "Two chains compared — and the third option you should consider" },
  { path: "/firestone-vs-discount-tire-cleveland", label: "Firestone vs Discount Tire", hook: "Auto care chain vs tire-only specialist — head to head" },
];

const ALTERNATIVES: ComparisonLink[] = [
  { path: "/mavis-tire-alternative-cleveland", label: "Mavis Tire alternative", hook: "Tired of Mavis surprise fees at checkout? Walk into Nick's instead." },
  { path: "/conrads-tire-alternative-cleveland", label: "Conrad's Tire alternative", hook: "Open Sundays + walk-ins welcome — what Conrad's used to do." },
  { path: "/discount-tire-alternative-cleveland", label: "Discount Tire alternative", hook: "Discount Tire only does tires. Nick's does the whole car." },
  { path: "/firestone-alternative-cleveland", label: "Firestone alternative", hook: "Independent honesty without the chain markup or appointment-only policy." },
  { path: "/monro-mr-tire-alternative-cleveland", label: "Monro / Mr. Tire alternative", hook: "The diagnostic-fee trap, undone. Free estimate, every visit." },
  { path: "/big-o-tires-alternative-cleveland", label: "Big O Tires alternative", hook: "Cleveland-rooted vs national franchise — and the math on used tires." },
  { path: "/ntb-alternative-cleveland", label: "NTB alternative", hook: "NTB-now-Mavis switched the sign. The pricing playbook stays the same." },
];

const ROUNDUPS: ComparisonLink[] = [
  { path: "/best-tire-shops-cleveland", label: "Best tire shops in Cleveland", hook: "The honest 7-shop ranking. Sunday hours, walk-in policy, written estimates." },
  { path: "/best-conrads-tire-alternatives-cleveland", label: "Best Conrad's Tire alternatives", hook: "If Conrad's isn't working — six other shops compared honestly." },
];

export default function CompareHub() {
  return (
    <PageLayout activeHref="/compare" showChat={true}>
      <SEOHead
        title="Tire Shop Comparisons Cleveland · Honest Side-by-Side"
        description="Honest, in-writing comparisons of every major Cleveland tire shop. Mavis, Conrad's, Firestone, Discount Tire, NTB, Monro, Big O — vs Nick's Tire & Auto."
        canonicalPath="/compare"
      />
      <LocalBusinessSchema pageName="Cleveland Tire Shop Comparisons - Nick's Tire & Auto" />

      <section className="relative pt-28 pb-12 lg:pt-32 lg:pb-16">
        <div className="container max-w-4xl">
          <Breadcrumbs items={[{ label: "Compare", href: "/compare" }]} />
          <FadeIn>
            <Eyebrow className="mt-6">Honest comparisons</Eyebrow>
            <h1 className="mt-4 font-heading text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground tracking-tight leading-[1.05] uppercase">
              Compare every Cleveland tire shop.
            </h1>
            <p className="mt-5 text-lg sm:text-xl text-foreground/75 max-w-2xl font-light leading-relaxed">
              We did the homework so you don't have to. Mavis, Conrad's, Firestone,
              Discount Tire, Monro, Big O, NTB — side-by-side with Nick's Tire & Auto.
              Honest about where the chains win. Honest about where we win.
              You decide. Walk in any day to compare for yourself.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary rounded-sm">
                <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                Sourced from public reviews + verifiable shop policies
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-foreground/5 text-foreground/70 rounded-sm">
                <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                Cleveland market focus
              </span>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="py-12 lg:py-16 bg-card/40 border-y border-border/30">
        <div className="container max-w-4xl">
          <FadeIn>
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground tracking-tight uppercase mb-2">
              Nick's vs the competition
            </h2>
            <p className="text-foreground/65 mb-6">Direct head-to-head pages for the shops Cleveland drivers most often weigh against Nick's.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {NICKS_VS.map((c) => (
                <Link key={c.path} href={c.path} className="group block p-4 bg-background border border-border/30 rounded-md hover:border-primary/40 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-foreground text-base">{c.label}</div>
                      <div className="text-foreground/65 text-sm mt-1 leading-snug">{c.hook}</div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-foreground/30 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0 mt-1" aria-hidden="true" />
                  </div>
                </Link>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="py-12 lg:py-16">
        <div className="container max-w-4xl">
          <FadeIn>
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground tracking-tight uppercase mb-2">
              Switching from a chain
            </h2>
            <p className="text-foreground/65 mb-6">Each page validates the specific frustration that brings drivers from that chain to Nick's — and explains the math honestly.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {ALTERNATIVES.map((c) => (
                <Link key={c.path} href={c.path} className="group block p-4 bg-card border border-border/30 rounded-md hover:border-primary/40 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-foreground text-base">{c.label}</div>
                      <div className="text-foreground/65 text-sm mt-1 leading-snug">{c.hook}</div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-foreground/30 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0 mt-1" aria-hidden="true" />
                  </div>
                </Link>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="py-12 lg:py-16 bg-card/40 border-y border-border/30">
        <div className="container max-w-4xl">
          <FadeIn>
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground tracking-tight uppercase mb-2">
              Chain vs chain
            </h2>
            <p className="text-foreground/65 mb-6">Comparing two competitors directly. Nick's appears as the third option at the end of each.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {HEAD_TO_HEAD.map((c) => (
                <Link key={c.path} href={c.path} className="group block p-4 bg-background border border-border/30 rounded-md hover:border-primary/40 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-foreground text-base">{c.label}</div>
                      <div className="text-foreground/65 text-sm mt-1 leading-snug">{c.hook}</div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-foreground/30 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0 mt-1" aria-hidden="true" />
                  </div>
                </Link>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="py-12 lg:py-16">
        <div className="container max-w-4xl">
          <FadeIn>
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground tracking-tight uppercase mb-2">
              Roundups
            </h2>
            <p className="text-foreground/65 mb-6">Broader "best of" comparisons — useful when you're early-research and want the full picture.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {ROUNDUPS.map((c) => (
                <Link key={c.path} href={c.path} className="group block p-4 bg-card border border-border/30 rounded-md hover:border-primary/40 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-foreground text-base">{c.label}</div>
                      <div className="text-foreground/65 text-sm mt-1 leading-snug">{c.hook}</div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-foreground/30 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0 mt-1" aria-hidden="true" />
                  </div>
                </Link>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="py-14 lg:py-20 bg-[#0d0d0d] border-t border-[#1f1f1f]">
        <div className="container max-w-2xl text-center">
          <h2 className="font-heading text-3xl lg:text-4xl font-bold text-white tracking-tight uppercase leading-[1.05]">
            Already decided?
          </h2>
          <p className="mt-3 text-white/65 text-base lg:text-lg max-w-xl mx-auto">
            Pull up to {BUSINESS.address.street}, {BUSINESS.address.city}. Walk in any day we're open. {BUSINESS.hours.display}.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/booking"
              className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-7 py-3.5 rounded-lg font-bold text-base tracking-wide hover:bg-primary/90 transition-colors"
            >
              SCHEDULE DROP-OFF
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
            <a
              href={BUSINESS.phone.href}
              className="inline-flex items-center justify-center gap-2 border-2 border-[#FDB913]/40 text-[#FDB913] px-7 py-3.5 rounded-lg font-bold text-base tracking-wide hover:bg-[#FDB913]/10 transition-colors"
            >
              CALL {BUSINESS.phone.display}
            </a>
          </div>
        </div>
      </section>
    </PageLayout>
  );
}
