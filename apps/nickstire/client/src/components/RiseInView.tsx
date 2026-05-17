/**
 * RiseInView — wraps a section so it fades + rises into place when it
 * crosses the viewport. Uses Framer Motion (already in the bundle) with
 * whileInView so it doesn't run animations off-screen.
 *
 * Why this exists: gives the customer-facing site "depth between rooms"
 * — each section feels like its own beat instead of one infinite scroll.
 *
 * Honors prefers-reduced-motion via Framer Motion's built-in support.
 *
 * Use as <RiseInView><section>...</section></RiseInView>. Optional
 * `delay` and `y` overrides for fine-tuning.
 */
import { motion, type MotionProps } from "framer-motion";
import type { ReactNode } from "react";

export interface RiseInViewProps extends MotionProps {
  children: ReactNode;
  /** Vertical translation distance in px. Defaults to 28. */
  y?: number;
  /** Animation duration in seconds. Defaults to 0.7. */
  duration?: number;
  /** Stagger delay in seconds. Defaults to 0. */
  delay?: number;
  /** Viewport amount triggering the animation. Defaults to 0.1 (10% visible). */
  amount?: number;
  /** Pass-through className */
  className?: string;
  /** Run the animation only once (default true) — once visible, stays visible */
  once?: boolean;
}

export function RiseInView({
  children,
  y = 28,
  duration = 0.7,
  delay = 0,
  amount = 0.12,
  once = true,
  className,
  ...rest
}: RiseInViewProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, amount }}
      transition={{
        duration,
        delay,
        ease: [0.2, 0.8, 0.2, 1],
      }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export default RiseInView;
