"use client";

/**
 * StandardPage · v10.0.317 · the canonical page-shell primitive for
 * statenour mastery surfaces · now type-safely enumerates width +
 * rhythm so every page in the codebase can adopt the same factory
 * regardless of layout density.
 *
 * Tier-5 elon move (manufacturing-as-product) · the factory matters
 * more than the unit. Every page authored from here forward should
 * use `<StandardPage>` as its root so:
 *
 *   1. Header structure is consistent (eyebrow + title + description
 *      + optional actions) · matches the existing PageHeader
 *   2. Pulse-strip slot is reserved · pages that surface intel chips
 *      (operator snapshot, telemetry summary, etc) get a standard
 *      placement above the main content
 *   3. Width + spacing is uniform within each density tier · operators
 *      get the same visual rhythm across every surface · no ad-hoc
 *      layouts. Width prop ("md" → "3xl") covers the existing 5 widths
 *      in production: max-w-3xl through max-w-7xl.
 *   4. page-fade-in animation applies automatically · cinematic mount
 *      every page-mount without each page wiring it
 *   5. Future cross-cutting concerns (loading skeletons, error
 *      boundaries, telemetry hooks) get one place to land
 *
 * Default behavior preserves v10.0.303 · `width="md"` + `rhythm="compact"`
 * yields the original `space-y-3 max-w-3xl` (no centering, relies on
 * parent .feed for horizontal layout). Wider widths auto-add `mx-auto`
 * to match the existing `mx-auto max-w-6xl` convention used by data-
 * dense pages.
 *
 * Anti-pattern: more than 5 sections inside `<StandardPage>` is a
 * signal the page is doing too much · split or consolidate per the
 * elon 5-step (question · delete · simplify · accelerate · automate).
 */
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/layout/ui";
import { cn } from "@/lib/utils/cn";

/**
 * v10.0.529.52 · auto-detect parent hub from pathname. Pages under
 * /system/* or /brain/* get a back-link to the hub without each page
 * having to opt in. Pages elsewhere render unchanged. Sub-route
 * detection · /system or /brain MUST be followed by another segment ·
 * the hub pages themselves (/system root · /brain root) don't link
 * back to themselves.
 */
function autoDetectParent(pathname: string | null): { href: string; label: string } | null {
  if (!pathname) return null;
  if (pathname.startsWith("/system/") && pathname !== "/system") {
    return { href: "/system", label: "system" };
  }
  if (pathname.startsWith("/brain/") && pathname !== "/brain") {
    return { href: "/brain", label: "brain" };
  }
  return null;
}

const WIDTH_CLASS: Record<"md" | "lg" | "xl" | "2xl" | "3xl", string> = {
  md: "max-w-3xl",   // 768px · telemetry / single-column reads (default)
  lg: "max-w-4xl",   // 896px · slim canvas (e.g. /system/power)
  xl: "max-w-5xl",   // 1024px · tabbed surfaces (e.g. /system/coverage)
  "2xl": "max-w-6xl", // 1152px · data-dense crons / tools / costs
  "3xl": "max-w-7xl", // 1280px · widest tables (/content/history, /system/costs)
};

const RHYTHM_CLASS: Record<"compact" | "comfortable" | "loose", string> = {
  compact: "space-y-3",      // default · tight rhythm
  comfortable: "space-y-4",  // wider pages with denser sections
  loose: "space-y-5",        // breathing room for 5-6 panel dashboards
};

interface StandardPageProps {
  /** Tiny breadcrumb-style label above the title. e.g. "System / observability". */
  eyebrow: string;
  /** Display-typography title. Goes through Barlow Condensed via PageHeader's h1. */
  title: string;
  /** One-line description. */
  description?: string;
  /**
   * Optional inline pulse-strip slot · render `<TodayPulseStrip />` or
   * a similar intel-summary component here. Sits above main content,
   * below the header.
   */
  pulseStrip?: ReactNode;
  /** Optional header CTAs · passed through to PageHeader's actions slot. */
  actions?: ReactNode;
  /**
   * Outer max-width. "md" (default) keeps the v10.0.303 behavior of
   * `max-w-3xl` with no centering · ideal for telemetry pages where
   * the parent .feed container handles horizontal layout. Wider widths
   * automatically add `mx-auto` to match the `mx-auto max-w-Xxl`
   * convention used by data-dense pages.
   */
  width?: keyof typeof WIDTH_CLASS;
  /**
   * Vertical rhythm between top-level sections. "compact" = space-y-3
   * (default · matches v10.0.303). "comfortable" = space-y-4 · used by
   * wider data-dense pages.
   */
  rhythm?: keyof typeof RHYTHM_CLASS;
  /**
   * Page body. Aim for max ~5 top-level sections per the operator-
   * grade DFII rhythm. More than that = the page is doing too much.
   */
  children: ReactNode;
  /** Outer className for size overrides · rare. */
  className?: string;
  /**
   * v10.0.529.52 · explicit back-link override. When set, takes
   * precedence over auto-detect. Passing `null` disables the back-link
   * entirely (useful for hub pages that ARE the parent). Otherwise
   * the component auto-detects /system/* and /brain/* sub-routes and
   * renders the right back-link · no opt-in required.
   */
  parent?: { href: string; label: string } | null;
}

export function StandardPage({
  eyebrow,
  title,
  description,
  pulseStrip,
  actions,
  width = "md",
  rhythm = "compact",
  children,
  className,
  parent,
}: StandardPageProps) {
  const pathname = usePathname();
  // Resolve the effective parent · explicit override > auto-detect.
  // `parent === null` is the "disable" signal · distinct from
  // `parent === undefined` which means "auto-detect".
  const effectiveParent =
    parent === undefined ? autoDetectParent(pathname) : parent;
  return (
    <div
      className={cn(
        "page-fade-in",
        RHYTHM_CLASS[rhythm],
        WIDTH_CLASS[width],
        // Wider widths auto-center · "md" preserves the v10.0.303
        // left-aligned-within-.feed behavior used by tire-stock-requests
        // / lens-stats / vapi-calls.
        width !== "md" && "mx-auto",
        className,
      )}
    >
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description ?? ""}
        actions={actions}
        parentHref={effectiveParent?.href}
        parentLabel={effectiveParent?.label}
      />
      {pulseStrip ? <div className="px-1">{pulseStrip}</div> : null}
      {children}
    </div>
  );
}
