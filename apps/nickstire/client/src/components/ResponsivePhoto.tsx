/**
 * ResponsivePhoto — drop-in replacement for <img> with optional
 * mobile-variant optimization.
 *
 * When `disableMobile` is `false` (opt-in), browsers under 768px viewport
 * download a `-mobile.webp` sibling (~85-180 KB) instead of the desktop
 * variant (~200-470 KB). 50-80% mobile bandwidth savings per image.
 *
 * Convention: if `src` is `/photo.webp`, the mobile variant is expected
 * at `/photo-mobile.webp` (same /public directory). Generated via the
 * scripts/optimize-photos.mjs one-time build.
 *
 * 2026-05-06 wave-17 · DEFAULT FLIPPED TO disableMobile=true. The wave-16
 * pro photo pack lives at /photos/ and ships WITHOUT -mobile variants.
 * The previous default tried to load a non-existent /photos/...-mobile.webp,
 * which Railway's SPA fallback served as text/html → broken images on
 * mobile across About/City/Diagnose/Neighborhood/Seasonal pages.
 *
 * Pages that still want mobile-variant download must now explicitly pass
 * disableMobile={false}. Future: regenerate -mobile siblings for the new
 * pack via the optimize-photos script and flip the default back.
 *
 * Usage:
 *   <ResponsivePhoto
 *     src="/photos/shop-exterior-hero.webp"
 *     alt="Real shop photo"
 *     className="w-full h-full object-cover"
 *     loading="lazy"
 *   />
 *
 * For LCP-critical above-the-fold photos, pass loading="eager" + fetchPriority="high".
 */
import type React from "react";

interface ResponsivePhotoProps {
  src: string;
  alt: string;
  className?: string;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
  /** Override breakpoint for the mobile <source>. Default: 768px. */
  mobileBreakpoint?: number;
  /**
   * Enable the mobile-variant <source>. Default: true (off) since the
   * wave-16 pro pack doesn't have -mobile siblings. Set explicitly to
   * `false` if you know the file has a verified -mobile sibling.
   */
  disableMobile?: boolean;
  /**
   * 2026-05-05 — wrap the <picture> in a `.photo-depth` span so the
   * 3D-depth CSS layer applies hover-zoom + radial vignette on the
   * photo container. Defaults to true for non-LCP photos; LCP photos
   * (loading="eager") opt out to keep paint cost minimal.
   */
  withDepth?: boolean;
  /**
   * 2026-05-06 wave-18 — explicit object-position passthrough so callers
   * can lock the focal point per PLACEMENT_GUIDE.md (e.g. "center 42%"
   * for the storefront-hero, "center 48%" for the roadside-sign, etc.).
   * Defaults to the CSS default ("center center") if not provided.
   */
  objectPosition?: string;
}

export default function ResponsivePhoto({
  src,
  alt,
  className,
  loading = "lazy",
  fetchPriority,
  mobileBreakpoint = 768,
  disableMobile = true,
  withDepth,
  objectPosition,
}: ResponsivePhotoProps) {
  const mobileSrc = src.replace(/(\.\w+)$/, "-mobile$1");
  // Default: enable depth on lazy photos, disable on eager (LCP path).
  const depthEnabled = withDepth ?? loading === "lazy";

  const inner = (
    <picture>
      {!disableMobile && (
        <source
          media={`(max-width: ${mobileBreakpoint}px)`}
          srcSet={mobileSrc}
          type="image/webp"
        />
      )}
      <img
        src={src}
        alt={alt}
        className={className}
        loading={loading}
        fetchPriority={fetchPriority}
        style={objectPosition ? { objectPosition } : undefined}
      />
    </picture>
  );

  if (!depthEnabled) return inner;

  return <span className="photo-depth block">{inner}</span>;
}
