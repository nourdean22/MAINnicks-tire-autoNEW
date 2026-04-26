/**
 * AnchorAdjustmentTable — quick visual: dealer / chain / Nick's price comparison.
 *
 * Behavioral economics: the first number you see "anchors" your sense of
 * what's reasonable. By showing the dealer's $800 first, our $329 feels
 * like a rescue. Crucially: dealer/chain numbers must be DEFENSIBLE —
 * use representative quotes the shop can cite if asked.
 *
 * Use this above a service's pricing block, NEVER alone (it's a frame,
 * not a sale).
 */
import { motion } from "framer-motion";

export interface Row {
  label: string;
  price: string;
  /** Mark a row as "ours" — gets highlighted, no strikethrough. */
  ours?: boolean;
  /** Force-strikethrough even on non-ours rows. Defaults to true for non-ours. */
  strikethrough?: boolean;
}

interface Props {
  /** Service/category name (e.g., "Brake repair, per axle"). */
  serviceName: string;
  rows: Row[];
  /** Optional source ("Average dealer quote, Cleveland-area, 2026"). */
  source?: string;
}

export default function AnchorAdjustmentTable({ serviceName, rows, source }: Props) {
  return (
    <section className="my-6">
      <div className="text-[11px] font-bold tracking-widest text-foreground/40 uppercase mb-2">
        {serviceName}
      </div>
      <div className="space-y-1">
        {rows.map((r, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08 }}
            className={`flex items-baseline justify-between rounded-md px-4 py-3 transition-colors ${
              r.ours
                ? "bg-primary/10 border border-primary/30"
                : "bg-foreground/[0.02] border border-border/20"
            }`}
          >
            <span
              className={`text-sm ${
                r.ours ? "font-bold text-primary" : "text-foreground/60"
              }`}
            >
              {r.label}
            </span>
            <span
              className={`font-mono ${
                r.ours
                  ? "text-2xl font-bold text-primary"
                  : `text-base text-foreground/50 ${r.strikethrough !== false ? "line-through" : ""}`
              }`}
            >
              {r.price}
            </span>
          </motion.div>
        ))}
      </div>
      {source && (
        <p className="mt-2 text-[10px] text-foreground/30 italic">{source}</p>
      )}
    </section>
  );
}
