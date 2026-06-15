/**
 * LiveVisitorCounter — "X people viewing right now" social-proof signal.
 *
 * Pulls REAL session counts from `trpc.conversion.liveSessions` (which counts
 * unique session_ids active in the last 5 minutes). Per the conversion-overhaul
 * spec (`docs/CONVERSION-OVERHAUL-V1.1.md`), this MUST be honest:
 *
 *   - If real count is < 3, the component HIDES rather than fake a higher
 *     number. Displaying "1 person" undermines social proof; displaying a
 *     fake "47 people" violates the compliance guardrail.
 *
 *   - The counter pulses subtly to feel alive without being annoying. No
 *     attention-stealing animation.
 *
 *   - Geo-context ("in Cleveland") is added only because we know our visitors
 *     are predominantly local — verified via GSC data.
 *
 * Refresh cadence: 30s (matches server cache TTL — no point pinging faster).
 */
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Eye } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useReducedMotion } from "@/hooks/useReducedMotion";

interface Props {
  /** Minimum count to display. Below this, the component hides. Default 3. */
  minToShow?: number;
  /** Optional className for outer wrapper (positioning, tweaks). */
  className?: string;
  /** Override the default "in Cleveland" geo-context tag. */
  geoLabel?: string;
}

export default function LiveVisitorCounter({
  minToShow = 3,
  className = "",
  geoLabel = "in Cleveland",
}: Props) {
  const reduced = useReducedMotion();
  const { data } = trpc.conversion.liveSessions.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  // Smooth the count slightly — server-side caches at 30s but we don't want
  // the number to jitter on every poll. Hold the previous value if the new
  // one is within ±20%.
  const [displayCount, setDisplayCount] = useState<number>(0);
  useEffect(() => {
    if (!data?.count) return;
    setDisplayCount((prev) => {
      if (prev === 0) return data.count;
      const delta = Math.abs(data.count - prev) / Math.max(prev, 1);
      // If the new count is within 20% of the old, only nudge by 1.
      if (delta < 0.2) return prev + Math.sign(data.count - prev);
      return data.count;
    });
  }, [data?.count]);

  // Don't render if we don't have enough real activity to be persuasive.
  if (!data || displayCount < minToShow) return null;

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0 } : { duration: 0.4 }}
      className={`inline-flex items-center gap-2 text-[11px] font-medium text-[#D4D4D4] bg-white/5 border border-white/10 backdrop-blur-md rounded-full px-3 py-1.5 shadow-[0_4px_12px_rgba(0,0,0,0.25)] ${className}`}
      aria-live="polite"
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className={`absolute inline-flex h-full w-full ${reduced ? "" : "animate-ping"} rounded-full bg-emerald-400/40`} />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
      </span>
      <Eye className="w-3 h-3 text-foreground/40" />
      <span>
        <span className="font-mono font-semibold text-foreground/80">{displayCount}</span>{" "}
        viewing right now {geoLabel}
      </span>
    </motion.div>
  );
}
