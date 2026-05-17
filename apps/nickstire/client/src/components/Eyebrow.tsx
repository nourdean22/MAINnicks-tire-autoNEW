/**
 * Eyebrow — microscopic badge that precedes major H1/H2s.
 *
 * Pattern from the high-end-visual-design playbook (Vanguard_UI_Architect):
 * a 10px uppercase pill with wide letter-spacing that sits above the headline
 * to give the section breathing room and rhythm. Used consistently across the
 * site, this becomes a familiar "you're in the right place" anchor.
 *
 * Variants:
 *   - "yellow" (default): brand yellow on transparent — most common, sits over
 *     dark photo or dark sections
 *   - "subtle":           neutral foreground/55 — for secondary-importance
 *     eyebrows that shouldn't compete with the H2 below
 *   - "filled":           solid pill background — for sections where the
 *     eyebrow needs to feel like a clickable tag (e.g. category)
 *
 * Usage:
 *   <Eyebrow>17625 Euclid Ave · Cleveland · OH</Eyebrow>
 *   <Eyebrow variant="filled">No credit needed</Eyebrow>
 *   <Eyebrow variant="subtle">Step 02</Eyebrow>
 */
import { type ReactNode } from "react";

type Variant = "yellow" | "subtle" | "filled";

interface EyebrowProps {
  children: ReactNode;
  variant?: Variant;
  className?: string;
  /** Drop shadow under the badge — useful when sitting over a photo. Default true. */
  dropShadow?: boolean;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  yellow: "text-[#FDB913]",
  subtle: "text-foreground/55",
  filled: "bg-[#FDB913] text-[#0A0A0A] px-3 py-1 rounded-full",
};

export default function Eyebrow({
  children,
  variant = "yellow",
  className = "",
  dropShadow = true,
}: EyebrowProps) {
  return (
    <p
      className={[
        "inline-block text-[10px] sm:text-[11px] uppercase tracking-[0.22em] font-bold mb-3",
        VARIANT_CLASSES[variant],
        dropShadow && variant !== "filled"
          ? "drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]"
          : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </p>
  );
}
