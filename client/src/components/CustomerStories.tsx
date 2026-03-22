/**
 * CustomerStories — Horizontal carousel of customer testimonials.
 * Auto-advances every 5s, pauses on hover/touch.
 * Accessible: keyboard navigable, aria labels, dot indicators.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import { BUSINESS } from "@shared/business";
import { ACIMA_STATES_EXCLUDED, trackAcimaClick, buildAcimaUrl } from "@/lib/acima";

// Stories inspired by real customer experiences. Names changed for privacy. Individual results vary.
const CUSTOMER_STORIES = [
  {
    id: 1,
    name: "Maria R.",
    vehicle: "2019 Toyota Camry",
    service: "Brakes + Rotors",
    quote:
      "I was quoted $800 at the dealership. Nick's did it for $389 and I put $10 down with Acima. Drove home same day.",
    rating: 5,
    acima: true,
  },
  {
    id: 2,
    name: "James T.",
    vehicle: "2017 Ford F-150",
    service: "4 New Tires + Alignment",
    quote:
      "Best tire prices in Cleveland, hands down. They didn't try to upsell me on anything. Just honest work.",
    rating: 5,
    acima: false,
  },
  {
    id: 3,
    name: "Destiny W.",
    vehicle: "2020 Honda Civic",
    service: "A/C Repair",
    quote:
      "My A/C went out in July. They got me in same day, no appointment. $10 down through Acima and I was back on the road.",
    rating: 5,
    acima: true,
  },
  {
    id: 4,
    name: "Carlos M.",
    vehicle: "2016 Chevy Malibu",
    service: "Engine Diagnostics + Repair",
    quote:
      "Check engine light had me stressed. They diagnosed it, explained everything, no pressure. Fixed it for half what I expected.",
    rating: 5,
    acima: false,
  },
  {
    id: 5,
    name: "Angela P.",
    vehicle: "2021 Hyundai Tucson",
    service: "Struts + Alignment",
    quote:
      "I'm a single mom, money's tight. Nick's worked with me on the price and set me up with Acima. No judgment, just help.",
    rating: 5,
    acima: true,
  },
] as const;

function StoryCard({ story }: { story: (typeof CUSTOMER_STORIES)[number] }) {
  return (
    <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6 sm:p-8 h-full flex flex-col">
      {/* Stars */}
      <div className="flex gap-0.5 mb-4">
        {[...Array(story.rating)].map((_, i) => (
          <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
        ))}
      </div>

      {/* Quote */}
      <blockquote className="text-foreground/80 text-[15px] leading-relaxed flex-1">
        "{story.quote}"
      </blockquote>

      {/* Attribution */}
      <div className="mt-5 pt-4 border-t border-[oklch(0.17_0.004_260)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-foreground text-sm">{story.name}</p>
            <p className="text-foreground/30 text-xs mt-0.5">{story.vehicle}</p>
          </div>
          <span className="text-xs font-medium text-primary/70 bg-primary/5 border border-primary/10 rounded-md px-2 py-1">
            {story.service}
          </span>
        </div>

        {story.acima && (
          <a
            href={buildAcimaUrl("customer_story_badge")}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.stopPropagation();
              trackAcimaClick("customer_story_acima_badge");
            }}
            className="inline-flex items-center gap-1.5 mt-3 text-[11px] font-medium text-emerald-400/70 bg-emerald-500/5 border border-emerald-500/10 rounded-full px-2.5 py-1 hover:bg-emerald-500/10 transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Used Acima lease-to-own
          </a>
        )}
      </div>
    </div>
  );
}

export default function CustomerStories() {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const total = CUSTOMER_STORIES.length;

  const goTo = useCallback(
    (index: number) => {
      setCurrent(((index % total) + total) % total);
    },
    [total],
  );

  const next = useCallback(() => goTo(current + 1), [current, goTo]);
  const prev = useCallback(() => goTo(current - 1), [current, goTo]);

  // Auto-advance every 5s, pause on hover
  useEffect(() => {
    if (paused) return;
    timerRef.current = setInterval(next, 5000);
    return () => clearInterval(timerRef.current);
  }, [next, paused]);

  return (
    <section
      className="py-20 bg-[oklch(0.055_0.004_260)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
      aria-label="Customer stories carousel"
    >
      <div className="container max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h2 className="text-3xl lg:text-4xl font-bold text-foreground tracking-tight">
            What Our Customers Say
          </h2>
          <p className="text-foreground/40 text-sm mt-2">
            Real stories from Nick's customers in Cleveland
          </p>
        </div>

        {/* Carousel */}
        <div className="relative">
          {/* Arrow nav — desktop */}
          <button
            onClick={prev}
            className="hidden sm:flex absolute -left-12 top-1/2 -translate-y-1/2 w-9 h-9 items-center justify-center rounded-full border border-border/30 text-foreground/30 hover:text-foreground/60 hover:border-foreground/30 transition-colors z-10"
            aria-label="Previous story"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={next}
            className="hidden sm:flex absolute -right-12 top-1/2 -translate-y-1/2 w-9 h-9 items-center justify-center rounded-full border border-border/30 text-foreground/30 hover:text-foreground/60 hover:border-foreground/30 transition-colors z-10"
            aria-label="Next story"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* Card */}
          <AnimatePresence mode="wait">
            <motion.div
              key={current}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              <StoryCard story={CUSTOMER_STORIES[current]} />
            </motion.div>
          </AnimatePresence>

          {/* Dot indicators */}
          <div className="flex justify-center gap-2 mt-6" role="tablist" aria-label="Story indicators">
            {CUSTOMER_STORIES.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                role="tab"
                aria-selected={i === current}
                aria-label={`Story ${i + 1}`}
                className={`w-2 h-2 rounded-full transition-all duration-300 ${
                  i === current
                    ? "bg-primary w-6"
                    : "bg-foreground/15 hover:bg-foreground/30"
                }`}
              />
            ))}
          </div>

          {/* Mobile swipe hint */}
          <p className="sm:hidden text-center text-foreground/20 text-[11px] mt-3">
            Use arrows or dots to navigate
          </p>
        </div>

        {/* CTA */}
        <div className="text-center mt-10">
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 bg-foreground text-background px-8 py-3.5 rounded-full font-medium text-sm hover:bg-foreground/90 transition-colors"
          >
            Join {BUSINESS.reviews.countDisplay} happy customers → Book Your Service
          </Link>
        </div>

        {/* Disclaimer */}
        <p className="text-[10px] text-foreground/20 text-center mt-6 max-w-md mx-auto leading-relaxed">
          Stories inspired by real customer experiences. Individual results and lease terms vary.
          Acima lease-to-own is not available in {ACIMA_STATES_EXCLUDED}.
        </p>
      </div>
    </section>
  );
}
