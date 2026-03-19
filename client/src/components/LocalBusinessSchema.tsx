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
        opens: "09:00",
        closes: "18:00",
      },
    ],
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: BUSINESS.reviews.rating,
      reviewCount: BUSINESS.reviews.count,
      bestRating: 5,
    },
    priceRange: "$$",
    areaServed: BUSINESS.serviceAreas.map((area) => ({
      "@type": "City",
      name: area,
    })),
    ...additionalSchema,
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
