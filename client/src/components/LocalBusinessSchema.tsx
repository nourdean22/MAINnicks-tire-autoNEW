/**
 * LocalBusinessSchema — Reusable Schema.org structured data component.
 * Outputs JSON-LD for AutoRepair/TireShop LocalBusiness.
 * Can be customized per page with additional schema properties.
 *
 * Also injects links to static schema files (howto, reviews, services)
 * so crawlers and AI models can discover deep structured data.
 */
import { BUSINESS } from "@shared/business";

interface Props {
  /** Override the page name in schema */
  pageName?: string;
  /** Additional schema properties to merge */
  additionalSchema?: Record<string, unknown>;
  /** Include HowTo schemas (default: false, enable on homepage/services) */
  includeHowTo?: boolean;
  /** Include Review schemas (default: false, enable on homepage/reviews) */
  includeReviews?: boolean;
  /** Include Service schemas (default: false, enable on homepage/services) */
  includeServices?: boolean;
}

export default function LocalBusinessSchema({
  pageName,
  additionalSchema,
  includeHowTo = false,
  includeReviews = false,
  includeServices = false,
}: Props) {
  const schema = {
    "@context": "https://schema.org",
    "@type": ["AutoRepair", "TireShop"],
    name: pageName || BUSINESS.name,
    image: `${BUSINESS.urls.website}/favicon.ico`,
    telephone: `+1-${BUSINESS.phone.dashed}`,
    url: BUSINESS.urls.website,
    email: "info@nickstire.org",
    foundingDate: "2018",
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
    paymentAccepted: "Cash, Visa, Mastercard, Discover, American Express, Debit Cards, Acima, Snap Finance, Koalafi, American First Finance",
    currenciesAccepted: "USD",
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: BUSINESS.reviews.rating,
      reviewCount: BUSINESS.reviews.count,
      bestRating: 5,
      worstRating: 1,
    },
    priceRange: "$$",
    sameAs: [...BUSINESS.sameAs],
    hasMap: BUSINESS.urls.googleBusiness,
    areaServed: BUSINESS.serviceAreas.map((area) => ({
      "@type": "City",
      name: area,
    })),
    description:
      `Cleveland's #1 new and used tire specialist and full-service auto repair. Buy tires online with free premium installation package included. Expert brake, diagnostic, emissions, and general repair. ${BUSINESS.reviews.rating} stars, ${BUSINESS.reviews.countDisplay} reviews. Walk-ins welcome 7 days. $10 down financing available.`,
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
      "AC and heating repair",
      "Transmission service",
      "Electrical system repair",
      "Exhaust system repair",
      "General engine repair",
      "Commercial fleet services",
      "No credit check auto financing",
      "Winter tire installation Cleveland",
      "Pothole damage repair Cleveland",
    ],
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Auto Repair & Tire Services",
      itemListElement: [
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "New Tire Sales & Installation", description: "Free premium installation package with every tire purchase." },
          priceSpecification: { "@type": "PriceSpecification", priceCurrency: "USD", description: "Installation FREE with tire purchase" },
        },
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "Used Tires", description: "Quality-inspected used tires starting at $60 installed." },
          priceSpecification: { "@type": "PriceSpecification", priceCurrency: "USD", minPrice: "60" },
        },
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "Flat Tire Repair", description: "Professional plug-and-patch repair in 15 minutes." },
          priceSpecification: { "@type": "PriceSpecification", priceCurrency: "USD" },
        },
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "Brake Repair", description: "Pads, rotors, calipers, ABS. Free brake inspection." },
          priceSpecification: { "@type": "PriceSpecification", priceCurrency: "USD" },
        },
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "Oil Change — Conventional", description: "With filter, multi-point inspection, and tire pressure check." },
          priceSpecification: { "@type": "PriceSpecification", priceCurrency: "USD" },
        },
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "Oil Change — Full Synthetic", description: "Mobil 1, Pennzoil Platinum, or equivalent." },
          priceSpecification: { "@type": "PriceSpecification", priceCurrency: "USD" },
        },
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "Engine Diagnostics", description: "OBD-II code reading, diagnostic fee credited toward repair." },
          priceSpecification: { "@type": "PriceSpecification", priceCurrency: "USD" },
        },
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "Ohio E-Check Emissions Testing & Repair", description: "Certified station. Walk-ins welcome, 20-30 minutes." },
        },
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "Wheel Alignment", description: "4-wheel computerized alignment." },
          priceSpecification: { "@type": "PriceSpecification", priceCurrency: "USD" },
        },
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "AC & Heating Repair", description: "AC recharge, compressor, heater core, blower motor." },
          priceSpecification: { "@type": "PriceSpecification", priceCurrency: "USD" },
        },
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "Suspension & Steering", description: "Struts, shocks, control arms, ball joints, tie rods." },
        },
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "Transmission Services", description: "Diagnostics, fluid flush, repair for automatic and manual." },
        },
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "Electrical System", description: "Free battery testing, alternator, starter, wiring." },
        },
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "Exhaust System", description: "Muffler, catalytic converter, exhaust manifold, flex pipe." },
        },
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "General Engine Repair", description: "Water pump, timing belt, head gasket, radiator, coolant flush." },
        },
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "Fleet Services", description: "Priority scheduling, custom intervals, volume pricing." },
        },
      ],
    },
    additionalProperty: [
      { "@type": "PropertyValue", name: "walkInsWelcome", value: "true" },
      { "@type": "PropertyValue", name: "appointmentRequired", value: "false" },
      { "@type": "PropertyValue", name: "laborWarranty", value: "36 months / 36,000 miles" },
      { "@type": "PropertyValue", name: "noCreditCheckFinancing", value: "true" },
      { "@type": "PropertyValue", name: "certifiedECheckStation", value: "true" },
      { "@type": "PropertyValue", name: "freeEstimates", value: "true" },
      { "@type": "PropertyValue", name: "sameDayService", value: "true" },
    ],
    ...additionalSchema,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      {includeHowTo && (
        <link rel="alternate" type="application/ld+json" href="/howto-schemas.json" />
      )}
      {includeReviews && (
        <link rel="alternate" type="application/ld+json" href="/reviews-schema.json" />
      )}
      {includeServices && (
        <link rel="alternate" type="application/ld+json" href="/services-schema.json" />
      )}
    </>
  );
}
