/**
 * StickyTrustBar (Phase 1.3) — Always-visible trust bar below header, above hero.
 * Shows: star rating, Google review count, live open/closed status, financing CTA.
 */

import { useState, useEffect } from "react";
import { Star, DollarSign } from "lucide-react";
import { motion } from "framer-motion";
import { BUSINESS } from "@shared/business";
import { trpc } from "@/lib/trpc";

/** Return whether the shop is currently open, plus a human-readable label. */
function getOpenStatus(): { isOpen: boolean; label: string } {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const minutes = now.getHours() * 60 + now.getMinutes();

  // Sunday: 9 AM - 4 PM
  if (day === 0) {
    const open = 9 * 60;
    const close = 16 * 60;
    if (minutes >= open && minutes < close) return { isOpen: true, label: "Open Now" };
    if (minutes < open) return { isOpen: false, label: "Opens at 9 AM" };
    return { isOpen: false, label: "Opens at 8 AM" };
  }

  // Monday-Saturday: 8 AM - 6 PM
  if (day >= 1 && day <= 6) {
    const open = 8 * 60;
    const close = 18 * 60;
    if (minutes >= open && minutes < close) return { isOpen: true, label: "Open Now" };
    if (minutes < open) return { isOpen: false, label: "Opens at 8 AM" };
    // After closing — next day
    if (day === 6) return { isOpen: false, label: "Opens at 9 AM" }; // Saturday -> Sunday
    return { isOpen: false, label: "Opens at 8 AM" };
  }

  return { isOpen: false, label: "Opens at 8 AM" };
}

export default function StickyTrustBar() {
  const [status, setStatus] = useState(getOpenStatus);

  const { data: googleData } = trpc.reviews.google.useQuery(undefined, {
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  const totalReviews = googleData?.totalReviews ?? BUSINESS.reviews.count;

  // Re-check open status every 60 s
  useEffect(() => {
    const id = setInterval(() => setStatus(getOpenStatus()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <motion.div
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="w-full bg-[#141414] border-b border-[#2A2A2A]"
    >
      {/* Desktop layout */}
      <div className="hidden sm:flex items-center justify-between h-10 px-4 max-w-7xl mx-auto text-[13px] font-sans font-medium text-[#F5F5F5]">
        {/* Left: Stars + rating */}
        <div className="flex items-center gap-1.5 shrink-0">
          {[...Array(5)].map((_, i) => (
            <Star key={i} className="w-3.5 h-3.5 fill-[#FDB913] text-[#FDB913]" />
          ))}
          <span className="ml-1">{BUSINESS.reviews.rating} Stars</span>
        </div>

        {/* Center-left: Review count */}
        <div className="shrink-0 text-[#F5F5F5]/70">
          {totalReviews.toLocaleString()}+ Google Reviews
        </div>

        {/* Center-right: Open/Closed status */}
        <div className="flex items-center gap-2 shrink-0">
          {status.isOpen ? (
            <>
              <span className="pulse-dot inline-block w-2 h-2 rounded-full bg-green-500" />
              <span className="text-green-400">{status.label}</span>
            </>
          ) : (
            <span className="text-red-400">{status.label}</span>
          )}
        </div>

        {/* Right: Financing */}
        <div className="flex items-center gap-1.5 shrink-0">
          <DollarSign className="w-3.5 h-3.5 text-[#FDB913]" />
          <span>$0 Down Financing Available</span>
        </div>
      </div>

      {/* Mobile layout — horizontal scroll, show rating + status */}
      <div className="flex sm:hidden items-center gap-4 h-9 px-4 overflow-x-auto text-[13px] font-sans font-medium text-[#F5F5F5] scrollbar-none">
        {/* Stars + rating */}
        <div className="flex items-center gap-1 shrink-0">
          {[...Array(5)].map((_, i) => (
            <Star key={i} className="w-3 h-3 fill-[#FDB913] text-[#FDB913]" />
          ))}
          <span className="ml-1">{BUSINESS.reviews.rating}</span>
        </div>

        <span className="w-px h-3.5 bg-[#F5F5F5]/10 shrink-0" />

        {/* Review count */}
        <span className="text-[#F5F5F5]/70 shrink-0">
          {totalReviews.toLocaleString()}+ Reviews
        </span>

        <span className="w-px h-3.5 bg-[#F5F5F5]/10 shrink-0" />

        {/* Open status */}
        <div className="flex items-center gap-1.5 shrink-0">
          {status.isOpen ? (
            <>
              <span className="pulse-dot inline-block w-2 h-2 rounded-full bg-green-500" />
              <span className="text-green-400">{status.label}</span>
            </>
          ) : (
            <span className="text-red-400">{status.label}</span>
          )}
        </div>

        <span className="w-px h-3.5 bg-[#F5F5F5]/10 shrink-0" />

        {/* Financing */}
        <span className="shrink-0">$0 Down Financing</span>
      </div>
    </motion.div>
  );
}
