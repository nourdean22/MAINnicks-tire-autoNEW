/**
 * CountUpNumber — display a number that animates from 0 to target when
 * scrolled into view. Wave-45 design-spells micro-interaction.
 *
 * Wraps the useCountUp hook with formatting (thousands separator + optional
 * suffix). Use as a drop-in replacement for static numbers anywhere on the
 * site that displays a trust signal:
 *
 *   <CountUpNumber to={1700} suffix="+" /> renders as: 0 → 1,700+
 *   <CountUpNumber to={4.9} decimals={1} /> renders as: 0 → 4.9
 *   <CountUpNumber to={68} suffix="%" />   renders as: 0 → 68%
 */
import { useCountUp } from "@/hooks/useCountUp";

interface CountUpNumberProps {
  to: number;
  /** Optional prefix (e.g. "$", "★") */
  prefix?: string;
  /** Optional suffix (e.g. "+", "%", "★") */
  suffix?: string;
  /** Decimal places. Default 0. */
  decimals?: number;
  /** Animation duration in ms. Default 1200. */
  duration?: number;
  /** className passthrough */
  className?: string;
  /** Display formatter for the integer part. Default toLocaleString (adds commas). */
  formatter?: (value: number) => string;
}

export default function CountUpNumber({
  to,
  prefix = "",
  suffix = "",
  decimals = 0,
  duration = 1200,
  className = "",
  formatter,
}: CountUpNumberProps) {
  const { ref, value } = useCountUp({ to, duration, decimals });

  const formatted = formatter
    ? formatter(value)
    : decimals > 0
      ? value.toFixed(decimals)
      : value.toLocaleString();

  return (
    <span ref={ref as React.RefObject<HTMLSpanElement>} className={className}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
