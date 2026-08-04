/**
 * TireBrandPage — single template for all /[brand]-tires-cleveland silos.
 *
 * Reads the brand from the route param `:slug` and looks up the data
 * in shared/tireBrands.ts. One template, N landing pages — same
 * pattern as CityPage and NeighborhoodPage. Powers:
 *   /michelin-tires-cleveland
 *   /goodyear-tires-cleveland
 *   /bridgestone-tires-cleveland
 *   /firestone-tires-cleveland
 *   /continental-tires-cleveland
 *
 * Each route is registered explicitly in App.tsx so wouter doesn't
 * have to do partial-segment matching (which it doesn't support).
 */

import { Link } from "wouter";
import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import BookingForm from "@/components/BookingForm";
import FadeIn from "@/components/FadeIn";
import InternalLinks from "@/components/InternalLinks";
import { BUSINESS } from "@shared/business";
import { getTireBrand, type TireBrand } from "@shared/tireBrands";
import { Phone, CheckCircle, ShieldCheck, AlertTriangle, ArrowRight } from "lucide-react";

export default function TireBrandPage() {
  // wouter doesn't support partial segment routes (`/:slug-tires-cleveland`
  // is not a valid pattern), so App.tsx registers each brand path
  // explicitly. We read the slug from the URL pathname directly.
  const slug = extractBrandSlug();
  const brand = slug ? getTireBrand(slug) : undefined;

  if (!brand) {
    return (
      <PageLayout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <p className="text-foreground/60">Brand page not found.</p>
        </div>
      </PageLayout>
    );
  }

  return <BrandHero brand={brand} />;
}

// Reads the slug from window.location.pathname when wouter's :slug
// param isn't available (which happens with the explicit-route pattern).
function extractBrandSlug(): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/^\/([a-z]+)-tires-cleveland/);
  return match ? match[1] : null;
}

function BrandHero({ brand }: { brand: TireBrand }) {
  const canonicalPath = `/${brand.slug}-tires-cleveland`;
  const title = `${brand.name} Tires Cleveland | Free $266 Install Package | Nick's`;
  const description = `${brand.name} tires in Cleveland — full lineup stocked or special-ordered in 24 hours. FREE install package on every set: mount, balance, valve stems, TPMS, alignment check. ${BUSINESS.phone.display}`;

  return (
    <PageLayout activeHref="/tires" showChat={true}>
      <SEOHead title={title} description={description} canonicalPath={canonicalPath} />
      <LocalBusinessSchema />

      {/* div, not <main> — PageLayout already provides the single
          main#main-content landmark. */}
      <div>
        {/* HERO */}
        <section className="relative pt-32 lg:pt-40 pb-12 lg:pb-16 bg-[oklch(0.06_0.004_260)]">
          <div className="container">
            <FadeIn>
              <Breadcrumbs items={[{ label: "Tires", href: "/tires" }, { label: `${brand.name} Tires` }]} />
            </FadeIn>
            <FadeIn delay={0.05}>
              <div className="flex items-center gap-4 mt-6 mb-3">
                <img
                  src={brand.logoUrl}
                  alt={`${brand.name} tire logo`}
                  className="h-10 lg:h-12 w-auto"
                  loading="eager"
                  fetchPriority="high"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
                <span className="text-xs font-mono text-primary tracking-[0.2em]">CLEVELAND TIRE INSTALL</span>
              </div>
            </FadeIn>
            <FadeIn delay={0.1}>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-foreground leading-[0.95] max-w-4xl">
                {brand.name.toUpperCase()} TIRES CLEVELAND
              </h1>
            </FadeIn>
            <FadeIn delay={0.15}>
              <p className="mt-5 text-lg sm:text-xl text-foreground/75 max-w-2xl leading-relaxed">
                {brand.tagline} Stocked or special-ordered in 24 hours. Every set installs with our free $266 package
                — mount, balance, valve stems, TPMS reset, alignment check, and 20-point check.
              </p>
            </FadeIn>
            <FadeIn delay={0.2}>
              <div className="mt-7 flex flex-col sm:flex-row gap-3">
                <a
                  href={BUSINESS.phone.href}
                  onClick={() => trackPhoneClick(`brand-page-${brand.slug}`)}
                  className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground btn-premium px-7 py-4 rounded-md font-bold text-lg tracking-wide hover:opacity-90 transition-colors"
                >
                  <Phone className="w-5 h-5" />
                  CALL FOR QUOTE
                </a>
                <a
                  href="#booking"
                  className="inline-flex items-center justify-center gap-2 border-2 border-nick-blue/50 text-nick-blue-light px-7 py-4 rounded-md font-bold text-lg tracking-wide hover:bg-nick-blue/10 hover:border-nick-blue transition-colors"
                >
                  REQUEST APPOINTMENT
                </a>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* WHY THIS BRAND */}
        <section className="bg-[oklch(0.055_0.004_260)] py-16 lg:py-20">
          <div className="container max-w-5xl">
            <FadeIn>
              <p className="text-xs font-mono text-primary tracking-[0.2em] mb-2">WHY {brand.name.toUpperCase()}</p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-6">
                What {brand.name} does well — and what it doesn't.
              </h2>
            </FadeIn>
            <div className="grid gap-6 lg:grid-cols-2">
              <FadeIn delay={0.05}>
                <div className="bg-card/60 border border-border/30 rounded-lg p-6">
                  <h3 className="text-sm font-bold tracking-wide text-emerald-400 mb-3">STRENGTHS</h3>
                  <ul className="space-y-3">
                    {brand.strengths.map((s) => (
                      <li key={s} className="flex gap-3 text-foreground/80">
                        <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-1" />
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </FadeIn>
              <FadeIn delay={0.1}>
                <div className="bg-card/60 border border-amber-500/30 rounded-lg p-6">
                  <h3 className="text-sm font-bold tracking-wide text-amber-400 mb-3">HONEST TRADEOFF</h3>
                  <p className="text-foreground/80 leading-relaxed mb-4 flex gap-3">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-1" />
                    <span>{brand.tradeoff}</span>
                  </p>
                  <h3 className="text-sm font-bold tracking-wide text-foreground/60 mb-2 mt-6">BEST FOR</h3>
                  <p className="text-foreground/70 leading-relaxed">{brand.bestFor}</p>
                </div>
              </FadeIn>
            </div>
          </div>
        </section>

        {/* POPULAR LINES */}
        <section className="bg-[oklch(0.06_0.004_260)] py-16 lg:py-20 border-t border-border/30">
          <div className="container max-w-5xl">
            <FadeIn>
              <p className="text-xs font-mono text-primary tracking-[0.2em] mb-2">MODELS WE INSTALL MOST</p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-6">
                Popular {brand.name} lines — and which driver they fit.
              </h2>
            </FadeIn>
            <div className="grid gap-4 md:grid-cols-2">
              {brand.popularLines.map((line, i) => (
                <FadeIn key={line.model} delay={i * 0.05}>
                  <div className="bg-card/50 border border-border/30 rounded-lg p-5">
                    <h3 className="text-base font-bold text-foreground tracking-tight mb-2">{line.model}</h3>
                    <p className="text-foreground/65 text-sm leading-relaxed">{line.use}</p>
                  </div>
                </FadeIn>
              ))}
            </div>
            <FadeIn>
              <p className="mt-6 text-sm text-foreground/50">
                Don't see your size or model? Most {brand.name} sizes ship in 24 hours from regional warehouse.
                Call <a href={BUSINESS.phone.href} className="text-primary hover:underline">{BUSINESS.phone.display}</a> with
                your tire size and we'll quote it on the phone.
              </p>
            </FadeIn>
          </div>
        </section>

        {/* INSTALL PACKAGE */}
        <section className="bg-[oklch(0.058_0.004_260)] py-16 lg:py-20 border-t border-border/30">
          <div className="container max-w-5xl">
            <FadeIn>
              <p className="text-xs font-mono text-primary tracking-[0.2em] mb-2">FREE WITH EVERY SET</p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-3">
                What chains charge $266 for, included free at Nick's.
              </h2>
              <p className="text-foreground/65 mb-8 max-w-2xl">
                Every set of {brand.name} tires installs with our standard package — no asterisk pricing,
                no nickel-and-dime add-ons at checkout.
              </p>
            </FadeIn>
            <div className="grid gap-3 md:grid-cols-2">
              {[
                "Tire mount on each wheel — calibrated torque, not impact gun",
                "Computerized wheel balance",
                "New valve stems",
                "TPMS sensor reset (where equipped)",
                "Alignment check (full alignment is separate if needed)",
                "20-point safety check — brakes, suspension, fluids, lights",
                "Disposal of old tires",
                "Wheel cleaning before re-mount",
                "12-month parts / 90-day labor warranty",
                "Free flat repair for the life of the tires (in-shop)",
              ].map((item) => (
                <div key={item} className="flex items-start gap-3">
                  <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-1" />
                  <span className="text-foreground/80 text-sm">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* BOOKING */}
        <section id="booking" className="bg-[oklch(0.06_0.004_260)] py-16 lg:py-20 border-t border-border/30">
          <div className="container max-w-3xl">
            <FadeIn>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-3">
                Get a quote on {brand.name} tires
              </h2>
              <p className="text-foreground/65 mb-6">
                Tell us your tire size + vehicle, we'll quote {brand.name} options at every price tier
                and get you scheduled. Walk-ins always welcome.
              </p>
            </FadeIn>
            <BookingForm defaultService="tires" />
          </div>
        </section>

        {/* CROSS-LINK to other brands */}
        <section className="bg-[oklch(0.055_0.004_260)] py-12 border-t border-border/30">
          <div className="container max-w-5xl">
            <h3 className="text-sm font-mono text-foreground/60 tracking-[0.18em] mb-4">OTHER BRANDS WE INSTALL</h3>
            <div className="flex flex-wrap gap-3">
              {["michelin", "goodyear", "bridgestone", "firestone", "continental"]
                .filter((s) => s !== brand.slug)
                .map((s) => (
                  <Link
                    key={s}
                    href={`/${s}-tires-cleveland`}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-card/60 border border-border/30 rounded-md text-foreground/70 hover:text-primary hover:border-primary/40 transition-colors text-sm"
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)} <ArrowRight className="w-3 h-3" />
                  </Link>
                ))}
              <Link
                href="/tires"
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 rounded-md text-primary hover:bg-primary/20 transition-colors text-sm font-medium"
              >
                Browse all sizes <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        </section>

        <InternalLinks title="Related Tire Pages" />
      </div>
    </PageLayout>
  );
}
