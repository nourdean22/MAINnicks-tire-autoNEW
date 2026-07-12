/*
 * HomeV2 — Nick's Tire & Auto (feat/home-v2, 2026-07-12)
 *
 * Subtract-and-route rebuild driven by the 16-agent verified homepage
 * audit + live funnel data (prod customer_events: the tire funnel is
 * ENTRY-STARVED — ~1 tire CTA click/day while the checkout itself is
 * verified flawless). The homepage's #1 job is routing intent into the
 * paths that complete: /tires, /diagnose, drop-off, phone.
 *
 * vs HomeLegacy (kept as rollback):
 *   REMOVED (the four killed patterns + trust dedupe):
 *     - financing pressure: LossOpportunitySection, FinancingCTA banner,
 *       hero "Payment programs available" chip
 *     - fabricated fear stats: SafetyFactsSection (287ft/$3,800/30d),
 *       LossAversionStat cards ($8.5-$47/day)
 *     - competitor anchor tables: ComparisonTable, PriceCompareSection
 *     - trust repetition: TrustStrip + TrustNumbers + WhyUs collapsed —
 *       Reviews is THE trust unit (hero keeps its inline rating chip)
 *     - hero: 4 competing CTAs + symptom form → ONE primary lane inside
 *       a 4-path intent router
 *   KEPT: WeatherBanner (real-weather-gated), ConesBlock (FCFS ritual),
 *     live status strip, Sunday/Nonstop, UsedTiresCallout (feeds /tires),
 *     TriageGrid (fear lines softened to mechanical truths), Services,
 *     Reviews, drop-off flywheel (now id="dropoff"), Contact, internal
 *     links, LeadPopup.
 *   SEO: SearchAction schema dropped (/search route doesn't exist → 404),
 *     package value $289→$266 (matches the itemized sum the live
 *     getPackage endpoint serves), meta description carries the $25→band
 *     qualifier and drops "pay only when satisfied".
 */

import { useMemo } from "react";
import { Link } from "wouter";
import BookingForm from "@/components/BookingForm";
import PageLayout from "@/components/PageLayout";
import { SEOHead, trackPhoneClick, trackEvent } from "@/components/SEO";
import { Phone, MapPin, Clock, Star, ChevronDown, ArrowRight, Disc, Activity, Wrench, Zap, AlertTriangle, Snowflake, KeyRound, MessageCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FadeIn from "@/components/FadeIn";
import ShopStatusWidget from "@/components/ShopStatusWidget";
import UberDropoffWidget from "@/components/UberDropoffWidget";
import RiseInView from "@/components/RiseInView";
import HeroDustLayer from "@/components/HeroDustLayer";
import StampLetters from "@/components/StampLetters";
import ConesBlock from "@/components/ConesBlock";
import LiveVisitorCounter from "@/components/conversion/LiveVisitorCounter";
import ServiceTriageCard from "@/components/conversion/ServiceTriageCard";
import { useWeatherCTA } from "@/hooks/useWeatherCTA";
import { useConversionTracking } from "@/hooks/useConversionTracking";
import LeadPopup from "@/components/LeadPopup";
import DropOffRequestCard from "@/components/DropOffRequestCard";
import { getUtmData } from "@/lib/utm";
import {
  deriveHeroPersonalization,
  DEFAULT_HERO_PERSONALIZATION,
  type HeroPersonalization,
} from "@/lib/heroPersonalization";

// Photo pack — same assets/tuning as HomeLegacy (see its comments for the
// full placement-guide history).
const HERO_IMG = "/photos/shop-exterior-hero-wide-sign-bays.webp";
const TIRES_IMG = "/photos/rugged-tire-tread-closeup.webp";
const DIAG_IMG = "/photos/interior-service-bay-car-lift.webp";
const BRAKES_IMG = "/photos/undercar-brake-repair-action.webp";

interface HomeReviewData {
  rating: number;
  totalReviews: number;
  googleReviews?: Array<{ authorName: string; rating: number; text: string }>;
}

// ─── INTENT ROUTER — the hero's single decision surface ─────────
//
// Four lanes, one visual winner. Every visitor lands with one of four
// intents; each tile is the shortest path to COMPLETING that intent.
// The tires lane is primary by default (highest-revenue intent + the
// funnel the live data shows is entry-starved). Wave C: brake-campaign
// traffic gets a brakes primary instead — the tires lane then rides the
// first secondary slot (it never disappears). Event names keep
// continuity with the pre-V2 taxonomy (tire_quote_cta_click /
// booking_cta_click) so the customer_events baseline stays comparable.
const PRIMARY_LANE_CLASS =
  "group sm:col-span-2 flex items-center justify-between bg-nick-yellow text-nick-dark rounded-xl px-6 py-4 shadow-[0_4px_24px_rgba(253,185,19,0.35)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:shadow-[0_6px_32px_rgba(253,185,19,0.55)] active:scale-[0.98]";
const SECONDARY_LANE_CLASS =
  "group flex items-center gap-3 rounded-xl border border-white/15 bg-[#0C0F14]/75 backdrop-blur-md px-4 py-3.5 text-left transition-colors hover:border-nick-yellow/50";

function PrimaryLane({ href, onClick, ariaLabel, heading, sub }: {
  href: string; onClick: () => void; ariaLabel: string; heading: string; sub: string;
}) {
  return (
    <Link href={href} onClick={onClick} className={PRIMARY_LANE_CLASS} aria-label={ariaLabel}>
      <span>
        <span className="block font-heading font-extrabold text-xl uppercase tracking-tight">{heading}</span>
        <span className="block text-sm font-medium text-nick-dark/70">{sub}</span>
      </span>
      <span className="ml-4 inline-flex items-center justify-center w-10 h-10 rounded-lg bg-black/12 shrink-0 transition-all duration-500 group-hover:translate-x-1 group-hover:bg-black/16">
        <ArrowRight className="w-5 h-5" />
      </span>
    </Link>
  );
}

function IntentRouter({ personalization }: { personalization: HeroPersonalization }) {
  const brakesLead = personalization.leadIntent === "brakes";
  return (
    <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl motion-safe:animate-[fadeInUp_0.6s_ease-out_0.6s_both]">
      {brakesLead ? (
        <PrimaryLane
          href="/brakes"
          onClick={() => trackEvent("brake_cta_click", { source: "hero-router-personalized" })}
          ariaLabel="Get a free brake check"
          heading="Brake check today"
          sub="Free check · see the worn part yourself · written quote first"
        />
      ) : (
        <PrimaryLane
          href="/tires"
          onClick={() => trackEvent("tire_quote_cta_click", { source: "hero-router" })}
          ariaLabel="Find and order tires by size"
          heading="Get tires now"
          sub="Search your size · see installed prices · request online"
        />
      )}
      {/* Secondary slot 1 — tires (when brakes leads) or diagnose */}
      {brakesLead ? (
        <Link
          href="/tires"
          onClick={() => trackEvent("tire_quote_cta_click", { source: "hero-router-secondary" })}
          className={SECONDARY_LANE_CLASS}
          aria-label="Find and order tires by size"
        >
          <Wrench className="w-5 h-5 text-nick-yellow shrink-0" />
          <span>
            <span className="block font-bold text-sm text-[#F5F5F5]">Need tires too?</span>
            <span className="block text-xs text-[#A0A0A0]">Search your size — installed prices online</span>
          </span>
        </Link>
      ) : (
        <Link
          href="/diagnose"
          onClick={() => trackEvent("diagnose_cta_click", { source: "hero-router" })}
          className={SECONDARY_LANE_CLASS}
          aria-label="Describe a symptom and get an answer"
        >
          <Activity className="w-5 h-5 text-nick-yellow shrink-0" />
          <span>
            <span className="block font-bold text-sm text-[#F5F5F5]">Something's wrong</span>
            <span className="block text-xs text-[#A0A0A0]">Describe it — free check, written quote first</span>
          </span>
        </Link>
      )}
      {/* Dropping off */}
      <a
        href="#dropoff"
        onClick={() => trackEvent("booking_cta_click", { source: "hero-router" })}
        className={SECONDARY_LANE_CLASS}
        aria-label="Drop your car off — first come, first served"
      >
        <KeyRound className="w-5 h-5 text-nick-yellow shrink-0" />
        <span>
          <span className="block font-bold text-sm text-[#F5F5F5]">Dropping off</span>
          <span className="block text-xs text-[#A0A0A0]">Keys in, Uber out — we text when it's done</span>
        </span>
      </a>
      {/* Talk to someone */}
      <a
        href={BUSINESS.phone.href}
        onClick={() => trackPhoneClick("hero-router")}
        className={`${SECONDARY_LANE_CLASS} sm:col-span-2`}
        aria-label={`Call Nick's Tire and Auto at ${BUSINESS.phone.display}`}
      >
        <MessageCircle className="w-5 h-5 text-nick-yellow shrink-0" />
        <span className="flex-1">
          <span className="block font-bold text-sm text-[#F5F5F5]">Talk to a human</span>
          <span className="block text-xs text-[#A0A0A0]">Real person, real answer — {BUSINESS.phone.display}</span>
        </span>
        <Phone className="w-4 h-4 text-nick-yellow shrink-0" />
      </a>
      {personalization.showProximityNote && (
        <p className="sm:col-span-2 text-xs text-[#A0A0A0]" data-testid="proximity-note">
          Coming from Maps? You're close — pull up anytime, 7 days a week. First come, first served.
        </p>
      )}
    </div>
  );
}

// ─── HERO — same cinematic photo stage as legacy, ONE decision ───
function Hero({ reviewData }: { reviewData: HomeReviewData }) {
  const { rating, totalReviews } = reviewData;
  // Wave C: personalize the router's leading lane from the ALREADY
  // captured UTM/referrer (lib/utm.ts). Pure read, computed once per
  // mount; any storage failure falls back to the default (tires lead).
  const personalization = useMemo<HeroPersonalization>(() => {
    try {
      return deriveHeroPersonalization(getUtmData());
    } catch {
      return DEFAULT_HERO_PERSONALIZATION;
    }
  }, []);

  return (
    <section className="relative min-h-[100svh] flex items-center overflow-hidden hero-stage">
      <div className="absolute inset-0 hero-bg ken-burns-target">
        <img
          src={HERO_IMG}
          alt="Nick's Tire & Auto storefront on Euclid Avenue in Cleveland with the yellow sign, open service bays, and tire stacks visible"
          className="w-full h-full object-cover [object-position:center_42%]"
          loading="eager"
          fetchPriority="high"
          width="1920"
          height="1080"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(105deg, rgba(8,10,14,0.96) 0%, rgba(10,12,16,0.78) 35%, rgba(0,0,0,0.35) 70%, rgba(0,0,0,0) 100%)",
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at 25% 50%, transparent 0%, transparent 30%, rgba(0,0,0,0.65) 100%)",
          }}
        />
        {/* Mobile headline-readability band (see HomeLegacy for tuning notes) */}
        <div
          className="absolute inset-x-0 top-[280px] h-[420px] md:hidden pointer-events-none"
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(8,10,14,0.32) 15%, rgba(8,10,14,0.55) 50%, rgba(8,10,14,0.32) 85%, rgba(0,0,0,0) 100%)",
          }}
        />
        <div className="absolute inset-0 photo-grain pointer-events-none mix-blend-overlay opacity-[0.12]" />
        <HeroDustLayer />
      </div>

      <div className="relative container">
        <div className="max-w-full lg:max-w-[58%] mt-28 sm:mt-48 lg:mt-40">
          <h1
            className="font-heading font-extrabold uppercase text-[#F5F5F5] leading-[0.95] tracking-tight headline-balance"
            style={{
              fontSize: "clamp(1.5rem, 3.5vw, 3.5rem)",
              filter:
                "drop-shadow(0 2px 4px rgba(0,0,0,0.95)) drop-shadow(0 4px 24px rgba(0,0,0,0.85)) drop-shadow(0 0 2px rgba(0,0,0,1))",
              textShadow:
                "0 0 8px rgba(0,0,0,0.9), 0 2px 0 rgba(0,0,0,0.6), 0 0 24px rgba(0,0,0,0.5)",
              WebkitTextStroke: "1px rgba(0,0,0,0.6)",
              paintOrder: "stroke fill",
            }}
          >
            <StampLetters text="Pull up for tires." delay={0.3} />
            <br />
            <StampLetters
              text="Drop off for repairs."
              delay={0.55}
              className="text-nick-yellow"
            />
          </h1>

          {/* Subhead — $25 always travels with its typical band
              (shared/business.ts usedTires rule: honesty/FTC). */}
          <p
            className="mt-6 text-base sm:text-lg lg:text-xl font-sans text-[#D4D4D4] max-w-sm body-pretty motion-safe:animate-[fadeIn_0.6s_ease-out_0.5s_both]"
            style={{
              textShadow:
                "0 1px 6px rgba(0,0,0,0.95), 0 0 14px rgba(0,0,0,0.6)",
            }}
          >
            Cleveland's first-come-first-served <Link href="/tires" className="underline text-primary hover:text-primary-foreground">tire shop near Cleveland</Link> on Euclid Ave. Walk in 7 days. Used tires from <span className="text-nick-yellow font-semibold">$25</span> — most sizes $40-80 installed. Written estimate before any wrench moves.
          </p>

          <IntentRouter personalization={personalization} />

          {/* Trust chips — the hero's ONE inline trust moment (Reviews
              section below is the page's single full trust unit). */}
          <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:text-base motion-safe:animate-[fadeIn_0.6s_ease-out_0.9s_both]">
            <span className="inline-flex items-center gap-1.5 text-nick-yellow">
              <span className="flex gap-0.5">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-nick-yellow text-nick-yellow" />
                ))}
              </span>
              {rating.toFixed(1)} from {totalReviews.toLocaleString()}+ reviews
            </span>
            <span className="text-[#A0A0A0]">&bull; First-come-first-served</span>
            <span className="text-[#A0A0A0]">&bull; Used tires from $25 &middot; most sizes $40-80</span>
            <span className="text-[#A0A0A0]">&bull; Open 7 days incl. Sunday</span>
          </div>
          <div className="mt-3 motion-safe:animate-[fadeIn_0.5s_ease-out_1.1s_both]">
            <LiveVisitorCounter minToShow={3} />
          </div>
        </div>
      </div>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
        <ChevronDown className="w-5 h-5 text-foreground/30 motion-safe:animate-bounce" />
      </div>
    </section>
  );
}

// ─── USED TIRES CALLOUT — feeds the /tires funnel ────────────────
function UsedTiresCallout() {
  return (
    <section className="bg-nick-yellow py-20 lg:py-28 relative overflow-hidden">
      <div className="hidden lg:block absolute -right-12 top-1/2 -translate-y-1/2 opacity-25 pointer-events-none">
        <div className="css-tire css-tire-lg" style={{ width: "320px", height: "320px" }} aria-hidden="true" />
      </div>
      <div className="container relative">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
          <div className="text-center lg:text-left">
            <FadeIn>
              <h2 className="font-heading text-4xl lg:text-5xl font-extrabold text-black uppercase tracking-tight headline-balance">
                USED TIRES — CLEVELAND'S BEST-KEPT SECRET
              </h2>
              <p className="mt-2 text-black/70 text-lg lg:text-xl font-medium max-w-lg body-pretty">
                Every used tire passes a 4-point exam — tread depth, sidewall, bead, age date. Free mount, balance, and valve stems. Rolling before your coffee gets cold.
              </p>
            </FadeIn>
          </div>
          <FadeIn delay={0.15}>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/tires"
                onClick={() => trackEvent("tire_quote_cta_click", { source: "used-tires-callout" })}
                className="inline-flex items-center justify-center gap-2 bg-black text-nick-yellow px-8 py-3.5 rounded-lg font-bold text-base hover:bg-black/90 transition-colors"
              >
                Search your size
                <ArrowRight className="w-5 h-5" />
              </Link>
              <a
                href={BUSINESS.phone.href}
                onClick={() => trackPhoneClick("used-tires-callout")}
                className="inline-flex items-center justify-center gap-2 border-2 border-black text-black px-8 py-3.5 rounded-lg font-bold text-base hover:bg-black/10 transition-colors"
              >
                <Phone className="w-5 h-5" />
                {BUSINESS.phone.display}
              </a>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

// ─── SERVICES — the 3 cinematic image tiles ──────────────────────
const HERO_SERVICES = [
  {
    title: "Tires",
    slug: "/tires",
    desc: "Every tire we install — new or used — gets a free mount, balance, valve stems, TPMS reset, and an alignment check. The kind of welcome you wish a hotel gave you.",
    img: TIRES_IMG,
    imgPos: "center 50%",
    price: "Free install on every tire",
  },
  {
    title: "Brakes",
    slug: "/brakes",
    desc: "Pads, rotors, calipers, lines, ABS. We hand you a flashlight and walk you under your own car so you can see the worn part. The metal doesn't lie. Neither do we.",
    img: BRAKES_IMG,
    imgPos: "center 65%",
    price: "Free brake check",
  },
  {
    title: "Diagnostics",
    slug: "/diagnostics",
    desc: "If your car is making a noise even Spotify can't identify, drive it over. Free OBD-II scan, written estimate before a wrench moves, and a real explanation in real English.",
    img: DIAG_IMG,
    imgPos: "center 35%",
    price: "Free scan · honest answers",
  },
];

function Services() {
  return (
    <section id="services">
      {HERO_SERVICES.map((s) => {
        const mediumSrc = s.img.replace(/\.webp$/, "-medium.webp");
        return (
        <div key={s.slug} className="group relative min-h-[65vh] sm:min-h-[80vh] flex items-end overflow-hidden">
          <div className="absolute inset-0">
            <picture>
              <source media="(max-width: 1024px)" srcSet={mediumSrc} />
              <img
                src={s.img}
                alt={`${s.title} service at Nick's Tire and Auto`}
                className="w-full h-full object-cover transition-transform duration-[1500ms] ease-out group-hover:scale-[1.04]"
                style={{ objectPosition: s.imgPos }}
                loading="lazy"
                decoding="async"
                width="1600"
                height="900"
              />
            </picture>
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/55 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-background/60 via-transparent to-background/30" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_30%,_rgba(0,0,0,0.35)_100%)]" />
          </div>
          <div className="relative container pb-20">
            <FadeIn>
              <p className="text-[11px] uppercase tracking-[0.22em] font-bold text-nick-yellow mb-3 drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
                The Service
              </p>
              <h2 className="font-heading text-4xl lg:text-6xl font-bold text-foreground tracking-tight uppercase drop-shadow-[0_4px_16px_rgba(0,0,0,0.7)]">
                {s.title}
              </h2>
              <p className="mt-2 text-nick-yellow font-semibold text-lg drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">{s.price}</p>
              <p className="mt-3 text-lg text-foreground/75 max-w-md font-light drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">
                {s.desc}
              </p>
              <div className="mt-6 flex gap-3">
                <Link
                  href={s.slug}
                  className="inline-flex items-center gap-2 bg-foreground text-background px-6 py-3 rounded-full font-medium text-sm hover:bg-foreground/90 transition-colors shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
                >
                  Learn more about {s.title.toLowerCase()}
                </Link>
                <a
                  href={BUSINESS.phone.href}
                  onClick={() => trackPhoneClick(`service-${s.slug}`)}
                  className="inline-flex items-center gap-2 border border-foreground/40 bg-black/30 backdrop-blur-sm text-foreground px-6 py-3 rounded-full font-medium text-sm hover:bg-black/50 hover:border-foreground/70 transition-colors"
                >
                  {BUSINESS.phone.display}
                </a>
              </div>
            </FadeIn>
          </div>
        </div>
        );
      })}
    </section>
  );
}

// ─── REVIEWS — THE trust unit ────────────────────────────────────
const FALLBACK_REVIEWS = [
  { name: "Nurse Summer", stars: 5, text: "I have been to many mechanics in Cleveland this is the FIRST shop that I felt I could trust! Especially as a woman.. it's very hard to find HONEST and well done mechanic work." },
  { name: "Amber Sartain", stars: 5, text: "I've been in the market for a shop/mechanic, that isn't going to break the bank and does good, honest work. And today I found them." },
  { name: "Tammy Hicks", stars: 5, text: "Jahnah was so helpful and kind! She made sure I got the best tires for my vehicle at a great price. The service was fast and professional." },
];

function Reviews({ reviewData }: { reviewData: HomeReviewData }) {
  const { totalReviews, googleReviews } = reviewData;
  const displayReviews = googleReviews && googleReviews.length > 0
    ? googleReviews.slice(0, 3).map(r => ({ name: r.authorName, stars: r.rating, text: r.text }))
    : FALLBACK_REVIEWS;

  return (
    <section className="section-elevated py-24 lg:py-32">
      <div className="container">
        <FadeIn>
          <div className="text-center mb-16">
            <h2 className="font-heading text-4xl lg:text-5xl font-bold text-foreground tracking-tight uppercase">
              {totalReviews.toLocaleString()}+ five&#8209;star reviews.<sup className="text-primary text-xl">*</sup>
            </h2>
            <p className="mt-4 text-foreground/60 text-lg">Verified by Google. Written by real Cleveland drivers — bus drivers, nurses, Browns fans, the lady whose Civic survived 287,000 miles. No bots, no buyouts, no fake reviews.</p>
            <p className="mt-3 text-foreground/50 text-sm italic">* Yes, all real. Google catches fakes faster than we do.</p>
          </div>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 stagger-in depth-stage">
          {displayReviews.map((r, i) => (
            <FadeIn key={r.name + i} delay={i * 0.1}>
              <div className="tilt-card p-8 border border-border rounded-2xl h-full flex flex-col glow-on-hover">
                <div className="flex gap-0.5 mb-5">
                  {[...Array(r.stars)].map((_, j) => (
                    <Star key={j} className="w-4 h-4 fill-nick-yellow text-primary" />
                  ))}
                </div>
                <p className="text-foreground/70 leading-relaxed flex-1 text-[0.95rem]">"{r.text}"</p>
                <div className="mt-6 pt-5 border-t border-border">
                  <span className="font-semibold text-foreground text-sm">{r.name}</span>
                  <span className="block text-foreground/60 text-xs mt-0.5">Google Review</span>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>

        <FadeIn delay={0.4}>
          <div className="mt-12 text-center">
            <Link href="/reviews" className="inline-flex items-center gap-2 text-sm font-medium text-foreground/50 hover:text-foreground transition-colors">
              Read all 1,700+ reviews <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

// ─── CONTACT — split with booking form (no financing banner) ─────
function Contact() {
  return (
    <section id="contact" className="bg-[oklch(0.065_0.004_260)] py-24 lg:py-32">
      <div className="container">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
          <FadeIn>
            <div>
              <h2 className="font-heading text-4xl lg:text-5xl font-bold text-foreground tracking-tight uppercase">
                Pull up anytime.
              </h2>
              <p className="mt-4 text-foreground/60 text-lg">No appointment needed. Walk in 7 days a week, drop the keys, hail an Uber from our lot — we'll text the moment your car is ready. Some customers leave for a haircut and come back to a finished alignment.</p>

              <div className="mt-10 space-y-8">
                <div>
                  <h3 className="text-xs font-semibold text-foreground/60 uppercase tracking-widest mb-3">Location</h3>
                  <div className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-primary mt-1 shrink-0" />
                    <div className="text-foreground/70">
                      <p>{BUSINESS.address.street}</p>
                      <p>Cleveland, OH 44112</p>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-foreground/60 uppercase tracking-widest mb-3">Hours</h3>
                  <div className="flex items-start gap-3">
                    <Clock className="w-4 h-4 text-primary mt-1 shrink-0" />
                    <div className="text-foreground/70">
                      <p>Monday – Saturday: 8 AM – 6 PM</p>
                      <p>Sunday: 9 AM – 4 PM</p>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-foreground/60 uppercase tracking-widest mb-3">Phone</h3>
                  <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('contact')} className="flex items-center gap-3 group">
                    <Phone className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-2xl font-semibold text-foreground group-hover:text-primary transition-colors tracking-tight">{BUSINESS.phone.display}</span>
                  </a>
                </div>

                <a
                  href={BUSINESS.urls.googleMapsDirectionsNamed}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-foreground text-background px-6 py-3 rounded-full font-medium text-sm hover:bg-foreground/90 transition-colors"
                >
                  Get Directions
                </a>
              </div>
            </div>
          </FadeIn>

          <FadeIn delay={0.15}>
            <div id="booking">
              <BookingForm />
            </div>
          </FadeIn>
        </div>

        <FadeIn delay={0.25}>
          <div className="mt-16 w-full aspect-[21/9] rounded-2xl overflow-hidden border border-border">
            <iframe
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2987.5!2d-81.5597624!3d41.5525118!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x8830ffda2d516449%3A0xcabdcc3204cd9c5!2sNick&#39;s%20Tire%20And%20Auto%20Euclid!5e0!3m2!1sen!2sus!4v1710000000000"
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="Nick's Tire and Auto location"
            />
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

// ─── WEATHER BANNER — real-weather-gated (no manufactured urgency) ─
function WeatherBanner() {
  const cta = useWeatherCTA();
  const track = useConversionTracking();
  if (!cta) return null;

  const tone =
    cta.urgency === "high"
      ? "bg-red-500/10 border-red-500/30 text-red-300"
      : cta.urgency === "medium"
        ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
        : "bg-foreground/[0.04] border-border/30 text-foreground/80";

  return (
    <section className={`border-b ${tone} px-4 py-2.5`}>
      <div className="container flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {cta.urgency === "high" ? (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          ) : (
            <Snowflake className="w-4 h-4 shrink-0" />
          )}
          <div className="text-sm">
            <span className="font-bold">{cta.message}</span>
            <span className="opacity-80"> — {cta.sub}</span>
          </div>
        </div>
        <Link
          href={cta.ctaHref}
          onClick={() => track({ type: "weather_cta_clicked", element: cta.ctaHref, props: { urgency: cta.urgency } })}
          className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded bg-foreground/10 hover:bg-foreground/20 px-3 py-1.5 text-xs font-bold tracking-wide whitespace-nowrap"
        >
          {cta.ctaLabel}
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </section>
  );
}

// ─── TRIAGE GRID — symptom router into the service pages ─────────
//
// feat/home-v2: consequence lines rewritten from invented-number fear
// stats ("$4,000 in 30 days", "stopping distance doubles") to mechanical
// truths — the anti-fabrication rule applies to copy, not just widgets.
function TriageGrid() {
  return (
    <section className="bg-[oklch(0.055_0.004_260)] py-20 lg:py-32 border-t border-border/30">
      <div className="container">
        <FadeIn>
          <div className="text-center mb-10">
            <div className="text-nick-yellow text-[10px] font-mono uppercase tracking-widest mb-2">
              What's your car telling you?
            </div>
            <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-black text-foreground uppercase tracking-tight">
              Pick your symptom — we'll fix it today.
            </h2>
            <p className="mt-3 text-foreground/50 text-sm sm:text-base max-w-2xl mx-auto">
              Honest answer before any work. Free check in under an hour. Most fixes done today — first-come, first-served.
            </p>
          </div>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <ServiceTriageCard
            tone="danger"
            icon={<Disc className="w-5 h-5" />}
            symptom="Grinding or squealing brakes?"
            consequence="Worn pads eat rotors with every stop. Wait too long, a pads-only job becomes pads + rotors + caliper — multiplying the bill."
            relief="Free brake check. Written quote — you don't pay until you say yes."
            ctaLabel="STOP THE DAMAGE"
            ctaHref="/brakes"
          />
          <ServiceTriageCard
            tone="warning"
            icon={<Activity className="w-5 h-5" />}
            symptom="Check engine light on?"
            consequence="A small sensor fault left alone can cascade into exhaust and engine damage. The code tells us exactly where to look."
            relief="Free 5-minute code scan. If we need to dig deeper, we tell you the cost before we touch anything."
            ctaLabel="DIAGNOSE NOW"
            ctaHref="/diagnostics"
          />
          <ServiceTriageCard
            tone="info"
            icon={<Wrench className="w-5 h-5" />}
            symptom="Tires bald, low, or vibrating?"
            consequence="Worn tread means much longer stops in the rain, and Cleveland potholes shred unmatched treads fast."
            relief="New & used tires installed with free mount, balance, and alignment check. Walk in or call for a live quote on your size."
            ctaLabel="GET TIRES TODAY"
            ctaHref="/tires"
          />
          <ServiceTriageCard
            tone="warning"
            icon={<Zap className="w-5 h-5" />}
            symptom="AC weak or not cold?"
            consequence="Caught early it's often a simple recharge; run it dry and compressor damage makes the job much bigger."
            relief="Free AC check. Written quote — you don't pay until you say yes."
            ctaLabel="FIX AC NOW"
            ctaHref="/ac-repair"
          />
          <ServiceTriageCard
            tone="warning"
            icon={<Clock className="w-5 h-5" />}
            symptom="Failed Ohio E-Check?"
            consequence="You get 30 days to fix and re-test. Driving past the deadline risks tickets and registration holds."
            relief="State-certified emissions repair. Pull up today — we'll get you legal."
            ctaLabel="GET LEGAL"
            ctaHref="/emissions"
          />
          <ServiceTriageCard
            tone="info"
            icon={<Wrench className="w-5 h-5" />}
            symptom="Just need the basics?"
            consequence="Routine oil + filter is the cheapest engine insurance there is — sludge is what kills engines early."
            relief="Free 27-point check on every oil change. Walk-ins welcome 7 days."
            ctaLabel="SCHEDULE DROP-OFF"
            ctaHref="/oil-change"
          />
        </div>
      </div>
    </section>
  );
}

// ─── PAGE ────────────────────────────────────────────────────────
export default function Home() {
  const { data: googleData } = trpc.reviews.google.useQuery(undefined, {
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  const reviewData = {
    rating: (googleData?.rating && googleData.rating > 0) ? googleData.rating : BUSINESS.reviews.rating,
    totalReviews: googleData?.totalReviews ?? BUSINESS.reviews.count,
    googleReviews: googleData?.reviews,
  };

  return (
    <PageLayout activeHref="/" showChat={true}>
      {/* Title keeps brand-lead (cannibalization fix, see HomeLegacy notes).
          Description: $25 travels with its band (business.ts usedTires rule)
          and the old "pay only when satisfied" overpromise is replaced with
          the site's real approval-gate wording. */}
      <SEOHead
        title="Nick's Tire & Auto Cleveland · Tires & Auto Repair Euclid"
        description="Nick's Tire & Auto on Euclid Ave. Used tires from $25, most sizes $40-80 installed. Brakes & repairs, walk in 7 days, written quote first. (216) 862-0005"
        canonicalPath="/"
      />
      <LocalBusinessSchema includeHowTo includeReviews includeServices />
      {/* WebSite schema anchors "/" as the brand entity's canonical entry.
          feat/home-v2: the SearchAction was REMOVED — it pointed at
          /search?q= which has no route (App.tsx catch-all → NotFound), so
          Google's sitelinks searchbox 404'd. Restore only WITH a real
          /search route. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "Nick's Tire & Auto",
            alternateName: ["Nicks Tire", "Nick's Tire", "Nicks Tires", "Nicks Tire and Auto"],
            url: "https://nickstire.org/",
          }),
        }}
      />
      {/* Homepage-only Service schema. feat/home-v2: value corrected
          $289→$266 — the itemized package in gatewayTire.ts sums to $266
          and that's what the live getPackage endpoint + order modal show. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Service",
            name: "Tire Install Package (Free with Every Set)",
            description:
              "Free with every tire purchase. Includes professional mounting, computer balancing, new valve stems, TPMS reset, alignment check, 20-point safety inspection, rim cleaning, and tire disposal. $266+ value.",
            provider: {
              "@type": "AutoRepair",
              name: BUSINESS.name,
              telephone: `+1-${BUSINESS.phone.dashed}`,
              url: BUSINESS.urls.website,
              address: {
                "@type": "PostalAddress",
                streetAddress: BUSINESS.address.street,
                addressLocality: BUSINESS.address.city,
                addressRegion: BUSINESS.address.state,
                postalCode: BUSINESS.address.zip,
                addressCountry: "US",
              },
            },
            areaServed: BUSINESS.serviceAreas.map((a) => ({ "@type": "City", name: a })),
            serviceType: "Tire Installation",
            offers: {
              "@type": "Offer",
              price: "0",
              priceCurrency: "USD",
              description: "Free with tire purchase — value $266+",
            },
          }),
        }}
      />
      <WeatherBanner />
      <Hero reviewData={reviewData} />
      {/* FCFS ritual explainer — the most defensible differentiator. */}
      <RiseInView className="parallax-rise"><ConesBlock /></RiseInView>
      {/* Live status strip — real bay/booking data, graceful degrade. */}
      <section className="bg-[oklch(0.055_0.004_260)] py-6 border-t border-b border-border/30">
        <div className="container flex items-center justify-center">
          <ShopStatusWidget compact />
        </div>
      </section>
      {/* Sunday differentiator + Nonstop Nick retention hook. */}
      <section className="bg-background py-10 border-b border-border/30">
        <div className="container max-w-3xl mx-auto text-center px-4">
          <div className="text-nick-yellow text-[10px] font-mono uppercase tracking-widest mb-2">
            Sunday flat? We&apos;re open.
          </div>
          <h2 className="font-heading text-2xl sm:text-3xl font-black text-foreground uppercase tracking-tight">
            Chains close Sunday. Nick&apos;s runs 9 to 4.
          </h2>
          <p className="text-foreground/60 text-sm mt-3 max-w-xl mx-auto leading-relaxed">
            Most tire chains in Cleveland go dark on Sunday &mdash; we&apos;re on
            Euclid Ave working the line 9 AM to 4 PM. Nonstop Nick members
            pull up and get flat repairs, valve stems, rotation, and air-ups
            for $0 on their registered vehicle &mdash; $7.99/mo.
          </p>
          <Link
            href="/nonstop-nick"
            onClick={() => trackEvent("nonstop_sunday_cta_click", { source: "home" })}
            className="inline-flex items-center justify-center mt-5 min-h-[44px] px-6 rounded-full bg-nick-yellow text-black text-[13px] font-black uppercase tracking-wide active:scale-95 transition-transform hover:brightness-110"
          >
            See what&apos;s covered &rarr;
          </Link>
        </div>
      </section>
      <RiseInView className="parallax-rise"><UsedTiresCallout /></RiseInView>
      <RiseInView className="parallax-rise"><TriageGrid /></RiseInView>
      <RiseInView className="parallax-rise"><Services /></RiseInView>
      <RiseInView className="parallax-rise"><Reviews reviewData={reviewData} /></RiseInView>
      {/* ── DROP-OFF + UBER-OUT — id="dropoff" is the hero router target ── */}
      <section id="dropoff" className="bg-[oklch(0.055_0.004_260)] py-14 border-t border-border/30 halftone-light">
        <div className="container">
          <div className="max-w-2xl mx-auto text-center mb-8">
            <div className="text-nick-yellow text-[10px] font-mono uppercase tracking-widest mb-2">
              The Drop-Off Flywheel
            </div>
            <h2 className="font-heading text-3xl sm:text-4xl font-black text-foreground uppercase tracking-tight">
              Drop the car. Keep your day.
            </h2>
            <p className="text-foreground/60 text-sm mt-3 max-w-lg mx-auto">
              Pull up, hand us the keys, tap below to summon an Uber right from our lot. We text the second your car is ready. No waiting-room magazines from 2014, no wasted PTO, no Sunday lost to a bay.
            </p>
          </div>
          <UberDropoffWidget theme="gold" />
          {/* Wave B: "I'm heading over" heads-up — rides the existing
              callback pipeline (SMS confirm + Telegram staff alert). */}
          <DropOffRequestCard />
        </div>
      </section>
      <Contact />

      {/* Internal-link equity block — flat list, no scroll bloat. */}
      <section className="bg-background border-t border-border/20 py-10">
        <div className="container max-w-5xl mx-auto px-4">
          <h2 className="text-xs uppercase tracking-[0.18em] text-foreground/50 font-medium mb-4">
            Browse by service or neighborhood
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2 text-sm">
            <a href="/brakes" className="text-foreground/70 hover:text-primary transition-colors">Brake Repair</a>
            <a href="/alignment" className="text-foreground/70 hover:text-primary transition-colors">Wheel Alignment</a>
            <a href="/oil-change" className="text-foreground/70 hover:text-primary transition-colors">Oil Change</a>
            <a href="/diagnostics" className="text-foreground/70 hover:text-primary transition-colors">Check Engine Light Diagnostics</a>
            <a href="/tires" className="text-foreground/70 hover:text-primary transition-colors">Tire Finder</a>
            <a href="/financing" className="text-foreground/70 hover:text-primary transition-colors">Financing</a>
            <a href="/cleveland-auto-repair" className="text-foreground/70 hover:text-primary transition-colors">Cleveland</a>
            <a href="/euclid-auto-repair" className="text-foreground/70 hover:text-primary transition-colors">Euclid</a>
            <a href="/east-cleveland-auto-repair" className="text-foreground/70 hover:text-primary transition-colors">East Cleveland</a>
            <a href="/areas-served" className="text-foreground/70 hover:text-primary transition-colors">All neighborhoods →</a>
            <a href="/emissions" className="text-foreground/70 hover:text-primary transition-colors">E-Check & Emissions</a>
            <a href="/specials" className="text-foreground/70 hover:text-primary transition-colors">Specials</a>
            <a href="/about" className="text-foreground/70 hover:text-primary transition-colors">About Us</a>
          </div>
        </div>
      </section>

      <LeadPopup />
    </PageLayout>
  );
}
