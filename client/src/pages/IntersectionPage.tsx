/**
 * IntersectionPage — /near/[slug] SEO pages
 * Targets "auto repair near [intersection]" search queries.
 * Each page has unique local content, map embed, and CTAs.
 */

import { useEffect } from "react";
import { useRoute, Link } from "wouter";
import { getIntersectionBySlug, type IntersectionData } from "@shared/intersections";
import { BUSINESS } from "@shared/business";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import PageLayout from "@/components/PageLayout";
import BookingForm from "@/components/BookingForm";
import { Phone, MapPin, Clock, Star, Navigation, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import FadeIn from "@/components/FadeIn";

function NotFound() {
  return (
    <PageLayout>
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <h1 className="font-heading text-4xl font-bold text-foreground mb-4 uppercase">Location Not Found</h1>
          <p className="text-muted-foreground mb-8">We couldn't find this intersection.</p>
          <Link href="/" className="btn-gold inline-flex items-center gap-2">Back to Home</Link>
        </div>
      </div>
    </PageLayout>
  );
}

function IntersectionSchema({ intersection }: { intersection: IntersectionData }) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "AutoRepair",
    "name": "Nick's Tire & Auto",
    "url": `https://nickstire.org/near/${intersection.slug}`,
    "telephone": "+1-216-862-0005",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "17625 Euclid Ave",
      "addressLocality": "Euclid",
      "addressRegion": "OH",
      "postalCode": "44112",
    },
    "geo": {
      "@type": "GeoCoordinates",
      "latitude": intersection.lat,
      "longitude": intersection.lng,
    },
    "areaServed": {
      "@type": "Place",
      "name": intersection.neighborhood || intersection.name,
      "geo": { "@type": "GeoCoordinates", "latitude": intersection.lat, "longitude": intersection.lng },
    },
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": "4.9",
      "reviewCount": String(BUSINESS.reviews.count),
    },
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />;
}

export default function IntersectionPage() {
  const [, params] = useRoute("/near/:slug");
  const slug = params?.slug || "";
  const intersection = getIntersectionBySlug(slug);

  useEffect(() => { window.scrollTo(0, 0); }, [slug]);

  if (!intersection) return <NotFound />;

  const mapsDirectionsUrl = `https://www.google.com/maps/dir/${intersection.lat},${intersection.lng}/17625+Euclid+Ave+Euclid+OH+44112`;

  return (
    <PageLayout>
      <SEOHead
        title={`Auto Repair Near ${intersection.name} | Nick's Tire & Auto`}
        description={`Stuck near ${intersection.name}? Nick's Tire & Auto is ${intersection.driveMinutes} min away. 4.9★ (1,700+ reviews). Walk-ins welcome. (216) 862-0005.`}
        canonicalPath={`/near/${intersection.slug}`}
      />
      <Breadcrumbs items={[
        { label: "Locations", href: "/contact" },
        { label: `Near ${intersection.name}` },
      ]} />
      <IntersectionSchema intersection={intersection} />

      {/* Hero */}
      <section className="py-16 lg:py-24 section-dark">
        <div className="container">
          <FadeIn>
            <div className="max-w-3xl">
              <h1 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-extrabold text-foreground uppercase tracking-tight leading-tight">
                Stuck Near {intersection.name}?
              </h1>
              <p className="mt-4 text-xl text-muted-foreground">
                Nick's Tire & Auto is just <span className="text-primary font-bold">{intersection.driveMinutes} minutes</span> away.
                No appointment needed — pull in now.
              </p>
              <p className="mt-2 text-muted-foreground flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary shrink-0" />
                17625 Euclid Ave, Euclid OH 44112
              </p>

              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <a
                  href={BUSINESS.phone.href}
                  onClick={() => trackPhoneClick("intersection-hero")}
                  className="btn-gold inline-flex items-center justify-center gap-2 text-base"
                >
                  <Phone className="w-5 h-5" />
                  Call Now
                </a>
                <a
                  href={mapsDirectionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-gold inline-flex items-center justify-center gap-2 text-base"
                >
                  <Navigation className="w-5 h-5" />
                  I'm On My Way
                </a>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Local Content */}
      <section className="py-12 section-elevated">
        <div className="container">
          <FadeIn>
            <div className="max-w-3xl">
              <p className="text-foreground/70 text-lg leading-relaxed">
                {intersection.localContent}
              </p>
              {intersection.landmark && (
                <p className="mt-4 text-muted-foreground text-sm">
                  <MapPin className="w-3.5 h-3.5 inline mr-1 text-primary" />
                  {intersection.landmark} — {intersection.neighborhood}, {intersection.zip}
                </p>
              )}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Map + Services */}
      <section className="py-12 section-dark">
        <div className="container">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            {/* Map */}
            <FadeIn>
              <div className="aspect-[4/3] rounded-2xl overflow-hidden border border-border">
                <iframe
                  src={`https://www.google.com/maps/embed/v1/directions?key=&origin=${intersection.lat},${intersection.lng}&destination=17625+Euclid+Ave+Euclid+OH+44112&mode=driving`}
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  allowFullScreen
                  loading="lazy"
                  title={`Directions from ${intersection.name} to Nick's Tire & Auto`}
                />
              </div>
            </FadeIn>

            {/* Quick Services */}
            <FadeIn delay={0.15}>
              <div>
                <h2 className="font-heading text-2xl font-bold text-foreground uppercase tracking-tight mb-6">
                  Services Near You
                </h2>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Tires", href: "/tires", price: "From $60" },
                    { label: "Brakes", href: "/brakes", price: "From $89" },
                    { label: "Oil Change", href: "/oil-change", price: "From $39" },
                    { label: "Diagnostics", href: "/diagnostics", price: "From $49" },
                    { label: "Emissions", href: "/emissions", price: "From $29" },
                    { label: "Flat Repair", href: "/tires", price: "$25" },
                  ].map((s) => (
                    <Link
                      key={s.href + s.label}
                      href={s.href}
                      className="service-card p-4 flex flex-col gap-1 group"
                    >
                      <span className="font-heading text-sm font-bold text-foreground uppercase tracking-wide group-hover:text-primary transition-colors">
                        {s.label}
                      </span>
                      <span className="text-primary text-xs font-mono font-bold">{s.price}</span>
                    </Link>
                  ))}
                </div>

                <div className="mt-8 p-6 surface-raised-card">
                  <div className="flex items-center gap-2 mb-3">
                    <Star className="w-5 h-5 fill-primary text-primary" />
                    <span className="text-foreground font-bold">4.9 Stars</span>
                    <span className="text-muted-foreground text-sm">({BUSINESS.reviews.countDisplay} reviews)</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="w-4 h-4" />
                    <span>Mon–Sat 8AM–6PM, Sun 9AM–4PM</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                    <Phone className="w-4 h-4" />
                    <a href={BUSINESS.phone.href} className="hover:text-primary transition-colors">
                      {BUSINESS.phone.display}
                    </a>
                  </div>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Booking Form */}
      <section id="booking" className="py-16 section-elevated">
        <div className="container max-w-2xl">
          <FadeIn>
            <h2 className="font-heading text-2xl font-bold text-foreground uppercase tracking-tight text-center mb-8">
              Book Your Appointment
            </h2>
            <BookingForm />
          </FadeIn>
        </div>
      </section>
    </PageLayout>
  );
}
