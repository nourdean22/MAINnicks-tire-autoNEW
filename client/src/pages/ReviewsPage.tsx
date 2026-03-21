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
import FadeIn from "@/components/FadeIn";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp";

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
          className={`${sizeClass} ${i <= rating ? "fill-nick-yellow text-primary" : "fill-border/30 text-border/30"}`}
        />
      ))}
    </div>
  );

// ─── REVIEW CARD ───────────────────────────────────────
function ReviewCard({ review, featured = false }: { review: { authorName: string; rating: number; text: string; relativeTime: string }; featured?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = review.text.length > 200;

  return (
    <div className={`${featured ? "col-span-1 lg:col-span-2 bg-gradient-to-br from-nick-yellow/5 via-card/80 to-nick-blue/30 border-primary/20" : "bg-card/80 border-border/30"} border rounded-lg p-6 lg:p-8 relative group`}>
      {featured && (
        <div className="absolute top-4 right-4 bg-primary/10 border border-primary/30 rounded-full px-3 py-1">
          <span className="font-mono text-[10px] text-primary tracking-wide">Featured</span>
        </div>
      )}

      <div className="flex items-start gap-4 mb-4">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <span className="font-semibold font-bold text-primary text-sm">
            {review.authorName.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold font-bold text-foreground tracking-wider text-sm truncate">
            {review.authorName.toUpperCase()}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            <StarRating rating={review.rating} size="sm" />
            <span className="text-[12px] text-foreground/40">{review.relativeTime}</span>
          </div>
        </div>
      </div>

      <div className="relative">
        <Quote className="absolute -top-1 -left-1 w-6 h-6 text-primary/10" />
        <p className={`text-foreground/70 leading-relaxed text-sm pl-6 ${!expanded && isLong ? "line-clamp-4" : ""}`}>
          {review.text}
        </p>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-2 pl-6 text-[12px] text-nick-blue-light hover:text-primary transition-colors flex items-center gap-1"
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
        <span className="font-mono text-[10px] text-foreground/30 tracking-wide">Google Review</span>
      </div>
    </div>
  );

// ─── MAIN PAGE ─────────────────────────────────────────
export default function ReviewsPage() {
  const { data: reviewData, isLoading , isError, error } = trpc.reviews.google.useQuery(undefined, { staleTime: 60 * 60 * 1000 });
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

}
