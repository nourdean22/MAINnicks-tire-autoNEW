import PageLayout from "@/components/PageLayout";
import { useParams } from "wouter";
import { Link } from "wouter";
import { Phone, ChevronRight, ShieldCheck, Clock, Package, Search } from "lucide-react";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { getTireSizeBySlug, TIRE_SIZE_PAGES } from "@shared/tireSizes";
import { BUSINESS } from "@shared/business";
import InternalLinks from "@/components/InternalLinks";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FadeIn from "@/components/FadeIn";

function trackPhoneClick(location: string) {
  if (typeof window !== "undefined" && (window as any).gtag) {
    (window as any).gtag("event", "phone_call_click", { event_category: "conversion", event_label: location });
  }
}

export default function TireSizePage() {
  const { size: paramSlug } = useParams<{ size: string }>();
  const slug = paramSlug || (typeof window !== "undefined" ? window.location.pathname.replace(/^\/tires\//, "").split("/")[0] : "");
  const page = slug ? getTireSizeBySlug(slug) : undefined;

  if (!page) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="font-semibold text-4xl text-foreground mb-4">Tire Size Not Found</h1>
          <p className="text-foreground/60 mb-6">We couldn't find that tire size. Browse our full inventory instead.</p>
          <Link href="/tires" className="text-primary hover:underline">Browse All Tires</Link>
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

  return (
    <PageLayout showChat={true}>
      <SEOHead
        title={page.metaTitle}
        description={page.metaDescription}
        canonicalPath={`/tires/${page.slug}`}
      />
      <LocalBusinessSchema pageName={`${page.size} Tires Cleveland - Nick's Tire & Auto`} />

      {/* Hero */}
      <section className="relative pt-28 pb-16 lg:pt-36 lg:pb-24">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-background/95 to-background" />
        <div className="relative container">
          <Breadcrumbs items={breadcrumbs} />
          <FadeIn>
            <h1 className="font-semibold font-bold text-5xl sm:text-6xl lg:text-7xl text-foreground leading-[0.9] tracking-tight mt-6">
              <span className="text-primary">{page.size}</span>
              <br />Tires Cleveland
            </h1>
          </FadeIn>
          <FadeIn delay={0.1}>
            <p className="mt-6 text-lg sm:text-xl text-foreground/80 max-w-2xl font-light leading-relaxed">
              New and used {page.size} tires in stock. Fits {vehicleList}. Free premium installation package
              included with every set — mounting, balancing, alignment check, and lifetime rotations.
            </p>
          </FadeIn>
          <FadeIn delay={0.15}>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary text-sm font-medium rounded-sm">
                <Package className="w-4 h-4" />{page.category}
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
                className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-semibold font-bold text-lg tracking-wide hover:bg-primary/90 transition-colors"
              >
                <Phone className="w-5 h-5" />CALL FOR PRICE
              </a>
              <Link
                href="/tires"
                className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-semibold font-bold text-lg tracking-wide hover:border-primary hover:text-primary transition-colors"
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
                  <p className="text-sm text-foreground/60">Budget-friendly used tires from $40. Premium brands available. Every tire inspected.</p>
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

      {/* FAQ */}
      <section className="py-16">
        <div className="container max-w-4xl">
          <FadeIn>
            <h2 className="font-semibold text-3xl text-foreground mb-8">Frequently Asked Questions</h2>
            <div className="space-y-6">
              <div>
                <h3 className="font-semibold text-foreground mb-2">How much do {page.size} tires cost?</h3>
                <p className="text-foreground/70">
                  Prices vary by brand and type. Used {page.size} tires start around $40-60 each. New tires range from $80-200+ per tire
                  depending on the brand. All prices include our free premium installation package ($289 value).
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-2">Do you have {page.size} tires in stock?</h3>
                <p className="text-foreground/70">
                  Yes — {page.size} is one of our most popular sizes. We typically have multiple options in stock,
                  both new and used. Call us at {BUSINESS.phone.display} to confirm current availability.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-2">Can I buy just one or two {page.size} tires?</h3>
                <p className="text-foreground/70">
                  Absolutely. We sell tires individually, in pairs, or as a full set. For best performance and safety,
                  we recommend replacing at least two tires at a time on the same axle.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-2">Do you offer financing on {page.size} tires?</h3>
                <p className="text-foreground/70">
                  Yes. We offer financing with payments as low as $10 down. No credit check required.
                  Get the tires you need today and pay over time.
                </p>
              </div>
            </div>
          </FadeIn>
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
                className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-semibold font-bold text-lg tracking-wide hover:bg-primary/90 transition-colors"
              >
                <Phone className="w-5 h-5" />{BUSINESS.phone.display}
              </a>
              <Link
                href="/tires"
                className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-semibold font-bold text-lg tracking-wide hover:border-primary hover:text-primary transition-colors"
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
