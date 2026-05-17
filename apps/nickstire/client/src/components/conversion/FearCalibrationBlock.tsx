/**
 * FearCalibrationBlock — a row of "scary number" cards used inside service
 * pages to make abstract risk visceral.
 *
 * Per the conversion-overhaul spec, examples:
 *   - "287 feet of stopping distance added at 60 mph with failing brakes"
 *   - "Brake fluid boils at 400°F. Old fluid drops that to 280°F."
 *   - "Cleveland hills + worn pads = guaranteed collision scenario."
 *
 * Each card has a large number + unit + plain-language consequence.
 * Numbers must be defensible (cite source if asked); avoid manufactured stats.
 */
import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";

export interface FearStat {
  /** The big number, displayed prominently. Can be a string (e.g., "400°F"). */
  value: string;
  /** Small unit/context next to the number. */
  unit?: string;
  /** Plain-language consequence sentence. */
  consequence: string;
  /** Optional source citation (footnote-style). */
  source?: string;
}

interface Props {
  /** Section heading (e.g., "What failing brakes actually mean"). */
  heading?: string;
  stats: FearStat[];
}

export default function FearCalibrationBlock({ heading, stats }: Props) {
  return (
    <section className="my-10">
      {heading && (
        <h3 className="font-bold text-2xl text-foreground tracking-tight mb-5">
          {heading}
        </h3>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {stats.map((s, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-30px" }}
            transition={{ delay: i * 0.07 }}
            className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5"
          >
            <div className="flex items-center gap-1.5 mb-3">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[10px] font-bold tracking-widest text-amber-400 uppercase">Fact</span>
            </div>

            <div className="flex items-baseline gap-1.5 mb-2">
              <span className="font-bold text-3xl text-foreground tracking-tight">{s.value}</span>
              {s.unit && <span className="text-xs text-foreground/50">{s.unit}</span>}
            </div>

            <p className="text-sm text-foreground/80 leading-relaxed">
              {s.consequence}
            </p>

            {s.source && (
              <p className="mt-2 text-[10px] text-foreground/30 italic">{s.source}</p>
            )}
          </motion.div>
        ))}
      </div>
    </section>
  );
}
