/**
 * StampLetters — letter-by-letter "stamp" reveal animation for headlines.
 *
 * Replaces the generic Framer Motion `y: 30 → 0` fade-up on H1s with a
 * mechanical *stamp* animation: each letter starts oversized + low-
 * opacity, settles into place with a slight ink-spread shadow that
 * fades. Reads as machinery / metal stamp / shop press, not as
 * springy plastic SaaS. On-brand for "Grounded & Reliable."
 *
 * Usage:
 *   <StampLetters text="CLEVELAND" delay={0.3} />
 *   <StampLetters text="TOUGH." delay={0.55} className="text-[#FDB913]" />
 *
 * Whitespace becomes a breakable space (br). Punctuation animates
 * normally.
 *
 * Honors prefers-reduced-motion via Framer Motion's built-in support
 * (the variants resolve to no-op when reduced motion is requested).
 */
import { motion } from "framer-motion";

export interface StampLettersProps {
  text: string;
  /** Initial delay before the first letter stamps in. Default 0. */
  delay?: number;
  /** Stagger between letters. Default 0.04s — fast enough to feel snappy, slow enough to read as "stamping." */
  stagger?: number;
  /** Optional className applied to the wrapper span (color, weight, etc) */
  className?: string;
  /** Inline style passthrough */
  style?: React.CSSProperties;
}

const containerVariants = {
  hidden: {},
  visible: (custom: { delay: number; stagger: number }) => ({
    transition: {
      delayChildren: custom.delay,
      staggerChildren: custom.stagger,
    },
  }),
};

// Each letter starts oversized (scale 1.4) with ink-bleed shadow,
// settles to natural scale with the shadow tightening. Eases like a
// stamp pressing into paper — fast initial drop, gentle settle.
const letterVariants = {
  hidden: {
    opacity: 0,
    y: -8,
    scale: 1.4,
    filter: "blur(2px)",
    textShadow: "0 4px 16px rgba(0,0,0,0)",
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    textShadow: "0 1px 0 rgba(0,0,0,0.15), 0 0 0 rgba(0,0,0,0)",
    transition: {
      duration: 0.34,
      ease: [0.6, 0.04, 0.2, 1] as [number, number, number, number],
    },
  },
};

export function StampLetters({
  text,
  delay = 0,
  stagger = 0.04,
  className,
  style,
}: StampLettersProps) {
  return (
    <motion.span
      className={className}
      style={{ display: "inline-block", ...style }}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      custom={{ delay, stagger }}
      aria-label={text}
    >
      {Array.from(text).map((char, i) => {
        if (char === " ") {
          // Real space — preserve it without animating
          return <span key={`s-${i}`} aria-hidden="true">&nbsp;</span>;
        }
        return (
          <motion.span
            key={`${char}-${i}`}
            aria-hidden="true"
            variants={letterVariants}
            style={{
              display: "inline-block",
              willChange: "transform, opacity, filter",
            }}
          >
            {char}
          </motion.span>
        );
      })}
    </motion.span>
  );
}

export default StampLetters;
