/**
 * StickyTrustBar — Appears below navbar after scrolling past hero.
 * Shows key trust signals: rating, reviews, established year, same-day.
 * Dismissable on mobile.
 */

import { useState, useEffect } from "react";
import { X, Star } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { BUSINESS } from "@shared/business";
import { trpc } from "@/lib/trpc";

export default function StickyTrustBar() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const { data: googleData } = trpc.reviews.google.useQuery(undefined, {
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  const totalReviews = googleData?.totalReviews ?? BUSINESS.reviews.count;

  useEffect(() => {
    const onScroll = () => {
      // Show after scrolling past hero (~100vh)
      setVisible(window.scrollY > window.innerHeight * 0.8);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (dismissed) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="fixed top-[60px] left-0 right-0 z-40 bg-[oklch(0.09_0.005_260/0.95)] backdrop-blur-xl border-b border-primary/10"
        >
          <div className="container flex items-center justify-between h-10">
            <div className="flex items-center gap-4 sm:gap-6 text-xs sm:text-sm overflow-x-auto">
              <div className="flex items-center gap-1.5 shrink-0">
                <Star className="w-3.5 h-3.5 fill-nick-yellow text-primary" />
                <span className="text-foreground/70 font-medium">
                  {BUSINESS.reviews.rating} Stars
                </span>
              </div>
              <span className="w-px h-3.5 bg-foreground/10 shrink-0" />
              <span className="text-foreground/50 shrink-0">{totalReviews.toLocaleString()}+ Reviews</span>
              <span className="w-px h-3.5 bg-foreground/10 shrink-0 hidden sm:block" />
              <span className="text-foreground/50 shrink-0 hidden sm:block">Est. 2018</span>
              <span className="w-px h-3.5 bg-foreground/10 shrink-0 hidden sm:block" />
              <span className="text-foreground/50 shrink-0 hidden sm:block">Same-Day Service</span>
            </div>

            {/* Dismiss on mobile */}
            <button
              onClick={() => setDismissed(true)}
              className="lg:hidden text-foreground/25 hover:text-foreground/50 p-1 shrink-0 ml-2"
              aria-label="Dismiss trust bar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
