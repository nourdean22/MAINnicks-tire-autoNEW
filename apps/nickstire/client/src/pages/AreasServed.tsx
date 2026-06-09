/**
 * AreasServed — Hub page linking to ALL city, neighborhood, and intersection pages.
 * This page eliminates orphan pages by providing incoming internal links
 * to every location-based SEO page on the site.
 */

import PageLayout from "@/components/PageLayout";
import { Link } from "wouter";
import { SEOHead, Breadcrumbs, trackPhoneClick, trackEvent } from "@/components/SEO";
import { CITIES } from "@shared/cities";
import { NEIGHBORHOODS } from "@shared/neighborhoods";
// 2026-05-19 · INTERSECTIONS import removed · 154-page intersection
// silo was an SEO dead-weight (orphans, 0 schema, cannibalization).
// AreasServed page no longer shows the intersection grid.
import { BUSINESS } from "@shared/business";
import { MapPin, ChevronRight, Navigation } from "lucide-react";
import InternalLinks from "@/components/InternalLinks";

export default function AreasServed() {
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Areas Served" },
  ];

  // Group neighborhoods by type for organized display
  const streetNeighborhoods = NEIGHBORHOODS.filter(n => n.type === "street");
  const landmarkNeighborhoods = NEIGHBORHOODS.filter(n => n.type === "landmark");
  const areaNeighborhoods = NEIGHBORHOODS.filter(n => n.type === "neighborhood");

  return (
    <PageLayout activeHref="/areas-served" showChat={true}>
      {/* wave-154 — was "150+ neighborhoods" — actual count from data
          is 122 (shared/neighborhoods.ts). Fixed to "120+" so the claim
          matches reality and Google's quality-content signals stay aligned. */}
      <SEOHead
        title="Areas We Serve · Cleveland & Northeast Ohio | Nick's Tire & Auto"
        description="Nick's Tire & Auto serves the cities and neighborhoods across Cleveland, Euclid, Parma, Parma Heights, Lakewood, Mentor, and the whole northeast Ohio. We've also been known to help drivers from as far as Erie — find your area and we'll tell you what street to take."
        canonicalPath="/areas-served"
      />

      <section className="bg-[#0A0A0A] pt-24 pb-16">
        <div className="container">
          <Breadcrumbs items={breadcrumbs} />

          <div className="mt-8 max-w-3xl">
            <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              Areas We Serve Across Northeast Ohio
            </h1>
            <p className="text-foreground/60 mt-4 text-base leading-relaxed">
              Nick's Tire & Auto at {BUSINESS.address.street}, Cleveland, OH {BUSINESS.address.zip} serves
              drivers from cities and neighborhoods across Northeast Ohio. Whether
              you're in Euclid, Parma, Lakewood, Mentor, or anywhere in between — we're the corner of
              Euclid Ave that fixes it. Find your area below.
            </p>
          </div>
        </div>
      </section>

      {/* ─── CITY PAGES ─── */}
      <section className="bg-[#0D0D0D] py-16 border-t border-border/20">
        <div className="container">
          <div className="flex items-center gap-3 stagger-in mb-8">
            <MapPin className="w-5 h-5 text-[#FDB913]" />
            <h2 className="text-xl font-bold text-white">Cities We Serve</h2>
            <span className="text-xs text-foreground/40 bg-foreground/5 px-2 py-0.5 rounded">
              {CITIES.length} cities
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 stagger-in">
            {CITIES.map((city) => (
              <Link
                key={city.slug}
                href={`/${city.slug}`}
                className="group flex items-center justify-between p-3 border border-border/20 hover:border-[#FDB913]/30 transition-colors bg-[#111]"
              >
                <div className="min-w-0">
                  <p className="font-medium text-sm text-white group-hover:text-[#FDB913] transition-colors">
                    {city.name}
                  </p>
                  <p className="text-xs text-foreground/40 mt-0.5">
                    {city.distance} away &middot; {city.driveTime} drive
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-foreground/20 group-hover:text-[#FDB913] shrink-0 ml-2 transition-colors" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ─── NEIGHBORHOOD PAGES ─── */}
      <section className="bg-[#0A0A0A] py-16 border-t border-border/20">
        <div className="container">
          <div className="flex items-center gap-3 stagger-in mb-8">
            <Navigation className="w-5 h-5 text-[#FDB913]" />
            <h2 className="text-xl font-bold text-white">Neighborhoods & Nearby Areas</h2>
            <span className="text-xs text-foreground/40 bg-foreground/5 px-2 py-0.5 rounded">
              {NEIGHBORHOODS.length} locations
            </span>
          </div>

          {/* Area neighborhoods */}
          {areaNeighborhoods.length > 0 && (
            <div className="mb-10">
              <h3 className="text-sm font-semibold text-foreground/50 uppercase tracking-wider mb-4">
                Neighborhoods
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 stagger-in">
                {areaNeighborhoods.map((n) => (
                  <Link
                    key={n.slug}
                    href={`/${n.slug}`}
                    className="group flex items-center gap-2 stagger-in p-2.5 border border-border/10 hover:border-[#FDB913]/30 transition-colors"
                  >
                    <span className="text-xs text-foreground/60 group-hover:text-[#FDB913] transition-colors truncate">
                      {n.name}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Landmark neighborhoods */}
          {landmarkNeighborhoods.length > 0 && (
            <div className="mb-10">
              <h3 className="text-sm font-semibold text-foreground/50 uppercase tracking-wider mb-4">
                Near Landmarks
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 stagger-in">
                {landmarkNeighborhoods.map((n) => (
                  <Link
                    key={n.slug}
                    href={`/${n.slug}`}
                    className="group flex items-center gap-2 stagger-in p-2.5 border border-border/10 hover:border-[#FDB913]/30 transition-colors"
                  >
                    <span className="text-xs text-foreground/60 group-hover:text-[#FDB913] transition-colors truncate">
                      {n.name}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Street neighborhoods */}
          {streetNeighborhoods.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-foreground/50 uppercase tracking-wider mb-4">
                Major Streets & Corridors
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 stagger-in">
                {streetNeighborhoods.map((n) => (
                  <Link
                    key={n.slug}
                    href={`/${n.slug}`}
                    className="group flex items-center gap-2 stagger-in p-2.5 border border-border/10 hover:border-[#FDB913]/30 transition-colors"
                  >
                    <span className="text-xs text-foreground/60 group-hover:text-[#FDB913] transition-colors truncate">
                      {n.name}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 2026-05-19 · Intersection grid section DELETED · 154 orphan
          pages with 0 schema and 1 inbound link were SEO dead-weight.
          Cities + Neighborhoods sections above already cover the
          location-based intent without the cannibalization. */}

      {/* ─── CTA ─── */}
      <section className="bg-[#0A0A0A] py-16 border-t border-border/20">
        <div className="container text-center max-w-2xl">
          <h2 className="text-2xl font-bold text-white mb-4">
            Don't See Your Area? We Still Serve You.
          </h2>
          <p className="text-foreground/60 mb-8">
            Nick's Tire & Auto welcomes drivers from all over Northeast Ohio. Walk in 7 days. Free check. Written quote. You don't pay until you say yes. Or schedule a drop-off online.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 stagger-in justify-center">
            {/* Near-me intent = call or navigate NOW. Call is the primary
                action; Get Directions for "I'm pulling up"; drop-off kept. */}
            <a
              href={BUSINESS.phone.href}
              onClick={() => trackPhoneClick("areas-served")}
              className="inline-flex items-center justify-center px-6 py-3 bg-[#FDB913] text-black font-semibold text-sm hover:bg-[#FDB913]/90 transition-colors"
            >
              Call {BUSINESS.phone.display}
            </a>
            <a
              href={BUSINESS.urls.googleMapsDirections}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent("directions_click", { source: "areas-served" })}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-border/30 text-foreground/70 font-medium text-sm hover:border-[#FDB913]/40 transition-colors"
            >
              <Navigation className="w-4 h-4" />
              Get Directions
            </a>
            <Link
              href="/booking"
              className="inline-flex items-center justify-center px-6 py-3 border border-border/30 text-foreground/70 font-medium text-sm hover:border-[#FDB913]/40 transition-colors"
            >
              Schedule Drop-Off
            </Link>
          </div>
        </div>
      </section>

      <InternalLinks title="More from Nick's Tire & Auto" exclude={["/areas-served"]} />
    </PageLayout>
  );
}
