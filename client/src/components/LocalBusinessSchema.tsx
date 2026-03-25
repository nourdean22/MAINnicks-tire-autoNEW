/**
 * LocalBusinessSchema — Reusable Schema.org structured data component.
 * Outputs JSON-LD for AutoRepair/TireShop LocalBusiness.
 * Can be customized per page with additional schema properties.
 */
import { BUSINESS } from "@shared/business";

interface Props {
  /** Override the page name in schema */
  pageName?: string;
  /** Additional schema properties to merge */
  additionalSchema?: Record<string, unknown>;
}

export default function LocalBusinessSchema({ pageName, additionalSchema }: Props = {}) {
  const schema = {
    "@context": "https://schema.org",
    "@type": ["AutoRepair", "TireShop"],
    name: pageName || BUSINESS.name,
    image: `${BUSINESS.urls.website}/favicon.ico`,
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
    geo: {
      "@type": "GeoCoordinates",
      latitude: BUSINESS.geo.lat,
      longitude: BUSINESS.geo.lng,
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
    paymentAccepted: "Cash, Visa, Mastercard, Discover, American Express, Debit Cards, Apple Pay, Google Pay",
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: BUSINESS.reviews.rating,
      reviewCount: BUSINESS.reviews.count,
      bestRating: 5,
    },
    priceRange: "$$",
    sameAs: [...BUSINESS.sameAs],
    hasMap: BUSINESS.urls.googleBusiness,
    areaServed: BUSINESS.serviceAreas.map((area) => ({
      "@type": "City",
      name: area,
    })),
    description: "Cleveland's #1 new and used tire specialist and full-service auto repair. Buy tires online with free premium installation package ($289+ value). Flat tire repair from $15. Expert brake, diagnostic, emissions, and general repair. 4.9 stars, 1,700+ reviews. Walk-ins welcome 7 days. $10 down financing available.",
    knowsAbout: [
      "New tire sales and installation",
      "Used tire sales and installation",
      "Flat tire repair",
      "Tire mounting and balancing",
      "TPMS sensor service",
      "Wheel alignment",
      "Brake repair",
      "Engine diagnostics",
      "Ohio E-Check emissions repair",
      "Oil change service",
      "Suspension repair",
      "Auto financing",
    ],
    ...additionalSchema,
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
