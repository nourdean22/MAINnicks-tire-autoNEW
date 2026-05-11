/**
 * LossAversionStat — a single hero number framed as ongoing loss.
 *
 * Per Kahneman/Tversky: people respond ~2x more strongly to loss than to
 * equivalent gain. So instead of "Save $X by acting now" we frame it as
 * "You're losing $X every day until you act." The number animates upward
 * to make the loss feel ongoing.
 *
 * Usage:
 *   <LossAversionStat
 *     amount={8.5}
 *     unit="per day"
 *     label="lost in preventable damage"
 *     reason="Your worn brake pads are eating rotors faster every mile."
 *   />
 *
 * Per the conversion-overhaul spec, every claim must be quantifiable. If
 * we can't substantiate the number, don't ship the stat.
 */
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { TrendingDown } from "lucide-react";

interface Props {
  /** The dollar amount being lost (positive number, no $). */
  amount: number;
  /** Time/scale label ("per day", "per mile", "per stop"). */
  unit: string;
  /** Description of what is being lost. */
  label: string;
  /** Optional explanation of the mechanism (1 sentence). */
  reason?: string;
  /** Optional CTA href. */
  ctaHref?: string;
  ctaLabel?: string;
}

export default function LossAversionStat({
  amount,
  unit,
  label,
  reason,
  ctaHref,
  ctaLabel = "STOP THE LOSS",
}: Props) {
  // Show the actual amount immediately (SSR-safe), animate on scroll
  const ref = useRef<HTMLDivElement>(null);
  const [display, setDisplay] = useState(amount);
  const [hasAnimated, setHasAnimated] = useState(false);

  useEffect(() => {
    if (!ref.current || hasAnimated) return;
    const el = ref.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasAnimated) {
          setHasAnimated(true);
          // Start from 0 and count up to amount over 1.2 seconds
          const start = performance.now();
          const duration = 1200;
          const tick = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            setDisplay(amount * eased);
            if (t < 1) requestAnimationFrame(tick);
          };
          setDisplay(0);
          requestAnimationFrame(tick);
          observer.disconnect();
        }
      },
      { threshold: 0.2 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [amount, hasAnimated]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, margin: "-50px" }}
      className="rounded-lg border border-red-500/30 bg-red-500/5 p-6"
    >
      <div className="flex items-center gap-2 mb-3">
        <TrendingDown className="w-4 h-4 text-red-400" />
        <span className="text-[10px] font-bold tracking-widest text-red-400 uppercase">Loss in motion</span>
      </div>

      <div className="flex items-baseline gap-2 mb-2">
        <span className="font-bold text-4xl text-red-400 font-mono tabular-nums">
          ${display.toFixed(amount % 1 === 0 ? 0 : 2)}
        </span>
        <span className="text-sm text-foreground/60">{unit}</span>
      </div>

      <div className="text-base font-semibold text-foreground/90 mb-2">{label}</div>

      {reason && (
        <p className="text-[12px] text-foreground/60 leading-relaxed">{reason}</p>
      )}

      {ctaHref && (
        <a
          href={ctaHref}
          className="mt-4 inline-flex items-center justify-center rounded bg-red-500 px-4 py-2 text-xs font-bold tracking-wide text-white hover:bg-red-600 transition-colors"
        >
          {ctaLabel}
        </a>
      )}
    </motion.div>
  );
}
