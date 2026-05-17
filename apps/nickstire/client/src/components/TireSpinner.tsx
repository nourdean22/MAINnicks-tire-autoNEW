/**
 * TireSpinner — branded loading indicator using the CSS-only spinning
 * tire from index.css. Drop-in replacement for <Loader2 /> on customer-
 * facing surfaces where brand consistency matters more than neutrality.
 *
 * Why CSS, not WebGL: zero asset bytes, zero JS bundle weight, zero
 * GPU context allocation. Older Cleveland Androids will render this
 * identically to the latest iPhone.
 *
 * Used in: BookingForm submit, FormSubmitting states, customer portal
 * lookup, anywhere a loading state on the customer-facing site can
 * reinforce the "this is a tire shop" mental model.
 *
 * Honors prefers-reduced-motion via the underlying .css-tire animation.
 */
import type { CSSProperties } from "react";

export interface TireSpinnerProps {
  /** Visual size — matches Tailwind w/h scale loosely */
  size?: "xs" | "sm" | "md" | "lg";
  /** Optional caption shown below the tire */
  label?: string;
  /** Inline style override (e.g. for custom tints) */
  style?: CSSProperties;
  /** Wraps the spinner + label in a centered flex container */
  centered?: boolean;
  /** Override container className */
  className?: string;
}

const SIZE_PX: Record<NonNullable<TireSpinnerProps["size"]>, number> = {
  xs: 28,
  sm: 44,
  md: 64,
  lg: 96,
};

export function TireSpinner({
  size = "sm",
  label,
  style,
  centered = false,
  className = "",
}: TireSpinnerProps) {
  const px = SIZE_PX[size];
  const tire = (
    <div
      className="css-tire"
      role="status"
      aria-label={label || "Loading"}
      style={{ width: px, height: px, ...style }}
    />
  );

  if (centered || label) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-3 ${className}`}
      >
        {tire}
        {label && (
          <span className="text-[11px] tracking-[0.18em] uppercase text-foreground/40 font-semibold">
            {label}
          </span>
        )}
      </div>
    );
  }
  return tire;
}

export default TireSpinner;
