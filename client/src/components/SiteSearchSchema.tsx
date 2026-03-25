/**
 * SiteSearchSchema — Organization + WebSite JSON-LD for Google Knowledge Panel.
 * Includes SiteLinksSearchBox potential action and local business info.
 * Render once in the homepage for maximum SEO impact.
 */
import { BUSINESS } from "@shared/business";

export default function SiteSearchSchema() {
  const siteUrl = typeof window !== "undefined" ? window.location.origin : "https://nickstire.org";

  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "AutoRepair",
    "@id": `${siteUrl}/#organization`,
    name: BUSINESS.name,
    url: siteUrl,
    telephone: BUSINESS.phone.display,
    address: {
      "@type": "PostalAddress",
      streetAddress: BUSINESS.address.street,
      addressLocality: BUSINESS.address.city,
      addressRegion: BUSINESS.address.state,
      postalCode: BUSINESS.address.zip,
      addressCountry: "US",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: 41.5834,
      longitude: -81.5267,
    },
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        opens: "08:00",
        closes: "18:00",
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "Sunday",
        opens: "09:00",
        closes: "16:00",
      },
    ],
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.9",
      reviewCount: String(BUSINESS.reviews.count),
      bestRating: "5",
    },
    sameAs: [
      "https://www.instagram.com/nicks_tire_euclid/",
      "https://www.facebook.com/nickstireeuclid/",
    ],
  };

  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    url: siteUrl,
    name: BUSINESS.name,
    publisher: { "@id": `${siteUrl}/#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${siteUrl}/services?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
      />
    </>
  );
}
