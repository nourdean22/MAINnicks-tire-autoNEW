/**
 * LineOfCarsCounter — The headline metric, live.
 *
 * Pillar 1 of the business: "A line of cars every day." This is the component
 * that shows it to the world. Animates when a new car lands. 2-min refresh.
 *
 * Shows:
 *   - Today's total (booked + dropped off)
 *   - Invoices closed today (wins)
 *   - 7-day trend arrow
 *
 * Designed for above-the-fold placement. Dark-friendly by default.
 */

import { trpc } from "@/lib/trpc";
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus, Car, CheckCircle2 } from "lucide-react";

/**
 * Animated number — counts up from its previous value using a spring.
 * Keeps the counter feeling "alive" when data refreshes.
 */
function AnimatedNumber({ value, className = "" }: { value: number; className?: string }) {
  const spring = useSpring(0, { mass: 0.8, stiffness: 80, damping: 15 });
  const display = useTransform(spring, (latest) => Math.round(latest).toLocaleString("en-US"));
  useEffect(() => { spring.set(value); }, [spring, value]);
  return <motion.span className={className}>{display}</motion.span>;
}

interface Props {
  variant?: "hero" | "compact" | "admin";
  className?: string;
}

export default function LineOfCarsCounter({ variant = "hero", className = "" }: Props) {
  const { data, isLoading } = trpc.shopStatus.getLineOfCars.useQuery(undefined, {
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });

  // Flash animation on change
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (!data) return;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 800);
    return () => clearTimeout(t);
  }, [data?.total]);

  if (isLoading || !data) {
    return (
      <div className={`inline-flex items-center gap-2 ${className}`}>
        <span className="w-2 h-2 rounded-full bg-white/30 animate-pulse" />
        <span className="text-white/50 text-xs font-mono tracking-widest">LOADING LIVE COUNT…</span>
      </div>
    );
  }

  const TrendIcon = data.trend === "up" ? TrendingUp : data.trend === "down" ? TrendingDown : Minus;
  const trendColor = data.trend === "up" ? "text-emerald-400" : data.trend === "down" ? "text-red-400" : "text-white/40";

  // ─── COMPACT VARIANT — inline badge ──────────────
  if (variant === "compact") {
    return (
      <div
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 ${pulse ? "ring-2 ring-[#FDB913]/40" : ""} transition-all ${className}`}
      >
        <Car className="w-3.5 h-3.5 text-[#FDB913]" />
        <AnimatedNumber value={data.total} className="text-white font-mono font-bold text-sm" />
        <span className="text-white/50 text-[10px] uppercase tracking-widest">Today</span>
        <TrendIcon className={`w-3 h-3 ${trendColor}`} />
      </div>
    );
  }

  // ─── ADMIN VARIANT — dense card ──────────────────
  if (variant === "admin") {
    return (
      <div className={`rounded-xl border border-border/30 bg-card/50 p-4 ${className}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
              Line of Cars · Today
            </div>
            <div className="flex items-baseline gap-2">
              <AnimatedNumber
                value={data.total}
                className="font-mono font-black text-4xl text-foreground"
              />
              <span className={`flex items-center gap-1 text-xs font-mono ${trendColor}`}>
                <TrendIcon className="w-3 h-3" />
                {data.weekAverage > 0 ? `7d avg ${data.weekAverage}` : ""}
              </span>
            </div>
          </div>
          <div className="text-right space-y-1 text-xs">
            <div>
              <span className="text-muted-foreground">Booked </span>
              <span className="font-mono font-bold">{data.booked}</span>
            </div>
            <div>
              <span className="text-muted-foreground">In bay </span>
              <span className="font-mono font-bold">{data.droppedOff}</span>
            </div>
            <div className="text-emerald-400">
              <span className="text-emerald-400/70">Invoiced </span>
              <span className="font-mono font-bold">{data.invoicedToday}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── HERO VARIANT — public, dramatic ─────────────
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={data.total}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className={`inline-flex items-center gap-3 px-5 py-3 rounded-xl bg-black/40 border border-[#FDB913]/20 backdrop-blur-sm ${className}`}
      >
        <div className="flex items-center gap-2">
          <Car className="w-5 h-5 text-[#FDB913]" />
          <AnimatedNumber
            value={data.total}
            className="font-mono font-black text-3xl text-[#FDB913] leading-none"
          />
          <span className="text-white/60 text-xs uppercase tracking-widest">cars today</span>
        </div>

        {data.invoicedToday > 0 && (
          <>
            <div className="w-px h-6 bg-white/15" />
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <AnimatedNumber
                value={data.invoicedToday}
                className="font-mono font-bold text-sm text-emerald-300"
              />
              <span className="text-emerald-400/60 text-[10px] uppercase tracking-widest">
                done
              </span>
            </div>
          </>
        )}

        <div className="w-px h-6 bg-white/15" />
        <span className={`flex items-center gap-1 text-xs font-mono ${trendColor}`}>
          <TrendIcon className="w-3 h-3" />
          {data.trend === "up" ? "HOT" : data.trend === "down" ? "SLOW" : "STEADY"}
        </span>
      </motion.div>
    </AnimatePresence>
  );
}
