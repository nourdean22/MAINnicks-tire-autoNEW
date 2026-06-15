/*
 * Home Page — Nick's Tire & Auto
 * Dark, bold hero with Barlow Condensed headings, DM Sans body,
 * JetBrains Mono stat numbers, gold accents
 */

import { useState } from "react";
import { Link, useLocation } from "wouter";
import BookingForm from "@/components/BookingForm";
import FinancingCTA from "@/components/FinancingCTA";
import LeadPopup from "@/components/LeadPopup";
import ComparisonTable from "@/components/ComparisonTable";
import PageLayout from "@/components/PageLayout";
import { SEOHead, trackPhoneClick, trackEvent } from "@/components/SEO";
import { Phone, MapPin, Clock, Star, ChevronDown, ArrowRight, Disc, Activity, Wrench, Zap, AlertTriangle, Snowflake } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";
import { GBP_REVIEW_URL } from "@shared/const";
import TrustStrip from "@/components/TrustStrip";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FadeIn from "@/components/FadeIn";
import Eyebrow from "@/components/Eyebrow";
import CountUpNumber from "@/components/CountUpNumber";
import ShopStatusWidget from "@/components/ShopStatusWidget";
import UberDropoffWidget from "@/components/UberDropoffWidget";
import RiseInView from "@/components/RiseInView";
import HeroDustLayer from "@/components/HeroDustLayer";
import StampLetters from "@/components/StampLetters";
import SkylineDivider from "@/components/SkylineDivider";
import ConesBlock from "@/components/ConesBlock";
// Conversion-architecture components (Batch 1 of v1.1 spec)
import LiveVisitorCounter from "@/components/conversion/LiveVisitorCounter";
import ServiceTriageCard from "@/components/conversion/ServiceTriageCard";
import AnchorAdjustmentTable from "@/components/conversion/AnchorAdjustmentTable";
import FearCalibrationBlock from "@/components/conversion/FearCalibrationBlock";
import LossAversionStat from "@/components/conversion/LossAversionStat";
import { useWeatherCTA } from "@/hooks/useWeatherCTA";
import { useConversionTracking } from "@/hooks/useConversionTracking";

// 2026-05-06 wave-16 · photos swapped to the new pro photo pack per
// PLACEMENT_GUIDE.md. The storefront-hero photo shows the FULL yellow
// sign + 3 open bays + tire stacks (the strongest first-impression
// trust image). Vertical fallback for mobile keeps the sign visible
// when object-cover crops aggressively on phones.
const HERO_IMG = "/photos/shop-exterior-hero-wide-sign-bays.webp";
const HERO_IMG_MOBILE = "/photos/shopfront-clear-vertical-sign-bays.webp";

// Service-tile + WhyUs photos — wave-16 placement-guide pull:
// · Tires tile → aggressive tread closeup (tire authority)
// · Brakes tile → under-car brake repair action (safety credibility)
// · Diagnostics tile → interior service bay with car on lift (capability)
// · WhyUs/Mechanic section → busy shop with techs working (real shop activity)
const MECHANIC_IMG = "/photos/busy-shop-action-mechanics.webp";
const TIRES_IMG = "/photos/rugged-tire-tread-closeup.webp";
const DIAG_IMG = "/photos/interior-service-bay-car-lift.webp";
const BRAKES_IMG = "/photos/undercar-brake-repair-action.webp";

/**
 * wave-172b: shared review-data shape lifted to Home root. Hero,
 * TrustNumbers, and Reviews previously each called
 * `trpc.reviews.google.useQuery` independently — React Query
 * deduplicates the fetch but each component still subscribed to the
 * cache and re-rendered separately on data arrival (3 re-renders for
 * 1 data event + 3 staleTime instances that could drift).
 *
 * Now Home calls the query once, computes the unified shape, and
 * passes props down. Cleaner architecture + single re-render.
 */
interface HomeReviewData {
  rating: number;
  totalReviews: number;
  googleReviews?: Array<{ authorName: string; rating: number; text: string }>;
}

// ─── HERO — Full-viewport cinematic with left content ────
function Hero({ reviewData }: { reviewData: HomeReviewData }) {
  const { rating, totalReviews } = reviewData;
  const [symptom, setSymptom] = useState("");
  const [, setLocation] = useLocation();

  const handleSymptomSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (symptom.trim()) {
      setLocation(`/diagnose?symptom=${encodeURIComponent(symptom.trim())}`);
    }
  };

  return (
    <section className="relative min-h-[100svh] flex items-center overflow-hidden hero-stage">
      {/* Full-bleed background — <picture> element serves a 120KB mobile-optimized
          variant under 768px instead of the 577KB desktop file. 5x bandwidth
          win on mobile first-paint, identical visual on desktop.
          Ken Burns drift on the photo + film-grain overlay add cinematic
          depth without WebGL or extra bytes. Pure CSS, motion-safe. */}
      <div className="absolute inset-0 hero-bg ken-burns-target">
        {/* 2026-05-06 wave-16 · pro photo pack hero. <picture> serves
            the vertical sign-bays variant on phones <=768px so the
            sign isn't cropped on mobile — desktop gets the wide hero
            with full sign + open bays. object-position 'center 42%'
            per the placement guide keeps the sign in frame after
            object-cover crop. */}
        <picture>
          {/* wave-172: mobile gets the small (320px) variant for fast LCP,
              medium viewports (≤1024px) get -medium (560px), desktop gets
              full hero. Saves ~354KB on mobile alone. */}
          <source media="(max-width: 768px)" srcSet="/photos/shopfront-clear-vertical-sign-bays-small.webp" />
          <source media="(max-width: 1024px)" srcSet="/photos/shopfront-clear-vertical-sign-bays-medium.webp" />
          <img
            src={HERO_IMG}
            alt="Nick's Tire & Auto storefront on Euclid Avenue in Cleveland with the yellow sign, open service bays, and tire stacks visible"
            // 2026-05-24 PSI/photo audit · object-position is now
            // viewport-responsive. Mobile (≤md) uses `center 42%` since the
            // vertical-small variant has the sign centered horizontally in
            // the frame — pushing right caused it to crop off the edge.
            // Desktop (md+) keeps `right 42%` (wave-18 headline-readability
            // fix · the H1 lives on the LEFT, so the bright sign on the
            // RIGHT keeps the dark sky/trees zone under the headline).
            className="w-full h-full object-cover [object-position:center_42%] md:[object-position:right_42%]"
            loading="eager"
            fetchPriority="high"
            width="1920"
            height="1080"
          />
        </picture>
        {/* 2026-05-06 wave-18 · Headline-readability fix.
            object-position pushed from "center 42%" to "right 42%" so the
            bright yellow sign sits on the RIGHT side of the frame, leaving
            the LEFT (where the H1 lives) in the dark sky/trees zone. The
            gradient overlay is also strengthened to add more contrast under
            the headline area. Combined with text-shadow on the yellow span,
            "Drop off for repairs." now has crisp readability against the
            still-visible-but-not-overlapping sign. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(105deg, rgba(8,10,14,0.96) 0%, rgba(10,12,16,0.78) 35%, rgba(0,0,0,0.35) 70%, rgba(0,0,0,0) 100%)",
          }}
        />
        {/* Vignette — focuses attention on the headline area + adds depth */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at 25% 50%, transparent 0%, transparent 30%, rgba(0,0,0,0.65) 100%)",
          }}
        />
        {/* wave-fix-2026-05-25 · mobile-only headline-readability band.
            Operator eyeball test on PSI screenshot (54 mobile) showed the
            yellow "PULL UP FOR TIRES / DROP OFF FOR REPAIRS" headline was
            fighting the building/sign IN the photo · text was overlapping
            the brightly-lit yellow sign + lower-floor windows. The diagonal
            105deg gradient above works on desktop where H1 lives in the
            LEFT dark-sky zone, but on mobile the H1 is centered, so it
            gets the mid-gradient (~50% opacity) which isn't enough.
            This adds a vertical dark band centered on the H1+subhead
            zone (y=280-700) at 85% peak opacity · preserves the building
            at the TOP and the CTA buttons at the BOTTOM by fading to
            transparent at both edges. md:hidden so desktop is unaffected. */}
        <div
          className="absolute inset-x-0 top-[280px] h-[420px] md:hidden pointer-events-none"
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(8,10,14,0.32) 15%, rgba(8,10,14,0.55) 50%, rgba(8,10,14,0.32) 85%, rgba(0,0,0,0) 100%)",
          }}
        />
        {/* Photo grain — inline-SVG noise, ~250 bytes total. Sells the
            "real photo on Euclid Ave" feel and hides any compression
            artifacts on older devices. */}
        <div className="absolute inset-0 photo-grain pointer-events-none mix-blend-overlay opacity-[0.12]" />
        {/* Atmospheric dust layer — canvas-based particle system, only
            renders on >=1024px viewports + WebGL-capable + reduced-
            motion-OK. Mobile customers see exactly the photo hero
            they saw before. Desktop customers get sunlight-catching-
            dust depth on top of the existing photo. */}
        <HeroDustLayer />
      </div>

      {/* Content — left-aligned */}
      <div className="relative container">
        {/* 2026-05-06 wave-8 fix · post-wave-6 verification showed the H1
            still wrapping to 4 lines at narrower-than-1512 desktop viewports
            (e.g. 1090×572 sees fontSize 80px in 850px container → "Drop off
            for repairs." overflows by ~10px → wraps). Drop max-w cap entirely
            and use clamp()-style fluid sizing so the H1 fits on 1 line per
            tagline across all viewports while staying visually massive on
            true desktop. */}
        {/* 2026-05-06 wave-21 · max-w-[58%] keeps H1 in the LEFT/dark
            sky portion of the photo so the text doesn't bleed across
            the bright yellow storefront sign on the right.
            mt-40 sm:mt-48 lg:mt-40 pushes H1 below the fixed nav
            (which is z-50 + ~107px tall when the closed-banner is up).
            Wave-20's mt-24 (96px) at lg only pushed H1 to y=57 which
            still hid the top half behind the nav. Bumped to mt-40
            (160px) at lg+ to give H1 a clear ~120px starting position. */}
        {/* 2026-05-31 hero-sky-fix · supersedes wave-41's mt-80 push-down.
            The mobile photo is portrait (320×400 ≈ 0.80) inside a much
            taller hero box (≈0.45), so object-cover fills height exactly
            and the FULL photo shows vertically — object-position Y is a
            no-op and the dead dark-sky band occupies the top ~40%.
            wave-41 pushed the H1 DOWN (mt-80) onto the storefront sign,
            burying the prettiest part of the photo behind text. We invert
            that: mt-28 seats the headline UP in the empty sky zone (its
            natural high-contrast home, clear of the nav at ~120px), so the
            yellow sign below reads unobstructed. sm/lg unchanged — the
            desktop wide photo keeps its tuned mt-48/mt-40 + max-w-[58%]. */}
        <div className="max-w-full lg:max-w-[58%] mt-28 sm:mt-48 lg:mt-40">
          {/* 2026-05-06 wave-19 · BrandMark removed from hero. It was
              rendering a "CLEVELAND TOUGH" tagline banner that visually
              overlapped with the SiteNavbar wordmark — both said NICK'S
              TIRE & AUTO and the legacy Cleveland-Tough sub-text was
              showing up clipped as "LEVELAND TOUG". The navbar logo is
              the canonical brand mark; no need for a second pendant
              in the hero. */}

          {/* 2026-05-06 wave-19 · H1 fits-into-sky redesign:
              · max font dropped 4.5rem → 3.5rem (lg fits cleanly in 58% width)
              · multi-layer drop-shadow + text-shadow + 1px stroke for crisp
                legibility against the bright sky portion of the photo */}
          <h1
            className="font-heading font-extrabold uppercase text-[#F5F5F5] leading-[0.95] tracking-tight headline-balance"
            style={{
              // 2026-05-06 wave-24 · slope tightened from 4.6vw → 3.5vw so
              // "DROP OFF FOR REPAIRS." fits on a single line inside the
              // max-w-[58%] sky column at desktop viewports between
              // 1024–1440px. At 1090vw the old 4.6vw rendered fontSize
              // 50px → headline 596px wide → wrapped to 2 lines inside
              // the ~614px column. New 3.5vw → 38px at 1090vw → ~460px
              // wide with comfortable clearance. Cap stays at 3.5rem so
              // headline still scales up on true desktops.
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
            {/* 2026-05-06 wave-22 · drop text-gradient-yellow so the "Drop
                off for repairs." line is the same solid #FDB913 brand yellow
                as the rest of the site (CTA buttons, $60 callout, "Don't let
                the problem get bigger.", trust-strip stars). The gradient
                was washing out at small/mid sizes and didn't match the
                brand-yellow used everywhere else. */}
            <StampLetters
              text="Drop off for repairs."
              delay={0.55}
              className="text-[#FDB913]"
            />
          </h1>

          {/* Subheadline */}
          {/* 2026-05-06 audit fix · subhead now leads with FCFS model +
              required language: first-come-first-served · used tires
              from $25 · written estimate before any wrench moves ·
              payment programs (NOT "financing", banned word).
              Closes on the loss-aversion anchor. */}
          {/* 2026-05-06 wave-22 · subhead repositioned to stay clear of the
              storefront sign on the right of the photo:
              · max-w-lg (512px) → max-w-sm (384px) keeps the FCFS copy in
                the dark-gradient left third of the hero
              · text size dropped one notch (text-lg/xl/2xl → text-base/lg/xl)
                so denser copy fits the narrower column without wrapping
                aggressively
              · drop-shadow added to match the H1 readability stack in case
                any character clips into the sign edge at unusual viewports */}
          {/* wave-172d: framer-motion → pure CSS for the simple enter-on-mount
              fade. animate-fade-in is a project Tailwind utility defined in
              tailwind.config (motion-safe + reduce-motion-respecting). Same
              visual effect; one fewer animated component for framer-motion
              to manage at hero mount. */}
          <p
            className="mt-6 text-base sm:text-lg lg:text-xl font-sans text-[#D4D4D4] max-w-sm body-pretty motion-safe:animate-[fadeIn_0.6s_ease-out_0.5s_both]"
            style={{
              textShadow:
                "0 1px 6px rgba(0,0,0,0.95), 0 0 14px rgba(0,0,0,0.6)",
              opacity: 0,
              animationFillMode: "forwards",
            }}
          >
            Cleveland's first-come-first-served <Link href="/tires" className="underline text-primary hover:text-primary-foreground">tire shop near Cleveland</Link> on Euclid Ave. Walk in 7 days. Used tires from <span className="text-[#FDB913] font-semibold">$25</span> installed. Written estimate before any wrench moves. Explore <Link href="/financing" className="underline text-primary hover:text-primary-foreground">payment programs for repairs</Link>, get <Link href="/brakes" className="underline text-primary hover:text-primary-foreground">brake repair in Euclid</Link>, or <Link href="/contact" className="underline text-primary hover:text-primary-foreground">contact Nick’s Tire & Auto</Link> today.
          </p>

          {/* Symptom Search Widget */}
          <form
            onSubmit={handleSymptomSearch}
            className="relative mt-8 max-w-md w-full group motion-safe:animate-[fadeInUp_0.6s_ease-out_0.6s_both]"
            style={{
              opacity: 0,
              animationFillMode: "forwards",
            }}
          >
            {/* Ambient Glow Aura */}
            <div className="absolute -inset-0.5 bg-gradient-to-r from-[#FDB913]/20 to-red-500/20 rounded-xl blur opacity-35 group-focus-within:opacity-60 transition duration-500" />
            
            <div className="relative flex items-center bg-[#0C0F14]/75 backdrop-blur-md border border-white/10 rounded-xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
              <span className="pl-4 text-[#FDB913]">
                <Activity className="w-5 h-5 animate-pulse" />
              </span>
              <input
                type="text"
                value={symptom}
                onChange={(e) => setSymptom(e.target.value)}
                placeholder="Describe symptom (e.g. shake at 60mph, squeaking brakes)..."
                className="w-full bg-transparent border-0 text-[#F5F5F5] placeholder-[#A0A0A0]/60 text-sm focus:outline-none focus:ring-0 py-3.5 px-3"
              />
              <button
                type="submit"
                className="bg-[#FDB913] hover:bg-[#e0a30b] text-[#0A0A0A] font-bold text-sm px-6 py-3.5 transition-colors flex items-center gap-1.5 shrink-0"
              >
                DIAGNOSE
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>

          {/* 2026-05-06 audit fix · 3-CTA stack per HOMEPAGE_MOCKUP:
              Red CALL NOW · Yellow SCHEDULE DROP-OFF · Outline GET DIRECTIONS.
              Mobile thumb-tested. "SCHEDULE DROP-OFF" is the FCFS-affirming
              substitute for "Book" / "Reserve" / "Hold a Bay" (banned). */}
          {/* 2026-05-06 wave-32 · hero CTAs reordered per ui-ux principle:
              SCHEDULE DROP-OFF moves to FIRST position — this is the
              lowest-friction primary conversion (form drop + Uber
              pickup) and already wins the visual race with the
              wave-31 button-in-button arrow. CALL NOW slides to second
              as the high-intent / urgent fallback. GET DIRECTIONS
              stays last as the navigational reference.

              Magnetic physics from wave-31 preserved on all three:
              custom cubic-bezier, active:scale, group-hover icon
              choreography. */}
          <div
            className="mt-8 flex flex-col sm:flex-row gap-3 motion-safe:animate-[fadeInUp_0.6s_ease-out_0.7s_both]"
            style={{ opacity: 0 }}
          >
            {/* ORDER TIRES — first CTA. Tire-buying is the highest-
                revenue intent landing on this hero; previously customers
                had no above-the-fold path to /tires (had to scroll past
                the hero into the symptom grid to find "GET TIRES TODAY").
                Direct browser audit found this gap. Same gold-primary
                style as SCHEDULE DROP-OFF — the homepage serves two
                intents (buy-tires-online + drop-off-for-service) and
                each deserves a primary CTA. */}
            <Link
              href="/tires"
              onClick={() => trackEvent("tire_quote_cta_click", { source: "hero" })}
              className="group relative inline-flex items-center bg-[#FDB913] text-[#0A0A0A] pl-7 pr-2 py-2 rounded-lg font-bold text-lg shadow-[0_4px_24px_rgba(253,185,19,0.35)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#FDB913] hover:shadow-[0_6px_32px_rgba(253,185,19,0.55)] active:scale-[0.98]"
              aria-label="Order tires online from Nick's Tire and Auto"
            >
              <span className="py-1.5">ORDER TIRES</span>
              <span className="ml-2 inline-flex items-center justify-center w-9 h-9 rounded-md bg-black/12 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1 group-hover:-translate-y-[1px] group-hover:bg-black/16">
                <ArrowRight className="w-4 h-4" />
              </span>
            </Link>
            <a
              href="#booking"
              onClick={() => trackEvent("booking_cta_click", { source: "hero" })}
              className="group relative inline-flex items-center bg-[#FDB913] text-[#0A0A0A] pl-7 pr-2 py-2 rounded-lg font-bold text-lg shadow-[0_4px_24px_rgba(253,185,19,0.35)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#FDB913] hover:shadow-[0_6px_32px_rgba(253,185,19,0.55)] active:scale-[0.98] btn-premium"
              aria-label="Schedule a drop-off at Nick's Tire and Auto"
            >
              <span className="py-1.5">SCHEDULE DROP-OFF</span>
              <span className="ml-2 inline-flex items-center justify-center w-9 h-9 rounded-md bg-black/12 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1 group-hover:-translate-y-[1px] group-hover:bg-black/16">
                <ArrowRight className="w-4 h-4" />
              </span>
            </a>
            {/* wave-171: CTA hierarchy fix. Previously CALL NOW (red) and
                SCHEDULE DROP-OFF (gold) had equal visual weight at py-3.5 +
                text-lg — competing for the eye and forcing the user to
                deliberate. Now SCHEDULE DROP-OFF stays dominant; CALL NOW
                drops one size tier (py-3 text-base); GET DIRECTIONS drops
                two tiers (py-2.5 text-sm + lower border opacity). Awwwards
                3-tier CTA hierarchy. */}
            <a
              href={BUSINESS.phone.href}
              onClick={() => trackPhoneClick("hero")}
              className="group inline-flex items-center justify-center gap-2 bg-red-500 text-white px-6 py-3 rounded-lg font-bold text-base shadow-[0_4px_24px_rgba(239,68,68,0.3)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-red-600 hover:shadow-[0_6px_32px_rgba(239,68,68,0.45)] active:scale-[0.98] btn-premium"
              aria-label={`Call Nick's Tire and Auto at ${BUSINESS.phone.display}`}
            >
              <Phone className="w-4 h-4 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:rotate-[-8deg]" />
              CALL NOW
            </a>
            <a
              href="https://www.google.com/maps/dir//Nick's+Tire+And+Auto+Euclid,+17625+Euclid+Ave,+Cleveland,+OH+44112"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent("directions_click", { source: "hero" })}
              className="group inline-flex items-center justify-center gap-2 border-2 border-[#FDB913]/40 text-[#FDB913]/90 px-5 py-2.5 rounded-lg font-bold text-sm transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#FDB913]/10 hover:border-[#FDB913]/70 hover:text-[#FDB913] active:scale-[0.98] btn-premium"
              aria-label="Get directions to Nick's Tire and Auto on Euclid Ave"
            >
              <MapPin className="w-4 h-4 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-y-[-2px]" />
              GET DIRECTIONS
            </a>
          </div>

          {/* 2026-05-06 audit fix · 5-point trust strip per mockup spec:
              4.9★ · FCFS · $25-80 tires · Payment programs · Open 7 days.
              Replaces "Financing" (banned) with "Payment programs."
              Drops "free coffee · free opinions" — moved to body. */}
          <div
            className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:text-base motion-safe:animate-[fadeIn_0.6s_ease-out_0.9s_both]"
            style={{ opacity: 0 }}
          >
            <span className="inline-flex items-center gap-1.5 text-[#FDB913]">
              <span className="flex gap-0.5">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-[#FDB913] text-[#FDB913]" />
                ))}
              </span>
              {rating.toFixed(1)} from {totalReviews.toLocaleString()}+ reviews
            </span>
            <span className="text-[#A0A0A0]">&bull; First-come-first-served</span>
            <span className="text-[#A0A0A0]">&bull; Used tires from $25</span>
            <span className="text-[#A0A0A0]">&bull; Payment programs available</span>
            <span className="text-[#A0A0A0]">&bull; Open 7 days incl. Sunday</span>
          </div>
          <div
            className="mt-3 motion-safe:animate-[fadeIn_0.5s_ease-out_1.1s_both]"
            style={{ opacity: 0 }}
          >
            <LiveVisitorCounter minToShow={3} />
          </div>
        </div>
      </div>

      {/* Scroll indicator — pure CSS bounce, no framer-motion needed */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
        <ChevronDown className="w-5 h-5 text-foreground/30 motion-safe:animate-bounce" />
      </div>
    </section>
  );
}

// ─── TRUST NUMBERS — Single horizontal strip ─────────────
function TrustNumbers({ reviewData }: { reviewData: HomeReviewData }) {
  const { rating, totalReviews } = reviewData;

  // 2026-05-07 wave-45 · design-spells: stats now count up from 0 to
  // their target when scrolled into view. Keeping only service-oriented
  // stats here since rating/reviews appear prominently in hero.
  const stats: Array<
    | { kind: "count"; to: number; decimals?: number; suffix?: string; label: string }
    | { kind: "static"; value: string; label: string }
  > = [
    { kind: "static", value: "ON-SPOT", label: "Payment Programs" },
    { kind: "static", value: "Same Day", label: "Walk-Ins · Open Sunday" },
  ];

  return (
    <section className="section-elevated py-16 border-y border-border">
      <div className="container">
        <div className="grid grid-cols-2 lg:grid-cols-2 gap-8 lg:gap-0 max-w-2xl mx-auto">
          {stats.map((s, i) => (
            <FadeIn key={s.label} delay={i * 0.1}>
              <div className={`text-center ${i === 1 ? "lg:border-l lg:border-border" : ""}`}>
                <div className="text-3xl lg:text-4xl font-bold text-[#FDB913] tracking-tight font-mono text-gradient-yellow letterpress-gold">
                  {s.kind === "count" ? (
                    <CountUpNumber
                      to={s.to}
                      decimals={s.decimals}
                      suffix={s.suffix}
                      duration={1400}
                    />
                  ) : (
                    s.value
                  )}
                </div>
                <div className="mt-1 text-sm text-foreground/60 font-medium">{s.label}</div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── USED TIRES CALLOUT — "Too good to be true" hook ────
function UsedTiresCallout() {
  return (
    <section className="bg-[#FDB913] py-20 lg:py-28 relative overflow-hidden">
      {/* CSS-only spinning tire decoration — pure border-radius +
          conic-gradient + radial, zero asset bytes. Sells the
          dimensional feel without WebGL or GLB downloads. Hidden
          on small phones to keep the headline center-stage. */}
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
              <a
                href={BUSINESS.phone.href}
                onClick={() => trackPhoneClick("used-tires-callout")}
                className="inline-flex items-center justify-center gap-2 bg-black text-[#FDB913] px-8 py-3.5 rounded-lg font-bold text-base hover:bg-black/90 transition-colors"
              >
                <Phone className="w-5 h-5" />
                {BUSINESS.phone.display}
              </a>
              <Link
                href="/tires"
                className="inline-flex items-center justify-center gap-2 border-2 border-black text-black px-8 py-3.5 rounded-lg font-bold text-base hover:bg-black/10 transition-colors"
              >
                Tour the Tire Rack
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

// ─── SERVICES — Full-viewport image tiles ────────────────
// wave-110 — service grid now derives from @shared/services SERVICES,
// the single source of truth for /tires, /brakes, /<slug> pages. The
// 3 hero tiles below stay curated (image + brand-voice copy) but the
// "More Services" grid auto-renders ALL remaining services from the
// canonical list. Previously: 6 of 15 services were exposed on home;
// the other 9 (AC, transmission, electrical, battery, exhaust,
// cooling, PPI, belts-hoses, starter-alternator) were unreachable
// without typing the URL by hand. Now all 15 surface on the homepage.
// 2026-05-24 PSI/photo audit · imgPos is the data-driven object-position
// per tile so mobile portrait crops don't lose the subject. Defaults to
// `center center` crops the sides of a landscape 1600×900 photo into a
// vertical 65vh viewport · subject often shifts off-frame. Per-photo
// vertical bias keeps the subject visible on phones AND desktops.
const HERO_SERVICES = [
  {
    title: "Tires",
    slug: "/tires",
    desc: "Every tire we install — new or used — gets a free mount, balance, valve stems, TPMS reset, and an alignment check. The kind of welcome you wish a hotel gave you.",
    img: TIRES_IMG,
    imgPos: "center 50%", // tread closeup · subject fills the frame
    price: "Free install on every tire",
  },
  {
    title: "Brakes",
    slug: "/brakes",
    desc: "Pads, rotors, calipers, lines, ABS. We hand you a flashlight and walk you under your own car so you can see the worn part. The metal doesn't lie. Neither do we.",
    img: BRAKES_IMG,
    imgPos: "center 65%", // undercar action · bias down so brake mechanism stays in frame on phones
    price: "Free brake check",
  },
  {
    title: "Diagnostics",
    slug: "/diagnostics",
    desc: "If your car is making a noise even Spotify can't identify, drive it over. Free OBD-II scan, written estimate before a wrench moves, and a real explanation in real English.",
    img: DIAG_IMG,
    imgPos: "center 35%", // car on lift · bias up so the lift + car stays visible on portrait
    price: "Free scan · honest answers",
  },
];

function Services() {
  return (
    <section id="services">
      {/* Featured services — large image tiles with cinematic overlay treatment */}
      {/* Mobile gets 65vh per tile (3 × 65vh = 195vh of scroll, down from 240vh)
          so phone users don't feel like the homepage is endless. Desktop keeps
          the cinematic 80vh feel. Group hover + ken-burns zoom is desktop-only
          (mobile has no cursor hover). */}
      {HERO_SERVICES.map((s) => {
        // wave-172: srcset for the three service tiles. Mobile/tablet
        // (≤1024px) gets the -medium 560px variant which saves ~270KB
        // per tile vs the desktop full image. Desktop keeps full res
        // since these are 80vh hero tiles.
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
            {/* Bottom-fade for headline legibility */}
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/55 to-transparent" />
            {/* Side-vignette pulls focus to center */}
            <div className="absolute inset-0 bg-gradient-to-r from-background/60 via-transparent to-background/30" />
            {/* Subtle color cast over photo (luxury-spec treatment) */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_30%,_rgba(0,0,0,0.35)_100%)]" />
          </div>
          <div className="relative container pb-20">
            <FadeIn>
              {/* Section label — small caps, gold, sets the architecture */}
              <p className="text-[11px] uppercase tracking-[0.22em] font-bold text-[#FDB913] mb-3 drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
                The Service
              </p>
              <h2 className="font-heading text-4xl lg:text-6xl font-bold text-foreground tracking-tight uppercase drop-shadow-[0_4px_16px_rgba(0,0,0,0.7)]">
                {s.title}
              </h2>
              <p className="mt-2 text-[#FDB913] font-semibold text-lg drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">{s.price}</p>
              <p className="mt-3 text-lg text-foreground/75 max-w-md font-light drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">
                {s.desc}
              </p>
              <div className="mt-6 flex gap-3">
                {/* Descriptive link text — Lighthouse a11y/SEO audit flagged
                    the previous "Learn More" as non-descriptive (same text
                    on 3 different service cards, screen readers reading
                    out-of-context couldn't tell them apart). Including the
                    service name fixes both. */}
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

// ─── WHY US — Split layout ───────────────────────────────
function WhyUs() {
  return (
    <section className="bg-[oklch(0.065_0.004_260)] py-24 lg:py-32">
      <div className="container">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <FadeIn>
            <div className="relative rounded-2xl overflow-hidden aspect-[4/3]">
              {/* wave-172: srcset for the "Why Us" photo. Aspect-[4/3]
                  at lg breakpoint is ~480×360 — small variant covers 2x retina.
                  Saves ~354KB per Home load on mobile. */}
              <picture>
                <source media="(max-width: 768px)" srcSet="/photos/busy-shop-action-mechanics-small.webp" />
                <source media="(max-width: 1024px)" srcSet="/photos/busy-shop-action-mechanics-medium.webp" />
                <img src={MECHANIC_IMG} alt="Inside the bay at Nick's Tire & Auto Cleveland — a vehicle on the lift mid-job, real tools, real shop" className="w-full h-full object-cover" loading="lazy" decoding="async" width="1600" height="900" style={{ objectPosition: "center 50%" }} />
              </picture>
            </div>
          </FadeIn>

          <FadeIn delay={0.15}>
            <div>
              <h2 className="font-heading text-4xl lg:text-5xl font-bold text-foreground tracking-tight leading-[1.1] uppercase">
                You see the problem.
                <br />
                <span className="text-primary">Then we fix it.</span>
              </h2>
              <p className="mt-6 text-foreground/50 text-lg leading-relaxed">
                Most Cleveland auto shops hand you a bill and hope you don't ask questions. We hand you a flashlight and walk you under your own car. The worn parts don't lie. Neither do we. On Euclid Ave since 2018, 4.9★ from 1,700+ reviews, and a coffee maker older than half our customers.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('whyus-cta')} className="inline-flex items-center gap-2 bg-foreground text-background px-6 py-3 rounded-full font-medium text-sm hover:bg-foreground/90 transition-colors">
                  Call for Your Free Check
                </a>
                <Link href="/financing" className="inline-flex items-center gap-2 border border-foreground/30 text-foreground px-6 py-3 rounded-full font-medium text-sm hover:bg-foreground/5 transition-colors">
                  See Payment Programs
                </Link>
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

// ─── REVIEWS — Minimal cards ─────────────────────────────
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
            {/* wave-147 — was text-foreground/40 (~2.5:1 contrast) and
                text-foreground/30 (~2:1) on the dark background — both
                fail WCAG 1.4.3 (4.5:1 minimum for normal text). Floored
                at /60 (≈5:1) and /50 (≈4.5:1) for the disclaimer. */}
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

// ─── CONTACT — Clean split ───────────────────────────────
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
            <FinancingCTA variant="banner" className="mt-6" />
          </FadeIn>
        </div>

        {/* Map */}
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

// ─── WEATHER BANNER — dynamic top-of-page CTA driven by useWeatherCTA ────
//
// Renders only when weather genuinely matters (snow / heat / rain / surge).
// On calm days the hook returns null and this section disappears entirely
// — no manufactured urgency on a 70°F day.
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

// ─── TRIAGE GRID — Cialdini-architected service entry points ──
//
// Replaces the generic "service tiles" pattern with a triage decision:
// each card asks the visitor "do you have THIS symptom?" → quantifies
// the consequence → offers the immediate-relief CTA.
//
// Per the conversion-overhaul spec, ICON → SYMPTOM → CONSEQUENCE → CTA.
// Tone gradient: danger (red) for urgent / warning (amber) / info (yellow).
function TriageGrid() {
  return (
    <section className="bg-[oklch(0.055_0.004_260)] py-20 lg:py-32 border-t border-border/30">
      <div className="container">
        <FadeIn>
          <div className="text-center mb-10">
            <div className="text-[#FDB913] text-[10px] font-mono uppercase tracking-widest mb-2">
              What's your car telling you?
            </div>
            <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-black text-foreground uppercase tracking-tight">
              Pick your symptom — we'll fix it today.
            </h2>
            <p className="mt-3 text-foreground/50 text-sm sm:text-base max-w-2xl mx-auto">
              Honest answer before any work. Free check in under an hour. Most fixes done today — first-come, first-served. Payment programs approved on the spot — drive away today, sleep tonight.
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
            consequence="A $200 oxygen sensor untreated typically becomes a $4,000 catalytic converter in 30 days. Damage compounds every mile."
            relief="Free 5-minute code scan. If we need to dig deeper, we tell you the cost before we touch anything."
            ctaLabel="DIAGNOSE NOW"
            ctaHref="/diagnostics"
          />
          <ServiceTriageCard
            tone="info"
            icon={<Wrench className="w-5 h-5" />}
            symptom="Tires bald, low, or vibrating?"
            consequence="Stopping distance doubles in rain. Cleveland potholes shred unmatched treads in weeks."
            relief="New & used tires installed with free mount, balance, and alignment check. Walk in or call for a live quote on your size."
            ctaLabel="GET TIRES TODAY"
            ctaHref="/tires"
          />
          <ServiceTriageCard
            tone="warning"
            icon={<Zap className="w-5 h-5" />}
            symptom="AC weak or not cold?"
            consequence="Once it stops working, repairs typically run $400-$1,500 industry-wide. Catching it early often means a simple recharge."
            relief="Free AC check. Written quote — you don't pay until you say yes."
            ctaLabel="FIX AC NOW"
            ctaHref="/ac-repair"
          />
          <ServiceTriageCard
            tone="warning"
            icon={<Clock className="w-5 h-5" />}
            symptom="Failed Ohio E-Check?"
            consequence="30-day deadline. Day 31 = parking tickets, impound risk, criminal charges for expired registration."
            relief="State-certified emissions repair. Pull up today — we'll get you legal."
            ctaLabel="GET LEGAL"
            ctaHref="/emissions"
          />
          <ServiceTriageCard
            tone="info"
            icon={<Wrench className="w-5 h-5" />}
            symptom="Just need the basics?"
            consequence="Routine oil + filter prevents engine sludge that destroys engines after 60K miles."
            relief="Free 27-point check on every oil change. Walk-ins welcome 7 days."
            ctaLabel="SCHEDULE DROP-OFF"
            ctaHref="/oil-change"
          />
        </div>
      </div>
    </section>
  );
}

// ─── PRICE COMPARE — Anchor & adjustment table ──────────────
//
// Three-row anchor table ("Dealer / Chain / Nick's") for the three highest-
// volume services. Anchor + adjustment is one of the most reliable CRO
// patterns — first number you see sets your reference frame, ours feels
// like rescue.
function PriceCompareSection() {
  return (
    <section className="bg-background py-16 border-t border-border/30">
      <div className="container">
        <FadeIn>
          <div className="text-center mb-10 max-w-2xl mx-auto">
            <div className="text-[#FDB913] text-[10px] font-mono uppercase tracking-widest mb-2">
              The honest math
            </div>
            <h2 className="font-heading text-3xl sm:text-4xl font-black text-foreground uppercase tracking-tight">
              Same job. A fraction of the price.
            </h2>
            <p className="mt-3 text-foreground/50 text-sm sm:text-base">
              Cleveland-area dealer & national-chain quotes vs. ours — on the three services we do most. Same parts, same warranty, a fraction of the price.
            </p>
          </div>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <FadeIn delay={0.05}>
            <AnchorAdjustmentTable
              serviceName="Brake repair, per axle"
              rows={[
                { label: "Cleveland-area dealer", price: "$800" },
                { label: "National chain shop", price: "$600" },
                { label: "Nick's", price: "Free estimate", ours: true },
              ]}
              source="Avg quote, Cleveland metro 2026. Your exact number comes from a free written estimate after we look at the car."
            />
          </FadeIn>
          <FadeIn delay={0.1}>
            <AnchorAdjustmentTable
              serviceName="Synthetic oil change"
              rows={[
                { label: "Dealer", price: "$110" },
                { label: "Chain shop", price: "$89" },
                { label: "Nick's", price: "Free quote", ours: true },
              ]}
              source="Free 27-point inspection included on every oil change. Call or walk in for your live quote."
            />
          </FadeIn>
          <FadeIn delay={0.15}>
            <AnchorAdjustmentTable
              serviceName="OBD-II diagnostic"
              rows={[
                { label: "Dealer", price: "$185" },
                { label: "Chain shop", price: "$120" },
                { label: "Nick's", price: "Free*", ours: true },
              ]}
              source="*Free 5-min scan. Anything beyond that gets a written estimate before we start, credited toward repair if you have us fix it."
            />
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

// ─── SAFETY FACTS — Fear-calibration block ──────────────────
//
// Three big numbers + grim consequences that make abstract risk visceral.
// These are the kind of stats that turn a "maybe later" into "right now."
function SafetyFactsSection() {
  return (
    <section className="bg-[oklch(0.055_0.004_260)] py-12 border-t border-b border-border/30">
      <div className="container">
        <FearCalibrationBlock
          heading="What waiting actually costs"
          stats={[
            {
              value: "287",
              unit: "feet",
              consequence:
                "Added stopping distance at 60 mph with worn brake pads. That's two football fields into an intersection.",
              source: "NHTSA stopping-distance benchmarks.",
            },
            {
              value: "$3,800",
              consequence:
                "Average compounded cost when a $89 fix gets postponed for 90+ days. Sensors fail, parts seize, labor multiplies.",
            },
            {
              value: "30",
              unit: "days",
              consequence:
                "Ohio E-Check deadline. Day 31: parking tickets, impound risk, expired registration. Drive at your own risk.",
            },
          ]}
        />
      </div>
    </section>
  );
}

// ─── LOSS OPPORTUNITY — financing-led urgency ──────────────
//
// Two LossAversionStat cards framed as "ongoing daily loss" — leads
// directly into the financing CTA.
function LossOpportunitySection() {
  return (
    <section className="bg-background py-20 lg:py-28 border-t border-border/30">
      <div className="container">
        <FadeIn>
          <div className="text-center mb-10 max-w-2xl mx-auto">
            <div className="text-red-400 text-[10px] font-mono uppercase tracking-widest mb-2">
              The cost of waiting
            </div>
            <h2 className="font-heading text-3xl sm:text-4xl font-black text-foreground uppercase tracking-tight">
              Every day your car gets sicker.
            </h2>
            <p className="mt-3 text-foreground/50 text-sm sm:text-base">
              Don't have the cash today? Payment programs approved on the spot — four providers compete for your business, no hard credit pull, drive away protected. The longer you wait, the louder your car gets.
            </p>
          </div>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <LossAversionStat
            amount={8.5}
            unit="per day"
            label="lost in preventable damage"
            reason="Worn brake pads eat rotors faster every mile. The longer you wait, the bigger the bill."
            ctaHref="/brakes"
            ctaLabel="STOP THE DAMAGE"
          />
          <LossAversionStat
            amount={47}
            unit="per day"
            label="of compounding engine damage"
            reason="Ignored check-engine light = $1,400 in additional repairs after 30 days, on average."
            ctaHref="/diagnostics"
            ctaLabel="DIAGNOSE NOW"
          />
        </div>

        <FadeIn delay={0.2}>
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
            <div className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 mb-2">
              Can't afford NOT to fix it
            </div>
            <h3 className="font-bold text-2xl text-foreground mb-3">
              Approved on the spot · four payment programs compete for you
            </h3>
            <p className="text-sm text-foreground/60 max-w-xl mx-auto mb-5">
              Acima · Snap · Koalafi · American First. No hard credit pull. Most customers approved before they finish their coffee. Drive away today, pay over time.
            </p>
            <Link
              href="/financing"
              className="inline-flex items-center gap-2 rounded-full bg-emerald-500 text-emerald-950 px-6 py-3 text-sm font-bold tracking-wide hover:bg-emerald-400 transition-colors"
            >
              SEE PAYMENT PROGRAMS
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

// ─── PAGE ────────────────────────────────────────────────
export default function Home() {
  // wave-172b: single useQuery at the page root. Hero, TrustNumbers,
  // and Reviews receive the unified shape via props — one re-render
  // when the data arrives instead of three independent subscriptions
  // drifting on different stale-time clocks.
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
      {/* 2026-05-06 wave 2 · cannibalization fix.
          GSC showed 13 pages competing for "nicks tires" — only / converts
          (6 of 65 sitewide clicks). Root cause: previous home title didn't
          contain "Nick's", so Google couldn't anchor / as the canonical
          answer for the brand query. /services and /tires were ranking
          higher because they DID say "Nick's" in their title suffix.
          Fix: lead with brand. "Nick's Tire & Auto Cleveland" makes / the
          unambiguous answer for "nicks tires" / "nick's tire" searches.
          Still applies operator 4 (anti-pattern: open Sunday) + 1 (specific
          install package). */}
      {/* 2026-05-06 audit fix · meta leads with FCFS positioning + $60
          anchor + master tagline phrasing in description. Brand still
          in title for "nicks tires" branded query. */}
      {/* wave-174 — GSC showed homepage at pos 10.7 with 1.37% CTR over
          3,514 impressions. Description was 178 chars → SERP truncated at
          ~160, cutting off the phone number. Trimmed to 156 chars so the
          phone CTA survives + "$25 used tires" hooks earlier. */}
      <SEOHead
        title="Nick's Tire & Auto Cleveland · Tires & Auto Repair Euclid"
        description="Nick's Tire & Auto on Euclid Ave. Tires from $25, brake repair, auto service. Walk in 7 days. Free check, written quote, pay only when satisfied. (216) 862-0005"
        canonicalPath="/"
      />
      <LocalBusinessSchema includeHowTo includeReviews includeServices />
      {/* 2026-05-06 cannibalization deep fix · explicit WebSite schema
          on the home page only. Tells Google's knowledge graph that /
          is the canonical entry point for the brand entity, regardless
          of which other internal page also mentions "Nick's Tire". */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "Nick's Tire & Auto",
            alternateName: ["Nicks Tire", "Nick's Tire", "Nicks Tires", "Nicks Tire and Auto"],
            url: "https://nickstire.org/",
            potentialAction: {
              "@type": "SearchAction",
              target: {
                "@type": "EntryPoint",
                urlTemplate: "https://nickstire.org/search?q={search_term_string}",
              },
              "query-input": "required name=search_term_string",
            },
          }),
        }}
      />
      {/* Homepage-only Service schema (Premium Tire Installation Package).
          Was previously hardcoded in client/index.html which caused every
          page to inherit this tire-specific schema. Now scoped to the
          homepage only — service-specific pages emit their own via
          FocusedServicePage. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Service",
            name: "Tire Install Package (Free with Every Set)",
            description:
              "Free with every tire purchase. Includes professional mounting, computer balancing, new valve stems, TPMS reset, alignment check, 20-point safety inspection, rim cleaning, and tire disposal. $289+ value.",
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
              description: "Free with tire purchase — value $289+",
            },
          }),
        }}
      />
      {/* Weather-driven banner — only renders when conditions warrant
          (snow / heat / rain / surge demand). Per the conversion spec:
          no manufactured urgency on a calm 70°F day. */}
      <WeatherBanner />
      <Hero reviewData={reviewData} />
      {/* CONES BLOCK — 2026-05-06 audit fix · per HOMEPAGE_MOCKUP spec.
          The single most defensible visual differentiator the site can
          ship: explains the FCFS tire-line ritual + drop-off model in
          one section. Lands directly under hero so customers see it
          before scrolling further. */}
      <RiseInView className="parallax-rise"><ConesBlock /></RiseInView>
      {/* ── LIVE STATUS STRIP — Pillar 3 (Happy Wait) ────────── */}
      <section className="bg-[oklch(0.055_0.004_260)] py-6 border-t border-b border-border/30">
        <div className="container flex items-center justify-center">
          <ShopStatusWidget compact />
        </div>
      </section>
      <TrustStrip />
      <RiseInView className="parallax-rise"><UsedTiresCallout /></RiseInView>
      <RiseInView className="parallax-rise"><TrustNumbers reviewData={reviewData} /></RiseInView>
      {/* CONVERSION ARCHITECTURE (v1.1 spec) — TriageGrid replaces the
          generic service-tile decision flow with a Cialdini-architected
          "pick your symptom" pattern. PriceCompare anchors against
          dealer/chain quotes. SafetyFacts makes risk visceral.
          Each major section gets a RiseInView fade-and-rise + the
          .parallax-rise CSS utility for scroll-driven drift on modern
          browsers (graceful no-op everywhere else). */}
      <RiseInView className="parallax-rise"><TriageGrid /></RiseInView>
      <RiseInView className="parallax-rise"><PriceCompareSection /></RiseInView>
      <RiseInView className="parallax-rise"><SafetyFactsSection /></RiseInView>
      <RiseInView className="parallax-rise"><Services /></RiseInView>
      <RiseInView className="parallax-rise"><WhyUs /></RiseInView>
      <RiseInView className="parallax-rise"><LossOpportunitySection /></RiseInView>
      <RiseInView className="parallax-rise"><Reviews reviewData={reviewData} /></RiseInView>
      <RiseInView className="parallax-rise"><ComparisonTable /></RiseInView>
      {/* ── DROP-OFF + UBER-OUT — Pillar 4, the killer flywheel ──────────── */}
      <section className="bg-[oklch(0.055_0.004_260)] py-14 border-t border-border/30 halftone-light">
        <div className="container">
          <div className="max-w-2xl mx-auto text-center mb-8">
            <div className="text-[#FDB913] text-[10px] font-mono uppercase tracking-widest mb-2">
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
        </div>
      </section>
      <Contact />

      {/* wave-150 — lightweight internal-link block restored after the
          wave-4ab4c7 CRO sweep removed the full InternalLinks component
          from Home. Home is the highest-PageRank page; it should still
          distribute equity to top city + service surfaces. This is a
          flat list, not the full nav-style block — no scroll bloat. */}
      <section className="bg-background border-t border-border/20 py-10">
        <div className="container max-w-5xl mx-auto px-4">
          <h2 className="text-xs uppercase tracking-[0.18em] text-foreground/50 font-medium mb-4">
            Browse by service or neighborhood
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2 text-sm">
            {/* wave-178: fixed broken /brake-repair → /brakes (was a dead
                outbound link from the homepage — wasting equity to the
                GSC-buried /brakes page). Also enriched the /diagnostics
                anchor text from "Diagnostics" → "Check Engine Light
                Diagnostics" so the highest-PageRank inbound link to
                /diagnostics carries keyword weight. */}
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
