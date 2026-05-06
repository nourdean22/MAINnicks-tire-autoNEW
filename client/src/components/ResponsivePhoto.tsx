/**
 * ResponsivePhoto — drop-in replacement for <img> on photos that have
 * a `-mobile.webp` sibling.
 *
 * Browsers under 768px viewport download the mobile variant (~85-180 KB)
 * instead of the desktop variant (~200-470 KB). 50-80% mobile bandwidth
 * savings per image, captures the Lighthouse "Improve image delivery"
 * 329 KiB win.
 *
 * Convention: if `src` is `/photo.webp`, the mobile variant is expected
 * at `/photo-mobile.webp` (same /public directory). Generated via the
 * scripts/optimize-photos.mjs one-time build.
 *
 * Usage:
 *   <ResponsivePhoto
 *     src="/storefront-day.webp"
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
  /** Disable mobile-variant if you know the file doesn't have a -mobile sibling. */
  disableMobile?: boolean;
  /**
   * 2026-05-05 — wrap the <picture> in a `.photo-depth` span so the
   * 3D-depth CSS layer applies hover-zoom + radial vignette on the
   * photo container. Defaults to true for non-LCP photos; LCP photos
   * (loading="eager") opt out to keep paint cost minimal.
   */
  withDepth?: boolean;
}

export default function ResponsivePhoto({
  src,
  alt,
  className,
  loading = "lazy",
  fetchPriority,
  mobileBreakpoint = 768,
  disableMobile = false,
  withDepth,
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
      />
    </picture>
  );

  if (!depthEnabled) return inner;

  return <span className="photo-depth block">{inner}</span>;
}
