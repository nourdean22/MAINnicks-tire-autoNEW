/**
 * IntersectionPage — Hyper-local SEO pages for /near/:slug routes.
 * Targets "auto repair near [intersection]" queries.
 * 152 unique pages covering Northeast Ohio intersections.
 */

import PageLayout from "@/components/PageLayout";
import { useEffect } from "react";
import { useRoute, Link } from "wouter";
import { INTERSECTIONS, type IntersectionData } from "@shared/intersections";
import { SERVICES } from "@shared/services";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import BookingForm from "@/components/BookingForm";
import { Phone, MapPin, Clock, Navigation, ArrowLeft, ChevronRight, Landmark } from "lucide-react";
import { BUSINESS } from "@shared/business";
import InternalLinks from "@/components/InternalLinks";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FadeIn from "@/components/FadeIn";

// ─── SEO HELPERS ─────────────────────────────────────────
const MAX_TITLE_LEN = 60;
const TITLE_SUFFIX = " | Nick's Tire & Auto";

/** Abbreviate common road words to fit title under 60 chars */
function abbreviateName(name: string): string {
  return name
    .replace(/\bBoulevard\b/gi, "Blvd")
    .replace(/\bStreet\b/gi, "St")
    .replace(/\bAvenue\b/gi, "Ave")
    .replace(/\bRoad\b/gi, "Rd")
    .replace(/\bDrive\b/gi, "Dr")
    .replace(/\bPlace\b/gi, "Pl")
    .replace(/\bHighway\b/gi, "Hwy")
    .replace(/\bParkway\b/gi, "Pkwy")
    .replace(/\bNorth\b/gi, "N")
    .replace(/\bSouth\b/gi, "S")
    .replace(/\bEast\b/gi, "E")
    .replace(/\bWest\b/gi, "W");
}

function buildTitle(intersection: IntersectionData): string {
  const driveTag = `${intersection.driveMinutes} Min`;
  const fullName = intersection.name;
  // Try full name first
  const full = `Auto Repair Near ${fullName} | ${driveTag}${TITLE_SUFFIX}`;
  if (full.length <= MAX_TITLE_LEN) return full;
  // Try abbreviated name
  const abbr = abbreviateName(fullName);
  const shortened = `Auto Repair Near ${abbr} | ${driveTag}${TITLE_SUFFIX}`;
  if (shortened.length <= MAX_TITLE_LEN) return shortened;
  // Drop drive tag as last resort
  const minimal = `Auto Repair Near ${abbr}${TITLE_SUFFIX}`;
  return minimal.slice(0, MAX_TITLE_LEN);
}

function buildDescription(intersection: IntersectionData): string {
  return `Need auto repair near ${intersection.name}? Nick's Tire & Auto is just ${intersection.driveMinutes} min away. Walk-ins welcome 7 days. ${BUSINESS.reviews.rating}\u2605 Google rating. ${BUSINESS.phone.display}`;
}

// ─── RELATED INTERSECTIONS ───────────────────────────────
function getRelated(current: IntersectionData): IntersectionData[] {
  return INTERSECTIONS
    .filter(i => i.slug !== current.slug && i.neighborhood === current.neighborhood)
    .sort((a, b) => a.driveMinutes - b.driveMinutes)
    .slice(0, 6);
}

// ─── MAIN PAGE ───────────────────────────────────────────
export default function IntersectionPage() {
  const [, params] = useRoute("/near/:slug");
  const slug = params?.slug || "";
  const intersection = INTERSECTIONS.find(i => i.slug === slug);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  if (!intersection) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="font-semibold font-bold text-4xl text-foreground mb-4">PAGE NOT FOUND</h1>
          <p className="text-foreground/60 mb-8">This intersection page does not exist.</p>
          <Link href="/" className="inline-flex items-center gap-2 stagger-in bg-primary text-primary-foreground btn-premium px-8 py-4 rounded-md font-semibold font-bold text-sm tracking-wide">
            <ArrowLeft className="w-4 h-4" />
            BACK TO HOME
          </Link>
        </div>
      </div>
    );
  }

  const related = getRelated(intersection);
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${BUSINESS.geo.lat},${BUSINESS.geo.lng}&origin=${intersection.lat},${intersection.lng}`;
  const topServices = SERVICES.slice(0, 6);
  const moreServices = SERVICES.slice(6);

  return (
    <PageLayout showChat={true}>
      <SEOHead
        title={buildTitle(intersection)}
        description={buildDescription(intersection)}
        canonicalPath={`/near/${intersection.slug}`}
      />
      <LocalBusinessSchema
        pageName={`Nick's Tire & Auto — Near ${intersection.name}`}
        additionalSchema={{
          url: `https://nickstire.org/near/${intersection.slug}`,
          areaServed: {
            "@type": "Place",
            name: intersection.neighborhood || "Cleveland",
            geo: {
              "@type": "GeoCoordinates",
              latitude: intersection.lat,
              longitude: intersection.lng,
            },
          },
          hasMap: `https://www.google.com/maps/dir/?api=1&destination=${BUSINESS.geo.lat},${BUSINESS.geo.lng}&origin=${intersection.lat},${intersection.lng}`,
        }}
      />

      {/* ─── HERO ─── */}
      <section className="bg-[oklch(0.055_0.004_260)] pt-24 pb-16 lg:pt-32 lg:pb-20">
        <div className="container">
          <FadeIn>
            <Breadcrumbs items={[
              { label: "Areas Served", href: "/areas-served" },
              { label: intersection.neighborhood || "Cleveland", href: intersection.neighborhood ? undefined : "/cleveland-auto-repair" },
              { label: intersection.name },
            ]} />
          </FadeIn>

          <FadeIn delay={0.1}>
            <h1 className="font-semibold font-bold text-3xl sm:text-4xl lg:text-5xl text-foreground leading-tight tracking-tight mt-6 max-w-3xl">
              AUTO REPAIR NEAR{" "}
              <span className="text-primary">{intersection.name.toUpperCase()}</span>
            </h1>
          </FadeIn>

          <FadeIn delay={0.15}>
            <div className="mt-6 flex flex-wrap gap-4 stagger-in text-sm text-foreground/60">
              <div className="flex items-center gap-2 stagger-in">
                <Clock className="w-4 h-4 text-nick-blue-light" />
                <span className="font-mono">{intersection.driveMinutes} min drive to shop</span>
              </div>
              {intersection.neighborhood && (
                <div className="flex items-center gap-2 stagger-in">
                  <MapPin className="w-4 h-4 text-primary" />
                  <span className="font-mono">{intersection.neighborhood}, OH {intersection.zip}</span>
                </div>
              )}
              {intersection.landmark && (
                <div className="flex items-center gap-2 stagger-in">
                  <Landmark className="w-4 h-4 text-nick-blue-light" />
                  <span className="font-mono">{intersection.landmark}</span>
                </div>
              )}
            </div>
          </FadeIn>

          <FadeIn delay={0.2}>
            <div className="mt-8 flex flex-col sm:flex-row gap-4 stagger-in">
              <a
                href={BUSINESS.phone.href}
                onClick={() => trackPhoneClick("intersection-hero-cta")}
                className="inline-flex items-center justify-center gap-2 stagger-in bg-primary text-primary-foreground btn-premium px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wide hover:opacity-90 transition-colors"
                aria-label="Call Nick's Tire and Auto"
              >
                <Phone className="w-5 h-5" />
                CALL {BUSINESS.phone.display}
              </a>
              <a
                href={directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 stagger-in border-2 border-nick-blue/50 text-nick-blue-light px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wide hover:bg-nick-blue/10 hover:border-nick-blue transition-colors"
              >
                <Navigation className="w-5 h-5" />
                GET DIRECTIONS
              </a>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ─── LOCAL CONTENT ─── */}
      <section className="py-16 lg:py-24 bg-[oklch(0.065_0.004_260)]">
        <div className="container">
          <div className="max-w-3xl">
            <FadeIn>
              <span className="font-mono text-nick-blue-light text-sm tracking-wide">
                {intersection.driveMinutes} Minutes From Our Shop
              </span>
              <h2 className="font-semibold font-bold text-2xl lg:text-4xl text-foreground mt-3 tracking-tight leading-tight">
                WHY DRIVERS NEAR {intersection.name.toUpperCase()}{" "}
                <span className="text-primary">CHOOSE NICK'S</span>
              </h2>
              <p className="mt-6 text-foreground/70 leading-relaxed text-lg">
                {intersection.localContent}
              </p>
            </FadeIn>

            <FadeIn delay={0.1}>
              <div className="mt-8 bg-card/50 border border-border/50 rounded-lg p-6">
                <div className="flex items-center gap-3 stagger-in mb-4">
                  <MapPin className="w-5 h-5 text-primary" />
                  <span className="font-semibold font-bold text-foreground">OUR SHOP</span>
                </div>
                <p className="text-foreground/70 text-sm">{BUSINESS.address.full}</p>
                <p className="text-foreground/50 text-sm mt-1">{BUSINESS.hours.fullDisplay}</p>
                <a
                  href={directionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 stagger-in mt-4 text-sm text-nick-blue-light hover:text-primary transition-colors font-semibold"
                >
                  <Navigation className="w-4 h-4" />
                  Open in Google Maps ({intersection.driveMinutes} min from {intersection.name})
                </a>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ─── WHY NICK'S ─── */}
      <section className="py-16 lg:py-24 bg-[oklch(0.055_0.004_260)]">
        <div className="container max-w-4xl">
          <FadeIn>
            <span className="font-mono text-nick-blue-light text-sm tracking-wide">The Nick's Difference</span>
            <h2 className="font-semibold font-bold text-2xl lg:text-4xl text-foreground mt-3 tracking-tight">
              WHAT TO EXPECT AT OUR SHOP
            </h2>
            <p className="mt-6 text-foreground/70 leading-relaxed text-lg">
              Nick's Tire & Auto is a {BUSINESS.reviews.rating}-star shop with {BUSINESS.reviews.countDisplay} Google reviews — and there's a reason {intersection.neighborhood || "Cleveland"} drivers keep coming back. We're located at {BUSINESS.address.full}, just {intersection.driveMinutes} minutes from {intersection.name}.
            </p>
          </FadeIn>
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4 stagger-in">
            <FadeIn delay={0.05}>
              <div className="bg-card/30 border border-border/50 rounded-lg p-5">
                <h3 className="font-semibold font-bold text-foreground text-sm mb-2">WALK-INS WELCOME</h3>
                <p className="text-foreground/60 text-sm leading-relaxed">No appointment needed for most services. We operate first-come, first-served — drive in and we'll take care of you. Open {BUSINESS.hours.display} and Sundays 9 AM to 4 PM.</p>
              </div>
            </FadeIn>
            <FadeIn delay={0.1}>
              <div className="bg-card/30 border border-border/50 rounded-lg p-5">
                <h3 className="font-semibold font-bold text-foreground text-sm mb-2">HONEST QUOTES UPFRONT</h3>
                <p className="text-foreground/60 text-sm leading-relaxed">We tell you what's wrong, what it costs, and let you decide. No upsells, no pressure. If something changes mid-repair, we call you before doing any additional work.</p>
              </div>
            </FadeIn>
            <FadeIn delay={0.15}>
              <div className="bg-card/30 border border-border/50 rounded-lg p-5">
                <h3 className="font-semibold font-bold text-foreground text-sm mb-2">FINANCING FROM $10 DOWN</h3>
                <p className="text-foreground/60 text-sm leading-relaxed">Can't pay in full today? <Link href="/financing" className="text-nick-blue-light hover:underline">We offer financing starting at $10 down</Link> on tires and major repairs. Get the fix now, pay over time.</p>
              </div>
            </FadeIn>
            <FadeIn delay={0.2}>
              <div className="bg-card/30 border border-border/50 rounded-lg p-5">
                <h3 className="font-semibold font-bold text-foreground text-sm mb-2">FULL-SERVICE SHOP</h3>
                <p className="text-foreground/60 text-sm leading-relaxed">From <Link href="/tires" className="text-nick-blue-light hover:underline">tires</Link> and <Link href="/brakes" className="text-nick-blue-light hover:underline">brakes</Link> to <Link href="/check-engine-light-cleveland" className="text-nick-blue-light hover:underline">check engine lights</Link> and <Link href="/emissions" className="text-nick-blue-light hover:underline">emissions testing</Link>, we handle it all under one roof. Most repairs are completed same-day.</p>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ─── SERVICES ─── */}
      <section className="py-16 lg:py-24 bg-[oklch(0.065_0.004_260)]">
        <div className="container">
          <FadeIn>
            <span className="font-mono text-nick-blue-light text-sm tracking-wide">Our Services</span>
            <h2 className="font-semibold font-bold text-2xl lg:text-4xl text-foreground mt-3 tracking-tight">
              WHAT WE FIX
            </h2>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="mt-10 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 stagger-in">
              {topServices.map((s) => (
                <Link
                  key={s.slug}
                  href={`/${s.slug}`}
                  className="bg-card/80 border border-border/50 rounded-lg p-4 text-center hover:border-primary/30 hover:bg-card transition-colors group"
                >
                  <span className="font-semibold font-bold text-sm text-foreground/80 group-hover:text-primary transition-colors tracking-wider">
                    {s.title}
                  </span>
                </Link>
              ))}
            </div>
          </FadeIn>

          <FadeIn delay={0.2}>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 stagger-in">
              {moreServices.map((s) => (
                <Link
                  key={s.slug}
                  href={`/${s.slug}`}
                  className="bg-card/80 border border-border/50 rounded-lg p-4 text-center hover:border-primary/30 hover:bg-card transition-colors group"
                >
                  <span className="font-semibold text-xs text-foreground/60 group-hover:text-primary transition-colors tracking-wider">
                    {s.title}
                  </span>
                </Link>
              ))}
              <Link
                href="/alignment"
                className="bg-card/80 border border-border/50 rounded-lg p-4 text-center hover:border-primary/30 hover:bg-card transition-colors group"
              >
                <span className="font-semibold text-xs text-foreground/60 group-hover:text-primary transition-colors tracking-wider">
                  ALIGNMENT
                </span>
              </Link>
            </div>
          </FadeIn>

          <div className="mt-8 flex flex-wrap justify-center gap-4 stagger-in text-sm text-foreground/50">
            <Link href="/financing" className="text-emerald-400 hover:underline">Financing from $10 down</Link>
            <span className="text-foreground/20">|</span>
            <Link href="/booking" className="hover:text-primary transition-colors">Book online</Link>
            <span className="text-foreground/20">|</span>
            <Link href="/diagnose" className="hover:text-primary transition-colors">Diagnose my car</Link>
            <span className="text-foreground/20">|</span>
            <Link href="/reviews" className="hover:text-primary transition-colors">Read reviews</Link>
          </div>
        </div>
      </section>

      {/* ─── BOOKING ─── */}
      <section id="booking" className="py-16 lg:py-24 bg-[oklch(0.065_0.004_260)]">
        <div className="container max-w-3xl">
          <FadeIn>
            <div className="text-center mb-10">
              <span className="font-mono text-nick-blue-light text-sm tracking-wide">Schedule Service</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight">
                BOOK YOUR APPOINTMENT
              </h2>
              <p className="mt-4 text-foreground/60 max-w-lg mx-auto">
                Near {intersection.name}? Schedule your service online or call us at {BUSINESS.phone.display}.
              </p>
            </div>
          </FadeIn>
          <FadeIn delay={0.1}>
            <BookingForm />
          </FadeIn>
        </div>
      </section>

      {/* ─── RELATED INTERSECTIONS ─── */}
      {related.length > 0 && (
        <section className="py-12 lg:py-16 bg-[oklch(0.055_0.004_260)] border-t border-border/50">
          <div className="container">
            <FadeIn>
              <h3 className="font-semibold font-bold text-lg text-foreground/60 tracking-[-0.01em] mb-6">
                NEARBY IN {(intersection.neighborhood || "CLEVELAND").toUpperCase()}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 stagger-in">
                {related.map((r) => (
                  <Link
                    key={r.slug}
                    href={`/near/${r.slug}`}
                    className="group flex items-center justify-between p-4 bg-card/50 border border-border/50 rounded-md hover:border-primary/30 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-foreground group-hover:text-primary transition-colors truncate">
                        {r.name}
                      </p>
                      <p className="text-xs text-foreground/40 mt-0.5">{r.driveMinutes} min drive</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-foreground/20 group-hover:text-primary shrink-0 ml-3 transition-colors" />
                  </Link>
                ))}
              </div>
            </FadeIn>
          </div>
        </section>
      )}

      <InternalLinks />
    </PageLayout>
  );
}
