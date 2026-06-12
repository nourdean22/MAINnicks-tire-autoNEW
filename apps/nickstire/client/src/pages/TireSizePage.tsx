import PageLayout from "@/components/PageLayout";
import { useParams } from "wouter";
import { Link } from "wouter";
import { Phone, ChevronRight, ShieldCheck, Clock, Package, Search } from "lucide-react";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { getTireSizeBySlug, TIRE_SIZE_PAGES, buildTireSizeMetaDescription } from "@shared/tireSizes";
import { getBuyingGuide } from "@shared/tireSizeContent";
import { BUSINESS } from "@shared/business";
import InternalLinks from "@/components/InternalLinks";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FadeIn from "@/components/FadeIn";
import BookingForm from "@/components/BookingForm";
// attribution-wave: legacy @/lib/analytics import removed — trackPhoneClick
// is now the canonical SEO helper (adds Pixel + call_events DB attribution).

export default function TireSizePage() {
  const { size: paramSlug } = useParams<{ size: string }>();
  const slug = paramSlug || (typeof window !== "undefined" ? window.location.pathname.replace(/^\/tires\//, "").split("/")[0] : "");
  const page = slug ? getTireSizeBySlug(slug) : undefined;

  if (!page) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="font-semibold text-4xl text-foreground mb-4">That size isn't on the wall.</h1>
          <p className="text-foreground/60 mb-6">Doesn't mean we can't get it — call (216) 862-0005 with the size off your sidewall and we'll source it. Or browse what we stock.</p>
          <Link href="/tires" className="text-primary hover:underline">Browse what's in stock</Link>
        </div>
      </div>
    );
  }

  const vehicleList = page.commonVehicles.join(", ");

  const breadcrumbs = [
    { label: "Tires", href: "/tires" },
    { label: `${page.size} Tires` },
  ];

  // Pick related sizes from the same category
  const relatedSizes = TIRE_SIZE_PAGES
    .filter(p => p.slug !== page.slug && p.category === page.category)
    .slice(0, 6);

  // wave-181.x · Tier S · category-specific buying-guide content lifts
  // each size page above the templated-doorway threshold by injecting
  // ~150 words of unique editorial differentiated by category. Sedan
  // pages talk fuel economy + tread life · SUV pages talk all-weather
  // + 3PMSF · Truck pages talk load rating + towing · Performance
  // pages talk speed rating + grip compounds. Drives long-tail SERP
  // visibility on size+intent queries that the templated copy missed.
  const buyingGuide = getBuyingGuide(page.category);

  // FAQ source-of-truth — drives both rendered FAQ section + FAQPage JSON-LD
  const FAQS = [
    {
      q: `How much do ${page.size} tires cost?`,
      a: `Prices vary by brand and type. Used ${page.size} tires start around $25-60 each. New tires range from $89-200+ per tire depending on the brand. All prices include our free install package ($289 value).`,
    },
    {
      q: `Do you have ${page.size} tires in stock?`,
      a: `Yes — ${page.size} is one of our most popular sizes. We typically have multiple options in stock, both new and used. Call us at ${BUSINESS.phone.display} to confirm current availability.`,
    },
    {
      q: `Can I buy just one or two ${page.size} tires?`,
      a: `Absolutely. We sell tires individually, in pairs, or as a full set. For best performance and safety, we recommend replacing at least two tires at a time on the same axle.`,
    },
    {
      q: `Do you have payment programs for ${page.size} tires?`,
      a: `Yes. Payment programs available — $10 down. No credit check required. Get the tires you need today and pay over time.`,
    },
  ];

  return (
    <PageLayout showChat={true}>
      <SEOHead
        title={page.metaTitle}
        description={buildTireSizeMetaDescription(page)}
        canonicalPath={`/tires/${page.slug}`}
      />
      <LocalBusinessSchema pageName={`${page.size} Tires Cleveland - Nick's Tire & Auto`} />
      {/* FAQPage as its own top-level JSON-LD — drives rich results */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": FAQS.map((f) => ({
              "@type": "Question",
              "name": f.q,
              "acceptedAnswer": { "@type": "Answer", "text": f.a },
            })),
          }),
        }}
      />
      {/* wave-178: Service schema scoped to this specific tire size.
          The 30 TireSizePage SKU routes previously emitted only
          LocalBusiness + FAQPage. Adding a per-page Service entity
          tells Google "this URL is the canonical answer for [size]
          tire install" so rich results can fire on size-specific
          queries. Each page gets a unique Service.name / offers
          tied to the size, so Google's entity graph doesn't
          collapse the 30 pages into one. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Service",
            name: `${page.size} Tire Sales & Installation`,
            description: `${page.size} tires in Cleveland — new and used in stock, fits ${vehicleList}. Free install package: mounting, balancing, valve stems, TPMS reset, alignment check, lifetime rotations. Walk in 7 days.`,
            serviceType: "Tire Installation",
            image: "https://nickstire.org/photos/rugged-tire-tread-closeup.webp",
            provider: {
              "@type": "AutoRepair",
              "@id": `${BUSINESS.urls.website}/#localbusiness`,
            },
            areaServed: [
              { "@type": "City", name: "Cleveland" },
              { "@type": "City", name: "Euclid" },
              { "@type": "City", name: "Parma" },
              { "@type": "City", name: "Lakewood" },
              { "@type": "City", name: "Cleveland Heights" },
              { "@type": "City", name: "East Cleveland" },
              { "@type": "City", name: "Lyndhurst" },
              { "@type": "City", name: "Shaker Heights" },
            ],
            offers: {
              "@type": "AggregateOffer",
              priceCurrency: "USD",
              lowPrice: "40",
              highPrice: "200",
              offerCount: "2",
              availability: "https://schema.org/InStock",
              itemOffered: { "@type": "Product", name: `${page.size} Tires` },
            },
          }),
        }}
      />

      {/* Hero */}
      <section className="relative pt-28 pb-16 lg:pt-36 lg:pb-24">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-background/95 to-background" />
        <div className="relative container">
          <Breadcrumbs items={breadcrumbs} />
          <FadeIn>
            <h1 className="font-bold text-5xl sm:text-6xl lg:text-7xl text-foreground leading-[0.9] tracking-tight mt-6">
              <span className="text-primary">{page.size}</span>
              <br />Tires Cleveland
            </h1>
          </FadeIn>
          <FadeIn delay={0.1}>
            <p className="mt-6 text-lg sm:text-xl text-foreground/80 max-w-2xl font-light leading-relaxed">
              New and used {page.size} tires in stock. Fits {vehicleList}. Free install package
              included with every set — mounting, balancing, alignment check, and lifetime rotations.
            </p>
          </FadeIn>
          <FadeIn delay={0.15}>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary text-sm font-medium rounded-sm">
                <Package className="w-4 h-4" />{page.category}
              </span>
              {/* wave-171: price anchor above-the-fold answers "how much" — the
                  dominant search intent for tire-size queries. Previously the
                  only price info was buried in the FAQ ~4 sections below the
                  fold; competitors who show pricing in the hero get the click. */}
              <span className="inline-flex items-center px-3 py-1.5 bg-emerald-500/10 text-emerald-400 text-sm font-semibold rounded-sm">
                Used $25+ · New $89+ · Free install
              </span>
              {page.commonVehicles.map(v => (
                <span key={v} className="inline-flex items-center px-3 py-1.5 bg-foreground/5 text-foreground/70 text-sm rounded-sm">
                  {v}
                </span>
              ))}
            </div>
          </FadeIn>
          <FadeIn delay={0.2}>
            <div className="mt-8 flex flex-col sm:flex-row gap-4">
              <a
                href={BUSINESS.phone.href}
                onClick={() => trackPhoneClick(`tire-size-${page.slug}-hero`)}
                aria-label={`Call Nick's Tire & Auto at ${BUSINESS.phone.display} for ${page.size} tire pricing`}
                className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-bold text-lg tracking-wide hover:bg-primary/90 transition-colors"
              >
                <Phone className="w-5 h-5" aria-hidden="true" />CALL FOR PRICE
              </a>
              <Link
                href={`/tires?size=${encodeURIComponent(page.size)}`}
                className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-bold text-lg tracking-wide hover:border-primary hover:text-primary transition-colors"
              >
                <Search className="w-5 h-5" />SEARCH {page.size} ONLINE
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Value Props */}
      <section className="py-16 bg-card/50 border-y border-border/30">
        <div className="container">
          <FadeIn>
            <div className="grid sm:grid-cols-3 gap-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-primary/10 rounded-sm flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-1">Free Installation Package</h3>
                  <p className="text-sm text-foreground/60">Mount, balance, alignment check, TPMS reset, lifetime rotations. $289+ value included free.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-primary/10 rounded-sm flex items-center justify-center shrink-0">
                  <Clock className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-1">Same-Day Installation</h3>
                  <p className="text-sm text-foreground/60">Most {page.size} tires installed same day. Walk-ins welcome 7 days a week.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-primary/10 rounded-sm flex items-center justify-center shrink-0">
                  <Package className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-1">New & Used Options</h3>
                  <p className="text-sm text-foreground/60">Budget-friendly used tires from $25. Major brands available. Every tire inspected.</p>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* What size means section */}
      <section className="py-16">
        <div className="container max-w-4xl">
          <FadeIn>
            <h2 className="font-semibold text-3xl text-foreground mb-6">What Does {page.size} Mean?</h2>
            <div className="prose prose-invert max-w-none">
              {(() => {
                const match = page.size.match(/^(\d+)\/(\d+)R(\d+)$/);
                if (!match) return null;
                const [, width, aspect, rim] = match;
                return (
                  <div className="space-y-4 text-foreground/80">
                    <p>
                      The tire size <strong className="text-foreground">{page.size}</strong> breaks down into three measurements:
                    </p>
                    <ul className="space-y-2">
                      <li><strong className="text-foreground">{width}</strong> — Width of the tire in millimeters from sidewall to sidewall</li>
                      <li><strong className="text-foreground">{aspect}</strong> — Aspect ratio (sidewall height is {aspect}% of the width)</li>
                      <li><strong className="text-foreground">R{rim}</strong> — Fits a {rim}-inch wheel (R means radial construction)</li>
                    </ul>
                    <p>
                      This size is commonly found on {page.category.toLowerCase() === "truck" ? "trucks" : page.category.toLowerCase() === "sedan" ? "sedans" : page.category.toLowerCase() === "performance" ? "performance vehicles" : "SUVs and crossovers"} including {vehicleList}.
                      At Nick's Tire & Auto, we keep {page.size} tires in stock — both new and quality used options.
                    </p>
                  </div>
                );
              })()}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Common Vehicles */}
      <section className="py-16 bg-card/50 border-y border-border/30">
        <div className="container max-w-4xl">
          <FadeIn>
            <h2 className="font-semibold text-3xl text-foreground mb-6">Vehicles That Use {page.size} Tires</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {page.commonVehicles.map(vehicle => (
                <div key={vehicle} className="flex items-center gap-3 p-4 bg-background rounded-sm border border-border/30">
                  <ChevronRight className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-foreground font-medium">{vehicle}</span>
                </div>
              ))}
            </div>
            <p className="mt-6 text-foreground/60 text-sm">
              Not sure if {page.size} is right for your vehicle? Call us at{" "}
              <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick(`tire-size-${page.slug}-vehicles`)} className="text-primary hover:underline">
                {BUSINESS.phone.display}
              </a>{" "}
              and we'll confirm the correct size for your year, make, and model.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* Category-specific buying guide (wave-181.x) */}
      <section className="py-16 bg-card/30">
        <div className="container max-w-4xl">
          <FadeIn>
            <h2 className="font-semibold text-3xl text-foreground mb-6">{buyingGuide.heading}</h2>
            <p className="text-foreground/80 leading-relaxed whitespace-pre-line">{buyingGuide.body}</p>

            <h3 className="font-semibold text-xl text-foreground mt-10 mb-4">What to look for on the sidewall</h3>
            <ul className="space-y-2 text-foreground/75">
              {buyingGuide.sidewallTips.map(tip => (
                <li key={tip} className="flex items-start gap-2">
                  <ChevronRight className="w-4 h-4 text-primary shrink-0 mt-1" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>

            <h3 className="font-semibold text-xl text-foreground mt-10 mb-4">Worth checking while the tires are off</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              {buyingGuide.relatedServices.map(s => (
                <Link
                  key={s.slug}
                  href={`/${s.slug}`}
                  className="group p-4 bg-background rounded-sm border border-border/30 hover:border-primary/40 transition-colors"
                >
                  <div className="font-semibold text-foreground group-hover:text-primary transition-colors">{s.label}</div>
                  <div className="text-sm text-foreground/60 mt-1">{s.why}</div>
                </Link>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16">
        <div className="container max-w-4xl">
          <FadeIn>
            <h2 className="font-semibold text-3xl text-foreground mb-8">Frequently Asked Questions</h2>
            <div className="space-y-6">
              {FAQS.map((faq) => (
                <div key={faq.q}>
                  <h3 className="font-semibold text-foreground mb-2">{faq.q}</h3>
                  <p className="text-foreground/70">{faq.a}</p>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* BOOKING — primary conversion path */}
      <section id="booking" className="py-16 bg-card/50 border-y border-border/30">
        <div className="container max-w-3xl">
          <FadeIn>
            <h2 className="font-semibold text-3xl text-foreground mb-3">
              Get a quote on {page.size} tires
            </h2>
            <p className="text-foreground/65 mb-6">
              Tell us your vehicle, we'll quote {page.size} options at every price tier
              and get you scheduled. Walk-ins always welcome.
            </p>
          </FadeIn>
          <BookingForm defaultService="tires" />
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-primary/5 border-y border-primary/10">
        <div className="container text-center">
          <FadeIn>
            <h2 className="font-semibold text-3xl text-foreground mb-4">Ready to Get {page.size} Tires?</h2>
            <p className="text-foreground/70 mb-8 max-w-xl mx-auto">
              Call now for pricing and availability. Same-day installation on most sizes.
              Walk-ins welcome 7 days a week.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href={BUSINESS.phone.href}
                onClick={() => trackPhoneClick(`tire-size-${page.slug}-cta`)}
                className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-bold text-lg tracking-wide hover:bg-primary/90 transition-colors"
              >
                <Phone className="w-5 h-5" />{BUSINESS.phone.display}
              </a>
              <Link
                href="/tires"
                className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-bold text-lg tracking-wide hover:border-primary hover:text-primary transition-colors"
              >
                BROWSE ALL TIRES <ChevronRight className="w-5 h-5" />
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Related Sizes */}
      {relatedSizes.length > 0 && (
        <section className="py-16">
          <div className="container">
            <FadeIn>
              <h2 className="font-semibold text-2xl text-foreground mb-6">Related {page.category} Tire Sizes</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {relatedSizes.map(s => (
                  <Link
                    key={s.slug}
                    href={`/tires/${s.slug}`}
                    className="group p-4 bg-card rounded-sm border border-border/30 hover:border-primary/30 transition-colors"
                  >
                    <div className="font-semibold text-lg text-foreground group-hover:text-primary transition-colors">{s.size}</div>
                    <div className="text-sm text-foreground/50 mt-1">{s.commonVehicles.join(", ")}</div>
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
