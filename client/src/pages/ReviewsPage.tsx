/**
 * Reviews Showcase Page — /reviews
 * Pulls live Google reviews, displays in masonry grid with filters,
 * gold initial avatars, keyword highlighting, and sort options.
 */

import InternalLinks from "@/components/InternalLinks";
import PageLayout from "@/components/PageLayout";
import { useState, useRef, useMemo, useCallback } from "react";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { Phone, Star, ExternalLink, MessageSquare, ChevronDown } from "lucide-react";
import { motion, useInView, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { GBP_REVIEW_URL, GBP_PLACE_URL } from "@shared/const";
import { BUSINESS } from "@shared/business";
import { QueryError } from "@/components/QueryState";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp";

// Service-related keywords to highlight in gold
const SERVICE_KEYWORDS = [
  "tires", "tire", "brakes", "brake", "oil change", "oil changes",
  "diagnostics", "diagnostic", "check engine", "emissions", "e-check",
  "alignment", "transmission", "electrical", "exhaust", "muffler",
  "ac repair", "a/c", "battery", "alternator", "starter",
  "general repair", "repair", "mechanic", "inspection",
  "honest", "fair price", "affordable", "trust", "trustworthy",
];

const SERVICE_TYPES = ["All", "Tires", "Brakes", "Oil Change", "Diagnostics", "Other"] as const;
type ServiceType = (typeof SERVICE_TYPES)[number];

const RECENCY_OPTIONS = ["Most Recent", "Last 30 Days", "Last 90 Days"] as const;
type RecencyOption = (typeof RECENCY_OPTIONS)[number];

const SORT_OPTIONS = ["Most Recent", "Highest Rated"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

// ─── SERVICE TYPE DETECTION ───────────────────────────
function detectServiceType(text: string): ServiceType {
  const lower = text.toLowerCase();
  if (/\btires?\b|tire\s*(change|install|replacement|mount|balance|rotation|flat)/i.test(lower)) return "Tires";
  if (/\bbrakes?\b|brake\s*(pad|rotor|service|repair|job)/i.test(lower)) return "Brakes";
  if (/\boil\s*change/i.test(lower)) return "Oil Change";
  if (/\bdiagnostic|check\s*engine|e-?check|emission|code\s*read/i.test(lower)) return "Diagnostics";
  return "Other";
}

// ─── KEYWORD HIGHLIGHTING ─────────────────────────────
function highlightKeywords(text: string): React.ReactNode[] {
  const escapedKeywords = SERVICE_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escapedKeywords.join("|")})`, "gi");
  const parts = text.split(pattern);

  return parts.map((part, i) => {
    if (pattern.test(part)) {
      return (
        <span key={i} className="text-[#FDB913] font-medium">
          {part}
        </span>
      );
    }
    return part;
  });
}

// ─── FADE IN ──────────────────────────────────────────
function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── STAR RATING DISPLAY ──────────────────────────────
function StarRating({ rating, size = "md" }: { rating: number; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "sm" ? "w-4 h-4" : size === "lg" ? "w-6 h-6" : "w-5 h-5";
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`${sizeClass} ${i <= rating ? "fill-[#FDB913] text-[#FDB913]" : "fill-border/30 text-border/30"}`}
        />
      ))}
    </div>
  );
}

// ─── PILL TOGGLE BUTTON ───────────────────────────────
function PillButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap ${
        active
          ? "bg-[#FDB913] text-black"
          : "bg-white/5 text-foreground/50 hover:bg-white/10 hover:text-foreground/70 border border-white/10"
      }`}
    >
      {children}
    </button>
  );
}

// ─── REVIEW CARD ──────────────────────────────────────
function ReviewCard({ review }: { review: { authorName: string; rating: number; text: string; relativeTime: string } }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = review.text.length > 200;

  return (
    <div className="bg-card/80 border border-border/30 rounded-lg p-6 break-inside-avoid mb-4">
      {/* Avatar + Name + Rating */}
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-[#FDB913] flex items-center justify-center shrink-0">
          <span className="font-bold text-white text-sm leading-none">
            {review.authorName.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground text-sm truncate">
            {review.authorName}
          </h3>
          <div className="flex items-center gap-2 mt-0.5">
            <StarRating rating={review.rating} size="sm" />
            <span className="text-[12px] text-foreground/40">{review.relativeTime}</span>
          </div>
        </div>
      </div>

      {/* Review Text with keyword highlighting */}
      <div className="relative">
        <p className={`text-foreground/70 leading-relaxed text-sm ${!expanded && isLong ? "line-clamp-4" : ""}`}>
          {highlightKeywords(review.text)}
        </p>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-2 text-[12px] text-[#FDB913] hover:text-[#FDB913]/80 transition-colors flex items-center gap-1"
          >
            {expanded ? "Show less" : "Read more"}
            <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {/* Google badge */}
      <div className="mt-4 pt-3 border-t border-border/20 flex items-center gap-2">
        <img src="https://www.google.com/favicon.ico" alt="Google" className="w-4 h-4" loading="lazy" />
        <span className="font-mono text-[10px] text-foreground/30 tracking-wide">Google Review</span>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────
export default function ReviewsPage() {
  const { data: reviewData, isLoading, isError } = trpc.reviews.google.useQuery(undefined, { staleTime: 60 * 60 * 1000 });

  const [serviceFilter, setServiceFilter] = useState<ServiceType>("All");
  const [starFilter, setStarFilter] = useState<number | null>(null);
  const [recencyFilter, setRecencyFilter] = useState<RecencyOption>("Most Recent");
  const [sortBy, setSortBy] = useState<SortOption>("Most Recent");

  const totalCount = reviewData?.totalReviews ?? 1700;
  const avgRating = reviewData?.rating ?? 4.9;

  // Filter and sort reviews
  const filteredReviews = useMemo(() => {
    if (!reviewData?.reviews) return [];
    let reviews = [...reviewData.reviews];

    // Service type filter
    if (serviceFilter !== "All") {
      reviews = reviews.filter((r) => detectServiceType(r.text) === serviceFilter);
    }

    // Star filter
    if (starFilter !== null) {
      reviews = reviews.filter((r) => r.rating === starFilter);
    }

    // Recency filter (approximate from relativeTime string)
    if (recencyFilter === "Last 30 Days") {
      reviews = reviews.filter((r) => {
        const t = r.relativeTime.toLowerCase();
        return t.includes("day") || t.includes("hour") || t.includes("minute") || t.includes("a week") || t.includes("weeks");
      });
    } else if (recencyFilter === "Last 90 Days") {
      reviews = reviews.filter((r) => {
        const t = r.relativeTime.toLowerCase();
        return (
          t.includes("day") || t.includes("hour") || t.includes("minute") ||
          t.includes("week") || t.includes("a month") || t.includes("2 month")
        );
      });
    }

    // Sort
    if (sortBy === "Highest Rated") {
      reviews.sort((a, b) => b.rating - a.rating || b.text.length - a.text.length);
    }
    // "Most Recent" is the default API order

    return reviews;
  }, [reviewData, serviceFilter, starFilter, recencyFilter, sortBy]);

  // JSON-LD schema
  const reviewSchema = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "Nick's Tire & Auto",
    image: HERO_IMG,
    address: {
      "@type": "PostalAddress",
      streetAddress: BUSINESS.address.street,
      addressLocality: "Cleveland",
      addressRegion: "OH",
      postalCode: "44112",
      addressCountry: "US",
    },
    telephone: `+1-${BUSINESS.phone.dashed}`,
    url: "https://nickstire.org",
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: avgRating,
      reviewCount: totalCount,
      bestRating: 5,
      worstRating: 1,
    },
    review: reviewData?.reviews?.slice(0, 5).map((r) => ({
      "@type": "Review",
      author: { "@type": "Person", name: r.authorName },
      reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5 },
      reviewBody: r.text,
    })),
  };

  return (
    <PageLayout activeHref="/reviews" showChat={true}>
      <SEOHead
        title="Customer Reviews | Nick's Tire & Auto Cleveland"
        description={`Read real Google reviews from Cleveland drivers. Nick's Tire & Auto is rated 4.9 stars with ${BUSINESS.reviews.countDisplay} reviews. Honest diagnostics, fair prices, and trusted auto repair.`}
        canonicalPath="/reviews"
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(reviewSchema) }}
      />

      <main id="main-content">
        {/* ─── HERO ─── */}
        <section className="relative min-h-[50vh] flex items-end overflow-hidden">
          <div className="absolute inset-0">
            <img src={HERO_IMG} alt="Nick's Tire & Auto shop" className="w-full h-full object-cover" loading="eager" />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/40" />
          </div>

          <div className="relative container pb-12 pt-32 lg:pb-16">
            <FadeIn>
              <Breadcrumbs items={[{ label: "Reviews" }]} />
            </FadeIn>

            <FadeIn delay={0.1}>
              <h1 className="font-heading text-4xl sm:text-5xl lg:text-7xl text-foreground leading-[0.95] tracking-tight mt-6 uppercase">
                Real Reviews from Real<br />
                <span className="text-[#FDB913]">Cleveland Drivers</span>
              </h1>
              <p className="mt-4 text-foreground/50 text-lg font-heading tracking-wide uppercase">
                {totalCount.toLocaleString()}+ reviews | {avgRating} average
              </p>
            </FadeIn>
          </div>
        </section>

        {/* ─── FILTER BAR ─── */}
        <section className="bg-[oklch(0.06_0.004_260)] border-y border-border/20 sticky top-0 z-30">
          <div className="container py-4">
            {/* Service type pills */}
            <div className="flex flex-wrap gap-2 mb-3">
              {SERVICE_TYPES.map((type) => (
                <PillButton
                  key={type}
                  active={serviceFilter === type}
                  onClick={() => setServiceFilter(type)}
                >
                  {type}
                </PillButton>
              ))}
            </div>

            {/* Star rating + recency + sort */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Star filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] text-foreground/40 mr-1">Stars:</span>
                {[5, 4, 3, 2, 1].map((s) => (
                  <button
                    key={s}
                    onClick={() => setStarFilter(starFilter === s ? null : s)}
                    className={`flex items-center gap-0.5 px-2.5 py-1 rounded-full text-xs transition-all ${
                      starFilter === s
                        ? "bg-[#FDB913] text-black font-medium"
                        : "bg-white/5 text-foreground/40 hover:bg-white/10 border border-white/10"
                    }`}
                  >
                    {s} <Star className="w-3 h-3 fill-current" />
                  </button>
                ))}
              </div>

              <div className="h-5 w-px bg-border/20 hidden sm:block" />

              {/* Recency */}
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] text-foreground/40 mr-1">Time:</span>
                {RECENCY_OPTIONS.map((opt) => (
                  <PillButton
                    key={opt}
                    active={recencyFilter === opt}
                    onClick={() => setRecencyFilter(opt)}
                  >
                    {opt}
                  </PillButton>
                ))}
              </div>

              <div className="h-5 w-px bg-border/20 hidden sm:block" />

              {/* Sort */}
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] text-foreground/40 mr-1">Sort:</span>
                {SORT_OPTIONS.map((opt) => (
                  <PillButton
                    key={opt}
                    active={sortBy === opt}
                    onClick={() => setSortBy(opt)}
                  >
                    {opt}
                  </PillButton>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ─── REVIEWS MASONRY GRID ─── */}
        <section className="bg-[oklch(0.065_0.004_260)] py-12 lg:py-16">
          <div className="container">
            {/* Results count */}
            <div className="mb-6 flex items-center justify-between">
              <p className="text-sm text-foreground/50">
                {isLoading ? "Loading reviews..." : `${filteredReviews.length} reviews`}
                {(serviceFilter !== "All" || starFilter !== null || recencyFilter !== "Most Recent") && (
                  <button
                    onClick={() => {
                      setServiceFilter("All");
                      setStarFilter(null);
                      setRecencyFilter("Most Recent");
                    }}
                    className="ml-3 text-[#FDB913] text-xs hover:underline"
                  >
                    Clear all filters
                  </button>
                )}
              </p>
              <a
                href={GBP_REVIEW_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-[#FDB913] text-black px-5 py-2.5 rounded-md font-semibold text-sm tracking-wide hover:opacity-90 transition-colors"
              >
                <Star className="w-4 h-4" />
                Leave a Review
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            {isError ? (
              <QueryError message="Failed to load reviews. Please try again." onRetry={() => window.location.reload()} />
            ) : isLoading ? (
              <div className="columns-1 md:columns-2 lg:columns-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="bg-card/40 border border-border/20 rounded-lg p-6 mb-4 break-inside-avoid animate-pulse">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full bg-border/20" />
                      <div className="space-y-2 flex-1">
                        <div className="h-3 bg-border/20 rounded w-1/3" />
                        <div className="h-2 bg-border/20 rounded w-1/4" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="h-2 bg-border/20 rounded w-full" />
                      <div className="h-2 bg-border/20 rounded w-5/6" />
                      <div className="h-2 bg-border/20 rounded w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredReviews.length === 0 ? (
              <div className="text-center py-16">
                <Star className="w-12 h-12 text-border/30 mx-auto mb-4" />
                <p className="font-semibold text-foreground/40 tracking-wider">
                  No reviews match your filters
                </p>
                <button
                  onClick={() => {
                    setServiceFilter("All");
                    setStarFilter(null);
                    setRecencyFilter("Most Recent");
                  }}
                  className="mt-3 text-sm text-[#FDB913] hover:underline"
                >
                  Clear all filters
                </button>
              </div>
            ) : (
              <div className="columns-1 md:columns-2 lg:columns-3 gap-4">
                <AnimatePresence>
                  {filteredReviews.map((review, i) => (
                    <motion.div
                      key={`review-${review.authorName}-${i}`}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ delay: Math.min(i * 0.03, 0.5) }}
                    >
                      <ReviewCard review={review} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </section>

        {/* ─── BOTTOM CTA ─── */}
        <section className="bg-[oklch(0.055_0.004_260)] py-20 lg:py-28">
          <div className="container text-center">
            <FadeIn>
              <h2 className="font-heading text-3xl lg:text-5xl text-foreground tracking-tight uppercase">
                Ready to <span className="text-[#FDB913]">Experience It</span>?
              </h2>
              <p className="mt-4 text-foreground/60 text-lg max-w-xl mx-auto">
                Join thousands of Cleveland drivers who trust Nick's Tire & Auto. Call for a free estimate or book online.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
                <a
                  href={BUSINESS.phone.href}
                  onClick={() => trackPhoneClick("reviews-bottom-cta")}
                  className="inline-flex items-center justify-center gap-2 bg-[#FDB913] text-black px-8 py-4 rounded-md font-bold text-lg tracking-wide hover:opacity-90 transition-colors"
                >
                  <Phone className="w-5 h-5" />
                  CALL {BUSINESS.phone.display}
                </a>
                <a
                  href={GBP_REVIEW_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 border-2 border-foreground/20 text-foreground/70 px-8 py-4 rounded-md font-bold text-lg tracking-wide hover:bg-foreground/5 transition-colors"
                >
                  <Star className="w-5 h-5" />
                  LEAVE A REVIEW
                </a>
              </div>
            </FadeIn>
          </div>
        </section>
      </main>

      <InternalLinks title="Explore Our Services" />
    </PageLayout>
  );
}
