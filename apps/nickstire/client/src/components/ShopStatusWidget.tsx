/**
 * ShopStatusWidget — Live "is the shop open / busy / waiting" banner for public pages.
 *
 * Serves Pillar 1 (LINE OF CARS) and Pillar 3 (HAPPY WAIT): a customer on mobile
 * glances at the homepage and instantly knows "they're open, 2 bays free, 10-min
 * wait — worth driving now." Conversion lift lever.
 *
 * Data source: trpc.shopStatus.getStatus (public, cached 60s server-side).
 * Refreshes every 90s client-side. Gracefully degrades to "call to confirm" on error.
 */

import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Clock, Phone, ArrowRight } from "lucide-react";
import { Link } from "wouter";

interface Props {
  /** compact variant — single row, fits in hero corner */
  compact?: boolean;
  /** accent color — "gold" for dark backgrounds, "blue" for light */
  accent?: "gold" | "blue";
  /** hide the "Call" button */
  hideCall?: boolean;
  className?: string;
}

export default function ShopStatusWidget({
  compact = false,
  accent = "gold",
  hideCall = false,
  className = "",
}: Props) {
  const { data, isLoading } = trpc.shopStatus.getStatus.useQuery(undefined, {
    refetchInterval: 90_000,        // Refresh every 90s
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: 1,
  });

  // Loading state — minimal so it doesn't flash ugly
  if (isLoading || !data) {
    return (
      <div
        className={`inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 text-white/60 text-xs font-mono tracking-wider ${className}`}
        aria-label="Loading shop status"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-pulse" />
        CHECKING STATUS…
      </div>
    );
  }

  const accentClass =
    accent === "gold"
      ? "text-[#FDB913] bg-white/5 border-white/10 backdrop-blur-md shadow-[0_4px_12px_rgba(0,0,0,0.25)]"
      : "text-blue-600 bg-blue-50 border-blue-200";

  const statusColor = !data.isOpen
    ? "bg-slate-400"
    : data.openBays >= 3
    ? "bg-emerald-500"
    : data.openBays >= 1
    ? "bg-amber-400"
    : "bg-red-500";

  const pulse = data.isOpen && data.openBays > 0;

  // ─── COMPACT VARIANT ─────────────────────────────
  if (compact) {
    return (
      <div
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border ${accentClass} backdrop-blur-sm ${className}`}
        role="status"
        aria-live="polite"
      >
        <span className="relative flex h-2 w-2">
          {pulse && (
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusColor}`}
            />
          )}
          <span className={`relative inline-flex rounded-full h-2 w-2 ${statusColor}`} />
        </span>
        <span className="text-[11px] font-mono font-bold tracking-widest uppercase">
          {!data.isOpen
            ? "CLOSED"
            : data.openBays >= 3
            ? `OPEN · ${data.openBays} BAYS FREE`
            : data.openBays >= 1
            ? `OPEN · ${data.estimatedWaitMinutes}MIN WAIT`
            : "OPEN · ALL BAYS FULL"}
        </span>
      </div>
    );
  }

  // ─── FULL VARIANT ────────────────────────────────
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`${data.isOpen}-${data.openBays}`}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.4 }}
        className={`flex flex-col sm:flex-row items-start sm:items-center gap-4 p-5 rounded-xl bg-white/5 border border-white/10 backdrop-blur-md ${className}`}
        role="status"
        aria-live="polite"
      >
        {/* Status dot + label */}
        <div className="flex items-center gap-3 flex-1">
          <span className="relative flex h-3 w-3">
            {pulse && (
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusColor}`}
              />
            )}
            <span className={`relative inline-flex rounded-full h-3 w-3 ${statusColor}`} />
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white font-bold text-sm tracking-wide uppercase">
                {!data.isOpen ? "CLOSED NOW" : "OPEN NOW"}
              </span>
              {data.isOpen && data.walkInsAccepted && (
                <span className="text-[#FDB913] text-[10px] font-mono tracking-widest uppercase px-2 py-0.5 rounded bg-[#FDB913]/10 border border-[#FDB913]/20">
                  WALK-INS
                </span>
              )}
            </div>
            <p className="text-white/70 text-xs mt-1 leading-snug">{data.statusMessage}</p>
          </div>
        </div>

        {/* Metrics strip */}
        {data.isOpen && (
          <div className="flex items-center gap-4 sm:gap-6 text-white/80">
            <div className="flex flex-col items-center">
              <span className="text-[#FDB913] font-mono font-black text-xl leading-none">
                {data.openBays}
                <span className="text-white/50 text-sm">/{data.totalBays}</span>
              </span>
              <span className="text-[10px] uppercase tracking-wider text-white/50 mt-0.5">
                Bays Free
              </span>
            </div>

            <div className="w-px h-8 bg-white/10" />

            <div className="flex flex-col items-center">
              <span className="flex items-center gap-1 text-[#FDB913] font-mono font-black text-xl leading-none">
                <Clock className="w-4 h-4" />
                {data.estimatedWaitMinutes}
                <span className="text-white/50 text-sm">min</span>
              </span>
              <span className="text-[10px] uppercase tracking-wider text-white/50 mt-0.5">
                Typical Wait
              </span>
            </div>

            {typeof data.currentJobs === "number" && (
              <>
                <div className="w-px h-8 bg-white/10 hidden sm:block" />
                <div className="flex-col items-center hidden sm:flex">
                  <span className="flex items-center gap-1 text-[#FDB913] font-mono font-black text-xl leading-none">
                    <Activity className="w-4 h-4" />
                    {data.currentJobs}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-white/50 mt-0.5">
                    In Progress
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Action CTA */}
        <div className="flex items-center gap-2 ml-auto">
          {data.isOpen ? (
            <Link
              href="/booking"
              className="group inline-flex items-center gap-2 bg-[#FDB913] hover:bg-[#e3a811] active:scale-95 text-black font-bold text-xs uppercase tracking-widest px-4 py-2.5 rounded-lg transition-all duration-150"
            >
              Drop off today
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          ) : (
            <span className="text-[10px] text-white/50 uppercase tracking-widest">
              {data.nextOpenTime ? `Back ${data.nextOpenTime}` : ""}
            </span>
          )}
          {!hideCall && (
            <a
              href={BUSINESS.phone.href}
              className="inline-flex items-center gap-1.5 text-white/70 hover:text-white text-xs font-medium px-3 py-2.5 rounded-lg border border-white/10 hover:border-white/30 transition-colors"
              aria-label="Call the shop"
            >
              <Phone className="w-3.5 h-3.5" />
              Call
            </a>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
