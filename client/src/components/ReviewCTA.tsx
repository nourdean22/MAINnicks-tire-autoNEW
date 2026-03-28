/**
 * ReviewCTA — Slim banner encouraging returning visitors to leave a Google review.
 * Shows above the footer on service pages.
 * - Only appears for returning visitors (localStorage 'visited-before')
 * - Can be dismissed for 30 days (localStorage 'review-cta-dismissed')
 */
import { useState, useEffect } from "react";
import { GBP_REVIEW_URL } from "@shared/const";

const VISITED_KEY = "visited-before";
const DISMISSED_KEY = "review-cta-dismissed";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export default function ReviewCTA() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      // Mark this visit
      const hasVisitedBefore = localStorage.getItem(VISITED_KEY);
      if (!hasVisitedBefore) {
        localStorage.setItem(VISITED_KEY, Date.now().toString());
        return; // First visit — don't show
      }

      // Check if dismissed within the last 30 days
      const dismissedAt = localStorage.getItem(DISMISSED_KEY);
      if (dismissedAt) {
        const elapsed = Date.now() - parseInt(dismissedAt, 10);
        if (elapsed < THIRTY_DAYS_MS) {
          return; // Still within 30-day cooldown
        }
      }

      setVisible(true);
    } catch {}
  }, []);

  function handleDismiss() {
    try { localStorage.setItem(DISMISSED_KEY, Date.now().toString()); } catch {}
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <section
      className="w-full border-t"
      style={{ backgroundColor: "#141414", borderColor: "#2A2A2A" }}
    >
      <div className="max-w-5xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-sm text-white/80 text-center sm:text-left">
          Had a great experience? Your review helps Cleveland drivers find honest repair.{" "}
          <span className="text-yellow-400">★★★★★</span>
        </p>

        <div className="flex items-center gap-3 shrink-0">
          <a
            href={GBP_REVIEW_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-4 py-2 rounded-md text-sm font-semibold transition-colors"
            style={{ backgroundColor: "#D4A017", color: "#141414" }}
          >
            Leave a Google Review →
          </a>
          <button
            onClick={handleDismiss}
            className="text-white/40 hover:text-white/70 transition-colors text-lg leading-none"
            aria-label="Dismiss review banner"
          >
            ✕
          </button>
        </div>
      </div>
    </section>
  );
}
