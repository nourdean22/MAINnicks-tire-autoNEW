/**
 * ServiceCityPage — Programmatic SEO pages for [service]-[city]-oh routes
 * 260 unique pages targeting "[service] near [city] OH" search queries.
 */

import { useEffect } from "react";
import { useRoute, Link } from "wouter";
import { getServiceCityPage } from "@shared/serviceCityCombinator";
import { BUSINESS } from "@shared/business";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import PageLayout from "@/components/PageLayout";
import BookingForm from "@/components/BookingForm";
import { Phone, MapPin, Star, Clock, ArrowRight } from "lucide-react";
import FadeIn from "@/components/FadeIn";

export default function ServiceCityPage() {
  const [, params] = useRoute("/:slug");
  const slug = params?.slug || "";
  const page = getServiceCityPage(slug);

  useEffect(() => { window.scrollTo(0, 0); }, [slug]);

  if (!page) return null; // Will 404 via fallback

  const schemaData = {
    "@context": "https://schema.org",
    "@type": "AutoRepair",
    "name": "Nick's Tire & Auto",
    "url": `https://nickstire.org/${page.slug}`,
    "telephone": "+1-216-862-0005",
    "address": { "@type": "PostalAddress", "streetAddress": "17625 Euclid Ave", "addressLocality": "Euclid", "addressRegion": "OH", "postalCode": "44112" },
    "areaServed": { "@type": "City", "name": page.cityName },
    "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.9", "reviewCount": String(BUSINESS.reviews.count) },
    "hasOfferCatalog": { "@type": "OfferCatalog", "name": page.serviceName, "itemListElement": [{ "@type": "Offer", "itemOffered": { "@type": "Service", "name": page.serviceName } }] },
  };

  return (
    <PageLayout>
      <SEOHead
        title={page.title}
        description={page.metaDescription}
        canonicalPath={`/${page.slug}`}
      />
      <Breadcrumbs items={[
        { label: page.serviceName, href: `/${page.serviceSlug}` },
        { label: `${page.cityName}, OH` },
      ]} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaData) }} />

      {/* Hero */}
      <section className="py-16 lg:py-24 section-dark">
        <div className="container">
          <FadeIn>
            <div className="max-w-3xl">
              <h1 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-extrabold text-foreground uppercase tracking-tight">
                {page.h1}
              </h1>
              <p className="mt-6 text-lg text-muted-foreground leading-relaxed">{page.intro}</p>

              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick("service-city")} className="btn-gold inline-flex items-center justify-center gap-2">
                  <Phone className="w-5 h-5" /> Call (216) 862-0005
                </a>
                <Link href="/booking" className="btn-outline inline-flex items-center justify-center gap-2">
                  Book Online <ArrowRight className="w-4 h-4" />
                </Link>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><Star className="w-4 h-4 text-primary fill-primary" /> 4.9 ({BUSINESS.reviews.countDisplay} reviews)</span>
                <span className="flex items-center gap-1"><MapPin className="w-4 h-4" /> 17625 Euclid Ave, Euclid</span>
                <span className="flex items-center gap-1"><Clock className="w-4 h-4" /> Open 7 days</span>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Services quick links */}
      <section className="py-12 section-elevated">
        <div className="container">
          <FadeIn>
            <h2 className="font-heading text-2xl font-bold text-foreground uppercase tracking-tight mb-6">
              All Services for {page.cityName} Drivers
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Tires", href: "/tires", price: "From $60" },
                { label: "Brakes", href: "/brakes", price: "From $89" },
                { label: "Oil Change", href: "/oil-change", price: "From $39" },
                { label: "Diagnostics", href: "/diagnostics", price: "From $49" },
                { label: "Emissions", href: "/emissions", price: "From $29" },
                { label: "Alignment", href: "/alignment", price: "From $79" },
                { label: "AC Repair", href: "/ac-repair", price: "From $49" },
                { label: "General", href: "/general-repair", price: "Free est." },
              ].map((s) => (
                <Link key={s.href} href={s.href} className="service-card p-4 group">
                  <span className="font-heading text-xs font-bold uppercase tracking-wide text-foreground group-hover:text-primary transition-colors">{s.label}</span>
                  <span className="block text-primary text-xs font-mono mt-1">{s.price}</span>
                </Link>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Booking */}
      <section id="booking" className="py-16 section-dark">
        <div className="container max-w-2xl">
          <FadeIn>
            <h2 className="font-heading text-2xl font-bold text-foreground uppercase tracking-tight text-center mb-8">
              Book {page.serviceName}
            </h2>
            <BookingForm />
          </FadeIn>
        </div>
      </section>
    </PageLayout>
  );
}
