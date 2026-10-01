/**
 * LocalBusinessSchema — Reusable Schema.org structured data component.
 * Outputs JSON-LD for AutoRepair/TireShop LocalBusiness.
 * Can be customized per page with additional schema properties.
 *
 * Also injects links to static schema files (howto, reviews, services)
 * so crawlers and AI models can discover deep structured data.
 */
import { BUSINESS } from "@shared/business";
import { GBP_CID } from "@shared/const";
import { trpc } from "@/lib/trpc";

interface Props {
  /**
   * @deprecated No longer overrides the schema entity name. The shared "@id"
   * (/#localbusiness) must carry ONE canonical name (BUSINESS.name) or crawlers
   * and AI engines see conflicting names for the same entity. Kept only so
   * existing call sites still type-check.
   */
  pageName?: string;
  /** Additional schema properties to merge */
  additionalSchema?: Record<string, unknown>;
  /** Include Review schemas (default: false, enable on homepage/reviews) */
  includeReviews?: boolean;
  // `includeHowTo` and `includeServices` were removed 2026-09-07. Neither was
  // ever read: no HowTo node has been emitted anywhere (repo-wide grep for
  // "@type": "HowTo" = 0 files) and hasOfferCatalog is emitted unconditionally
  // below. Five call sites passed them believing they did something; Google
  // retired the HowTo rich result on 2023-09-13 anyway. A prop that promises a
  // schema and emits nothing is a lie the next reader has to disprove.
}

export default function LocalBusinessSchema({
  additionalSchema,
  includeReviews = false,
}: Props) {
  const { data: googleData } = trpc.reviews.google.useQuery(undefined, { staleTime: 60 * 60 * 1000, retry: 1 });
  const reviewRating = googleData?.rating ?? BUSINESS.reviews.rating;
  const reviewCountDisplay = `${(googleData?.totalReviews ?? BUSINESS.reviews.count).toLocaleString("en-US")}+`;

  // Derive opening hours from the single source of truth so the schema can't
  // drift from BUSINESS.hours (structured values are "HH:MM-HH:MM").
  const [monSatOpen, monSatClose] = BUSINESS.hours.structured.monday.split("-");
  const [sunOpen, sunClose] = BUSINESS.hours.structured.sunday.split("-");
  const schema = {
    "@context": "https://schema.org",
    "@type": ["AutoRepair", "TireShop"],
    // One canonical name for the shared @id — see the pageName deprecation note.
    name: BUSINESS.name,
    // 2026-05-06 cannibalization deep fix · explicit brand-name variants
    // for Google's knowledge graph. Without this, "nicks tires" / "nick
    // tire" / "nicks tire and auto" can match different pages because
    // the brand identity isn't normalized to one entity. With these,
    // all variants resolve to / as the canonical brand home.
    alternateName: [
      "Nicks Tire",
      "Nick's Tire",
      "Nicks Tires",
      "Nick's Tires",
      "Nicks Tire and Auto",
      "Nick's Tire and Auto",
      "Nicks Tire & Auto",
      "Nicks Auto",
      "Nick's Auto",
      // Former name — this shop WAS Moe's Tire & Auto on the same Euclid corner.
      // Listing it as an alternateName helps Google/AI resolve "Moe's Tire"
      // searches to this (now Nick's) entity, reinforcing the /moes-* bridge
      // pages. Not an ownership claim (the truth guard forbids "run by Moe").
      "Moe's Tire & Auto",
      "Moe's Tire",
      "Moes Tire",
      "Moes Tire and Auto",
      "Moe's Tire Euclid",
    ],
    // wave-145 — was favicon.ico (16×16). Google rich-result spec requires
    // an image at least 696px wide; favicon FAILS validation and suppresses
    // LocalBusiness rich results across every page that renders this schema.
    // Now: the same shop-exterior hero image used as the OG default in SEO.tsx
    // (1200px+ wide, optimized webp). Consistent with the OG signal.
    image: `${BUSINESS.urls.website}/photos/shop-exterior-hero-wide-sign-bays.webp`,
    "@id": `${BUSINESS.urls.website}/#localbusiness`,
    telephone: `+1-${BUSINESS.phone.dashed}`,
    url: BUSINESS.urls.website,
    email: "info@nickstire.org",
    foundingDate: String(BUSINESS.founded.year),
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
        opens: monSatOpen,
        closes: monSatClose,
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "Sunday",
        opens: sunOpen,
        closes: sunClose,
      },
    ],
    paymentAccepted: "Cash, Visa, Mastercard, Discover, American Express, Debit Cards, Acima, Snap Finance, Koalafi, American First Finance",
    currenciesAccepted: "USD",
    // Self-serving aggregateRating on your OWN LocalBusiness is ineligible for
    // star rich results (Google policy), and emitting it on pages with NO
    // visible reviews risks a manual action. Only emit where reviews are shown
    // (includeReviews) — Home + the Reviews page — not site-wide on ~40 pages.
    //
    // ratingValue/reviewCount here MUST stay on the static BUSINESS.reviews
    // floor, matching ReviewsPage.tsx's own aggregateRating block exactly —
    // NOT the live reviewRating/reviewCountDisplay used elsewhere in this
    // file's `description` text below. Per ReviewsPage.tsx's 2026-08-19 fix
    // comment: this component and ReviewsPage.tsx both emit aggregateRating
    // for the SAME @id entity on the Reviews page, and prerendered JSON-LD is
    // baked at build/regen time regardless — a live number here doesn't stay
    // "live" for a crawler anyway, it just risks disagreeing with the OTHER
    // schema block on the same page (previously 1706 vs 1700 for the same
    // entity). One static value in both places; the floor understates
    // slightly, which is the safe direction.
    ...(includeReviews
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: BUSINESS.reviews.rating,
            reviewCount: BUSINESS.reviews.count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
    priceRange: "$$",
    sameAs: [...BUSINESS.sameAs],
    hasMap: `https://www.google.com/maps?cid=${GBP_CID}`,
    areaServed: BUSINESS.serviceAreas.map((area) => ({
      "@type": "City",
      name: area,
    })),
    description:
      `Cleveland's Euclid Ave new and used tire shop and full-service auto repair. Buy tires online with free install package — mount, balance, valve stems, alignment check. Brake, check-engine, Ohio E-Check, alignment, AC, transmission, electrical, exhaust. ${reviewRating} stars across ${reviewCountDisplay} reviews. Walk-ins 7 days, payment programs from four providers.`,
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
      "Auto repair payment programs",
      "Winter tire installation Cleveland",
      "Pothole damage repair Cleveland",
    ],
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Auto Repair & Tire Services",
      itemListElement: [
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "New Tire Sales & Installation", description: "Free install package with every tire purchase." },
          priceSpecification: { "@type": "PriceSpecification", priceCurrency: "USD", description: "Installation FREE with tire purchase" },
        },
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "Used Tires", description: "Checked used tires from $25 installed (12-inch rims; most sizes $40-80). 4-point check: tread, sidewall, DOT date, plug history." },
          priceSpecification: { "@type": "PriceSpecification", priceCurrency: "USD", minPrice: "25" },
        },
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "Flat Tire Repair", description: "Professional plug-and-patch repair in 15 minutes." },
          priceSpecification: { "@type": "PriceSpecification", priceCurrency: "USD", minPrice: "25", description: "Flat repair from $25 typical" },
        },
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "Brake Repair", description: "Pads, rotors, calipers, ABS. Free brake check." },
          priceSpecification: { "@type": "PriceSpecification", priceCurrency: "USD", description: "Free check · written quote · you don't pay until you say yes" },
        },
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "Oil Change — Conventional", description: "With filter, 20-point check, and tire pressure check." },
          priceSpecification: { "@type": "PriceSpecification", priceCurrency: "USD", minPrice: "49", description: "Conventional oil change from $49" },
        },
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "Oil Change — Full Synthetic", description: "Mobil 1, Pennzoil Platinum, or equivalent." },
          priceSpecification: { "@type": "PriceSpecification", priceCurrency: "USD", minPrice: "80", description: "Full synthetic oil change from $80" },
        },
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "Engine Diagnostics", description: "OBD-II code reading + live data, fee credited toward repair if you say yes." },
          priceSpecification: { "@type": "PriceSpecification", priceCurrency: "USD", description: "Check fee credited toward repair · free if we do the work" },
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
      { "@type": "PropertyValue", name: "partsWarranty", value: "1 year" },
      { "@type": "PropertyValue", name: "laborWarranty", value: "90 days" },
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
      {/* wave-145 — removed 3 <link rel="alternate" type="application/ld+json">
          entries. Google does NOT recognize this pattern (only inline
          <script type="application/ld+json"> or src-loaded scripts count for
          structured data discovery). The referenced files
          (/howto-schemas.json, /reviews-schema.json, /services-schema.json,
          plus /business-data.json) DID still exist in client/public/ — this
          comment claimed they 404'd, they served 200 — and had drifted from
          canon (city "Euclid", 1,700 self-reported reviews, generic-named
          review quotes). Deleted 2026-09-07; this component is the one
          structured-data source. If we ever want supplemental schema graphs,
          inline them into the main script block above or emit them as
          separate inline <script> tags per page. */}
    </>
  );
}
