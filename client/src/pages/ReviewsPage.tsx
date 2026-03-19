/**
 * Reviews Showcase Page — /reviews
 * Pulls live Google reviews, displays with star filters, featured highlights,
 * and prominent "Leave a Review" CTA linking to GBP.
 */

import InternalLinks from "@/components/InternalLinks";
import PageLayout from "@/components/PageLayout";
import { useState, useRef, useMemo } from "react";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { Phone, MapPin, Star, ExternalLink, Filter, MessageSquare, ThumbsUp, Quote, ChevronDown } from "lucide-react";
import { motion, useInView, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { GBP_REVIEW_URL, GBP_PLACE_URL } from "@shared/const";
import { BUSINESS } from "@shared/business";
import { QueryError } from "@/components/QueryState";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp";

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

// ─── NAVBAR ────────────────────────────────────────────


// ─── MOBILE CTA ────────────────────────────────────────


// ─── STAR RATING DISPLAY ───────────────────────────────
function StarRating({ rating, size = "md" }: { rating: number; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "sm" ? "w-4 h-4" : size === "lg" ? "w-6 h-6" : "w-5 h-5";
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`${sizeClass} ${i <= rating ? "fill-nick-yellow text-nick-yellow" : "fill-border/30 text-border/30"}`}
        />
      ))}
    </div>
  );
}

// ─── REVIEW CARD ───────────────────────────────────────
function ReviewCard({ review, featured = false }: { review: { authorName: string; rating: number; text: string; relativeTime: string }; featured?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = review.text.length > 200;

  return (
    <div className={`${featured ? "col-span-1 lg:col-span-2 bg-gradient-to-br from-nick-yellow/5 via-card/80 to-nick-blue/30 border-nick-yellow/20" : "bg-card/80 border-border/30"} border rounded-lg p-6 lg:p-8 relative group`}>
      {featured && (
        <div className="absolute top-4 right-4 bg-nick-yellow/10 border border-nick-yellow/30 rounded-full px-3 py-1">
          <span className="font-mono text-[10px] text-nick-yellow tracking-wider uppercase">Featured</span>
        </div>
      )}

      <div className="flex items-start gap-4 mb-4">
        <div className="w-10 h-10 rounded-full bg-nick-yellow/10 flex items-center justify-center shrink-0">
          <span className="font-semibold font-bold text-nick-yellow text-sm">
            {review.authorName.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold font-bold text-foreground tracking-wider text-sm truncate">
            {review.authorName.toUpperCase()}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            <StarRating rating={review.rating} size="sm" />
            <span className="font-mono text-xs text-foreground/40">{review.relativeTime}</span>
          </div>
        </div>
      </div>

      <div className="relative">
        <Quote className="absolute -top-1 -left-1 w-6 h-6 text-nick-yellow/10" />
        <p className={`text-foreground/70 leading-relaxed text-sm pl-6 ${!expanded && isLong ? "line-clamp-4" : ""}`}>
          {review.text}
        </p>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-2 pl-6 font-mono text-xs text-nick-blue-light hover:text-nick-yellow transition-colors flex items-center gap-1"
          >
            {expanded ? "Show less" : "Read more"}
            <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-border/20 flex items-center gap-2">
        <img
          src="https://www.google.com/favicon.ico"
          alt="Google"
          className="w-4 h-4"
          loading="lazy"
        />
        <span className="font-mono text-[10px] text-foreground/30 tracking-wider uppercase">Google Review</span>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ─────────────────────────────────────────
export default function ReviewsPage() {
  const { data: reviewData, isLoading , isError, error } = trpc.reviews.google.useQuery();
  const [starFilter, setStarFilter] = useState<number | null>(null);

  // Separate featured reviews (5-star, longest text) from the rest
  const { featured, filtered } = useMemo(() => {
    if (!reviewData?.reviews) return { featured: [], filtered: [] };

    const allReviews = [...reviewData.reviews];

    // Sort by text length for featured selection (longest 5-star reviews)
    const fiveStarReviews = allReviews
      .filter((r) => r.rating === 5)
      .sort((a, b) => b.text.length - a.text.length);

    const featuredReviews = fiveStarReviews.slice(0, 2);
    const featuredTexts = new Set(featuredReviews.map((r) => r.text));

    const remaining = allReviews.filter((r) => !featuredTexts.has(r.text));

    // Apply star filter
    const filteredReviews = starFilter
      ? remaining.filter((r) => r.rating === starFilter)
      : remaining;

    return {
      featured: starFilter ? [] : featuredReviews,
      filtered: filteredReviews,
    };
  }, [reviewData, starFilter]);

  // Rating distribution
  const distribution = useMemo(() => {
    if (!reviewData?.reviews) return {};
    const dist: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    reviewData.reviews.forEach((r) => {
      dist[r.rating] = (dist[r.rating] || 0) + 1;
    });
    return dist;
  }, [reviewData]);

  // JSON-LD for reviews page
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
      ratingValue: reviewData?.rating || 4.9,
      reviewCount: reviewData?.totalReviews || 1685,
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
        title="Customer Reviews — Nick's Tire & Auto | Cleveland Auto Repair"
        description={`Read real Google reviews from Cleveland drivers. Nick's Tire & Auto is rated 4.9 stars with ${BUSINESS.reviews.countDisplay} reviews. Honest diagnostics, fair prices, and trusted auto repair.`}
        canonicalPath="/reviews"
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(reviewSchema) }}
      />

      
      <main id="main-content">
        {/* Hero Section */}
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
              <div className="mt-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
                <div>
                  <span className="font-mono text-nick-blue-light text-sm tracking-wide">Real Customers, Real Words</span>
                  <h1 className="font-semibold font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground leading-[0.95] tracking-tight mt-2">
                    WHAT <span className="text-gradient-yellow">CLEVELAND</span><br />
                    DRIVERS SAY
                  </h1>
                  <p className="mt-4 text-foreground/60 text-lg max-w-xl leading-relaxed">
                    We do not write our own reviews. Every word below comes directly from Google — real drivers sharing their real experiences at our shop.
                  </p>
                </div>

                {/* Rating Summary Card */}
                <div className="bg-card/80 border border-nick-yellow/20 rounded-lg p-6 lg:p-8 text-center shrink-0">
                  <div className="font-semibold font-bold text-6xl text-nick-yellow leading-none">
                    {reviewData?.rating || "4.9"}
                  </div>
                  <div className="flex justify-center mt-2">
                    <StarRating rating={Math.round(reviewData?.rating || 4.9)} size="lg" />
                  </div>
                  <p className="font-mono text-sm text-foreground/60 mt-2">
                    {(reviewData?.totalReviews || 1685).toLocaleString()}+ Reviews
                  </p>
                  <a
                    href={GBP_PLACE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-3 font-mono text-xs text-nick-blue-light hover:text-nick-yellow transition-colors"
                  >
                    <img src="https://www.google.com/favicon.ico" alt="Google" className="w-3.5 h-3.5" loading="lazy" />
                    View on Google
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Leave a Review CTA Banner */}
        <section className="section-darker">
          
          <div className="container py-8">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-nick-yellow/10 flex items-center justify-center">
                  <MessageSquare className="w-6 h-6 text-nick-yellow" />
                </div>
                <div>
                  <h2 className="font-semibold font-bold text-foreground tracking-wider text-lg">
                    HAD A GREAT EXPERIENCE?
                  </h2>
                  <p className="text-foreground/50 text-sm">
                    Your review helps other Cleveland drivers find honest auto repair.
                  </p>
                </div>
              </div>
              <a
                href={GBP_REVIEW_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-nick-yellow text-nick-dark px-8 py-4 rounded-md font-semibold font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors shrink-0"
              >
                <Star className="w-5 h-5" />
                LEAVE A REVIEW
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        </section>

        {/* Rating Distribution + Filter */}
        <section className="section-dark py-12">
          <div className="container">
            <FadeIn>
              <div className="flex flex-col lg:flex-row gap-8 items-start">
                {/* Rating Distribution Bars */}
                <div className="w-full lg:w-80 bg-card/60 border border-border/30 rounded-lg p-6 shrink-0">
                  <h3 className="font-semibold font-bold text-foreground tracking-wider text-sm uppercase mb-4 flex items-center gap-2">
                    <Filter className="w-4 h-4 text-nick-blue-light" />
                    Rating Breakdown
                  </h3>
                  {[5, 4, 3, 2, 1].map((stars) => {
                    const count = distribution[stars] || 0;
                    const total = reviewData?.reviews?.length || 1;
                    const pct = Math.round((count / total) * 100);
                    const isActive = starFilter === stars;

                    return (
                      <button
                        key={stars}
                        onClick={() => setStarFilter(isActive ? null : stars)}
                        className={`w-full flex items-center gap-3 py-2 px-2 rounded-md transition-all ${isActive ? "bg-nick-yellow/10 ring-1 ring-nick-yellow/30" : "hover:bg-card/80"}`}
                      >
                        <span className="font-mono text-xs text-foreground/60 w-6">{stars}</span>
                        <Star className="w-3.5 h-3.5 fill-nick-yellow text-nick-yellow shrink-0" />
                        <div className="flex-1 h-2 bg-border/20 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-nick-yellow rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs text-foreground/40 w-8 text-right">{count}</span>
                      </button>
                    );
                  })}

                  {starFilter && (
                    <button
                      onClick={() => setStarFilter(null)}
                      className="w-full mt-3 py-2 border border-nick-blue/30 rounded-md font-mono text-xs text-nick-blue-light hover:bg-nick-blue/10 transition-colors tracking-wider uppercase"
                    >
                      Clear Filter
                    </button>
                  )}
                </div>

                {/* Reviews Grid */}
                <div className="flex-1 w-full">
                  {starFilter && (
                    <div className="mb-4 flex items-center gap-2">
                      <span className="font-mono text-xs text-foreground/50 tracking-wider uppercase">
                        Showing {starFilter}-star reviews
                      </span>
                      <span className="font-mono text-xs text-nick-yellow">
                        ({filtered.length} {filtered.length === 1 ? "review" : "reviews"})
                      </span>
                    </div>
                  )}

                  {isError ? (
              <QueryError message="Failed to load data. Please try again." onRetry={() => window.location.reload()} />
            ) : isLoading ? (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="bg-card/40 border border-border/20 rounded-lg p-8 animate-pulse">
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
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Featured Reviews */}
                      <AnimatePresence>
                        {featured.map((review, i) => (
                          <motion.div
                            key={`featured-${review.authorName}-${i}`}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ delay: i * 0.1 }}
                          >
                            <ReviewCard review={review} featured />
                          </motion.div>
                        ))}

                        {/* Regular Reviews */}
                        {filtered.map((review, i) => (
                          <motion.div
                            key={`review-${review.authorName}-${i}`}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ delay: (featured.length + i) * 0.05 }}
                          >
                            <ReviewCard review={review} />
                          </motion.div>
                        ))}
                      </AnimatePresence>

                      {filtered.length === 0 && !isLoading && (
                        <div className="col-span-2 text-center py-12">
                          <Star className="w-12 h-12 text-border/30 mx-auto mb-4" />
                          <p className="font-semibold text-foreground/40 tracking-wider">
                            No {starFilter}-star reviews to show
                          </p>
                          <button
                            onClick={() => setStarFilter(null)}
                            className="mt-3 font-mono text-xs text-nick-blue-light hover:text-nick-yellow transition-colors"
                          >
                            Show all reviews
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Trust Stats Section */}
        <section className="section-darker py-16">
          <div className="container">
            <FadeIn>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                  { value: "4.9", label: "Google Rating", icon: <Star className="w-6 h-6" /> },
                  { value: `${((reviewData?.totalReviews || 1685) / 1000).toFixed(1)}K+`, label: "Total Reviews", icon: <MessageSquare className="w-6 h-6" /> },
                  { value: "Same Day", label: "Most Repairs", icon: <ThumbsUp className="w-6 h-6" /> },
                  { value: "Since '18", label: "Serving Cleveland", icon: <MapPin className="w-6 h-6" /> },
                ].map((stat, _i) => (
                  <div key={stat.label} className="text-center">
                    <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-nick-yellow/10 flex items-center justify-center text-nick-yellow">
                      {stat.icon}
                    </div>
                    <div className="font-semibold font-bold text-3xl lg:text-4xl text-foreground">{stat.value}</div>
                    <p className="font-mono text-xs text-foreground/50 tracking-wider uppercase mt-1">{stat.label}</p>
                  </div>
                ))}
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="section-dark py-20 lg:py-28">
          
          <div className="container pt-16 text-center">
            <FadeIn>
              <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground tracking-tight">
                READY TO <span className="text-gradient-yellow">EXPERIENCE IT</span>?
              </h2>
              <p className="mt-4 text-foreground/60 text-lg max-w-xl mx-auto">
                Join thousands of Cleveland drivers who trust Nick's Tire & Auto. Call for a free estimate or book online.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
                <a
                  href={BUSINESS.phone.href}
                  onClick={() => trackPhoneClick("reviews-bottom-cta")}
                  className="inline-flex items-center justify-center gap-2 bg-nick-yellow text-nick-dark px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wider uppercase hover:bg-nick-gold transition-colors"
                >
                  <Phone className="w-5 h-5" />
                  CALL {BUSINESS.phone.display}
                </a>
                <a
                  href={GBP_REVIEW_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 border-2 border-nick-blue/50 text-nick-blue-light px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wider uppercase hover:bg-nick-blue/10 hover:border-nick-blue transition-colors"
                >
                  <Star className="w-5 h-5" />
                  LEAVE A REVIEW
                </a>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Footer */}
        
      </main>

      
      <InternalLinks title="Explore Our Services" />
    </PageLayout>
  );
}
