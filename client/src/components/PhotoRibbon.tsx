/**
 * PhotoRibbon — horizontally-scrolling cinematic strip of real shop photos.
 *
 * Why this exists: the strongest social proof for Nick's Tire is the
 * physical lot — cars, bays, stacks, real Cleveland weather. This
 * component turns those existing photos into a dimensional ribbon that
 * reinforces the "lines of cars" mental model before any copy is read.
 *
 * Now parameterized (2026-05-06) so service pages can pass their own
 * photo set + headline copy. Default export keeps backward-compat with
 * the Home page wiring.
 *
 * Design rules (from frontend-design + 3d-web-experience guard rails):
 *   - REAL photos only. No stock. No AI imagery.
 *   - Asymmetric widths (no AI-slop symmetry)
 *   - Each tile gets a subtle depth tilt + Ken Burns slow zoom
 *   - Horizontal scroll-snap on mobile (one-tile-at-a-time browsing)
 *   - IntersectionObserver gates the Ken Burns animations so off-screen
 *     tiles don't burn battery on older Androids
 *   - Zero JS frameworks beyond what's already in the bundle (React only)
 *   - prefers-reduced-motion fully respected (animations opt-out cleanly)
 *
 * No Three.js, no model-viewer, no GPU-heavy assets. Real photos +
 * smart CSS = more persuasive than any synthetic 3D for an auto shop.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { trackEvent } from "@/components/SEO";
import { trpc } from "@/lib/trpc";

export type RibbonPhoto = {
  src: string;
  /** Wider than tall photos look better in a landscape ribbon */
  alt: string;
  /** Caption shown over a translucent gradient at the bottom-left */
  caption: string;
  /** Tailwind width override — produces the asymmetric/non-grid feel */
  widthClass: string;
  /** CSS object-position override — useful when the focal point
   *  (e.g., the brand sign) sits off-center and gets cropped by
   *  object-cover. Default "center center". Try "center top" or
   *  "right top" for sign-prominent shots. */
  objectPosition?: string;
};

export interface PhotoRibbonProps {
  /** Defaults to the home-page Lot/Bays/Storefront set */
  photos?: RibbonPhoto[];
  /** Small all-caps eyebrow above the heading */
  eyebrow?: string;
  /** Two-line heading. Pass JSX or use defaults. */
  headingLine1?: string;
  headingLine2?: string;
  /** Sub-headline beneath */
  subhead?: string;
  /** Background tone — defaults to the dark home-page tone */
  bgClass?: string;
  /**
   * Adaptive mode — when true, fetches per-photo view counts from
   * customerEvents.topRibbonPhotos and reorders this instance's photo
   * set so top-performers lead. The curated default order is the
   * fallback for first-time visitors / sparse data. Re-orders only
   * when the leading photo has more than `minViewsForReorder` views,
   * to avoid noise from a handful of early sessions.
   *
   * Disabled by default — pages that opt in get the data-driven sort
   * without changing PhotoRibbon's behavior elsewhere.
   */
  dataDriven?: boolean;
  /** Threshold to consider data significant. Default 25. */
  minViewsForReorder?: number;
  /** Window in days. Default 30. */
  dataDrivenDays?: number;
}

// 2026-05-06 · sign-prominent photos lead. The Nick's Tire & Auto sign
// is the brand's primary trust anchor — physical proof of "real shop on
// Euclid Ave". Reordered so the first two tiles in the ribbon both
// feature the sign clearly: signage-approach view (full sign in
// foreground) then full-facade view (storefront + sign). Brand
// recognition before service variety.
const DEFAULT_PHOTOS: RibbonPhoto[] = [
  {
    src: "/photos/exterior-signage-approach.webp",
    alt: "Approaching the Nick's Tire & Auto sign on Euclid Ave Cleveland — the actual storefront sign at street level",
    caption: "The sign on Euclid you've driven past.",
    widthClass: "w-[78vw] sm:w-[440px] md:w-[520px]",
    objectPosition: "center top",
  },
  {
    src: "/photos/exterior-facade-wide.webp",
    alt: "Full facade of Nick's Tire & Auto on Euclid Ave with the storefront sign visible — Cleveland tire shop",
    caption: "Full storefront. Sign and all.",
    widthClass: "w-[80vw] sm:w-[500px] md:w-[600px]",
    objectPosition: "center 35%",
  },
  {
    src: "/photos/parking-lot-cars.webp",
    alt: "Lines of customer cars in the Nick's Tire & Auto lot on a busy Cleveland Saturday",
    caption: "Real lot. Real customers. Real lines.",
    widthClass: "w-[78vw] sm:w-[440px] md:w-[520px]",
  },
  {
    src: "/photos/service-bay-busy.webp",
    alt: "Multiple service bays running simultaneously inside the Cleveland tire shop",
    caption: "Bays running 7 days a week.",
    widthClass: "w-[68vw] sm:w-[360px] md:w-[420px]",
  },
  {
    src: "/photos/tire-stacks-overhead.webp",
    alt: "Overhead view of inventory tire stacks ready for same-day install at Nick's Tire",
    caption: "Inventory in-house. Same-day install.",
    widthClass: "w-[64vw] sm:w-[340px] md:w-[400px]",
  },
  {
    src: "/photos/exterior-winter-allweather.webp",
    alt: "Customers' cars in line at Nick's Tire & Auto during a Cleveland snowstorm",
    caption: "Open through every Cleveland storm.",
    widthClass: "w-[72vw] sm:w-[400px] md:w-[480px]",
  },
  {
    src: "/photos/alignment-bay.webp",
    alt: "Computerized alignment bay showing diagnostic readings on a customer vehicle",
    caption: "Alignment numbers on screen, not guessed.",
    widthClass: "w-[66vw] sm:w-[360px] md:w-[440px]",
  },
];

// Service-specific photo sets used by service pages. Curated to lead
// with the photo most relevant to the service while still showcasing
// the broader shop reality.
export const TIRES_PHOTOS: RibbonPhoto[] = [
  {
    src: "/photos/tire-stacks-overhead.webp",
    alt: "Tire inventory stacks at Nick's Tire & Auto — every size, in-house, ready for same-day install in Cleveland",
    caption: "Inventory on-site. No waiting on shipments.",
    widthClass: "w-[78vw] sm:w-[440px] md:w-[520px]",
  },
  {
    src: "/photos/tire-tread-closeup.webp",
    alt: "Close-up of a used tire passing the 4-point tread inspection at Nick's Tire & Auto",
    caption: "Every used tire passes a 4-point exam.",
    widthClass: "w-[72vw] sm:w-[400px] md:w-[480px]",
  },
  {
    src: "/photos/parking-lot-cars.webp",
    alt: "Customer vehicles in line for tire installation outside the Cleveland tire shop",
    caption: "Lines on Saturdays for a reason.",
    widthClass: "w-[80vw] sm:w-[480px] md:w-[560px]",
  },
  {
    src: "/photos/service-bay-busy.webp",
    alt: "Tire mount and balance happening across multiple bays at Nick's Tire & Auto",
    caption: "Free mount, balance, valve stems.",
    widthClass: "w-[64vw] sm:w-[340px] md:w-[400px]",
  },
  {
    src: "/photos/exterior-winter-allweather.webp",
    alt: "Cleveland winter weather at Nick's Tire & Auto — same-day winter tire install",
    caption: "Snow tires today. Today.",
    widthClass: "w-[72vw] sm:w-[400px] md:w-[480px]",
  },
];

export const BRAKES_PHOTOS: RibbonPhoto[] = [
  {
    src: "/photos/service-bay-clean.webp",
    alt: "Clean service bay at Nick's Tire & Auto where brake jobs happen — Cleveland brake repair shop",
    caption: "Walk in, walk under your own car, see the part.",
    widthClass: "w-[78vw] sm:w-[440px] md:w-[520px]",
  },
  {
    src: "/photos/service-bay-busy.webp",
    alt: "Multiple bays running brake jobs simultaneously at Nick's Tire & Auto in Cleveland",
    caption: "Pads, rotors, calipers, lines, ABS.",
    widthClass: "w-[68vw] sm:w-[380px] md:w-[440px]",
  },
  {
    src: "/photos/parking-lot-cars.webp",
    alt: "Customer cars waiting for brake service in the lot at Nick's Tire & Auto",
    caption: "Same-day brake job. Walk-ins welcome.",
    widthClass: "w-[76vw] sm:w-[420px] md:w-[500px]",
  },
  {
    src: "/photos/alignment-bay.webp",
    alt: "Diagnostic alignment readings inform the brake-pull diagnosis at Nick's Tire & Auto",
    caption: "Brake pull? We measure, not guess.",
    widthClass: "w-[66vw] sm:w-[360px] md:w-[420px]",
  },
];

export const DIAGNOSTICS_PHOTOS: RibbonPhoto[] = [
  {
    src: "/photos/alignment-bay.webp",
    alt: "Computerized diagnostic readout at Nick's Tire & Auto's Cleveland alignment and diagnostic bay",
    caption: "Numbers on screen, in real English.",
    widthClass: "w-[80vw] sm:w-[480px] md:w-[560px]",
  },
  {
    src: "/photos/service-bay-clean.webp",
    alt: "OBD-II scan in progress at the Cleveland diagnostic shop",
    caption: "Free OBD-II scan. Written estimate before any wrench.",
    widthClass: "w-[72vw] sm:w-[400px] md:w-[480px]",
  },
  {
    src: "/photos/front-desk.webp",
    alt: "Diagnostic write-up handed to a customer at the Nick's Tire & Auto front desk",
    caption: "We explain the code. You decide the move.",
    widthClass: "w-[68vw] sm:w-[380px] md:w-[440px]",
  },
  {
    src: "/photos/service-bay-busy.webp",
    alt: "Multiple diagnostic jobs running in the Cleveland auto repair shop bays",
    caption: "Same-day diagnosis on most makes.",
    widthClass: "w-[64vw] sm:w-[340px] md:w-[400px]",
  },
];

export function PhotoRibbon({
  photos = DEFAULT_PHOTOS,
  eyebrow = "The Lot · The Bays · The Real Thing",
  headingLine1 = "Walk past on Euclid",
  headingLine2 = "and you'll see this.",
  subhead = "No stock photos. No staging. Just the actual shop running on a normal day.",
  bgClass = "bg-[oklch(0.05_0.004_260)]",
  dataDriven = false,
  minViewsForReorder = 25,
  dataDrivenDays = 30,
}: PhotoRibbonProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  // Adaptive sort — fetch per-photo view counts only when the page
  // opted in. Skipped entirely for non-data-driven instances so we
  // don't add a tRPC round-trip to every page view.
  const { data: topPhotosData } = trpc.customerEvents.topRibbonPhotos.useQuery(
    { days: dataDrivenDays, limit: 50 },
    {
      enabled: dataDriven,
      staleTime: 5 * 60 * 1000,
    },
  );

  // Reorder photos by view count when adaptive mode is on AND the
  // top photo has crossed the significance threshold. Otherwise keep
  // the curated order so first-time visitors get the intentional
  // narrative arc the operator hand-picked.
  const orderedPhotos = useMemo(() => {
    if (!dataDriven || !topPhotosData || topPhotosData.length === 0) return photos;
    const top = topPhotosData[0];
    if (!top || (top.count ?? 0) < minViewsForReorder) return photos;

    const counts = new Map<string, number>();
    for (const p of topPhotosData) {
      if (p.src) counts.set(p.src, p.count ?? 0);
    }
    // Stable sort by count DESC, falling back to original index for ties
    return [...photos]
      .map((p, idx) => ({ p, idx, c: counts.get(p.src) ?? 0 }))
      .sort((a, b) => (b.c - a.c) || (a.idx - b.idx))
      .map((x) => x.p);
  }, [dataDriven, topPhotosData, photos, minViewsForReorder]);
  // Track which photos have been counted as "viewed" (>50% in
  // viewport for >300ms) so we don't fire repeat events.
  const viewedRef = useRef<Set<string>>(new Set());

  // Gate Ken Burns + tilt animations until the ribbon enters the
  // viewport. Off-screen animations on older Androids are pure waste.
  useEffect(() => {
    if (!railRef.current) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setVisible(true);
            obs.disconnect();
          }
        });
      },
      { rootMargin: "200px" }
    );
    obs.observe(railRef.current);
    return () => obs.disconnect();
  }, []);

  // Per-photo view tracking. Fires a "ribbon_photo_view" event the
  // first time a photo crosses 50% visibility, with the photo's src
  // and index. Lets us see which photos drive engagement and tune
  // the curated photo sets per service over time.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const photoEls = Array.from(
      rail.querySelectorAll<HTMLElement>(".photo-rail-item")
    );
    if (photoEls.length === 0) return;

    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const el = entry.target as HTMLElement;
          const src = el.dataset.src;
          const idx = el.dataset.idx;
          if (!src || viewedRef.current.has(src)) return;
          if (entry.intersectionRatio >= 0.5) {
            viewedRef.current.add(src);
            trackEvent("ribbon_photo_view", { src, index: Number(idx ?? 0) });
          }
        });
      },
      { threshold: [0.5] }
    );
    photoEls.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [orderedPhotos]);

  return (
    <section
      aria-labelledby="photo-ribbon-heading"
      className={`${bgClass} py-14 lg:py-20 border-y border-border/30 overflow-hidden`}
    >
      <div className="container mb-8 lg:mb-10 flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-[#FDB913] uppercase mb-2">
            {eyebrow}
          </p>
          <h2
            id="photo-ribbon-heading"
            className="font-heading text-3xl sm:text-4xl lg:text-5xl font-extrabold uppercase text-foreground tracking-tight leading-[0.9]"
          >
            {headingLine1} <br className="hidden sm:block" />
            <span className="text-[#FDB913] text-gradient-yellow">{headingLine2}</span>
          </h2>
          {subhead && (
            <p className="mt-3 text-foreground/55 text-sm sm:text-base max-w-md">{subhead}</p>
          )}
        </div>

        <div className="hidden lg:flex items-center gap-2 text-[11px] tracking-wider text-foreground/40 uppercase">
          <span className="w-8 h-px bg-foreground/30" />
          Scroll →
        </div>
      </div>

      {/* The ribbon itself — horizontal scroll-snap with depth */}
      <div
        ref={railRef}
        className={`photo-rail flex gap-4 lg:gap-5 px-4 lg:px-[max(2rem,calc((100vw-1280px)/2))] pb-4 ${
          visible ? "photo-rail-active" : ""
        }`}
      >
        {orderedPhotos.map((p, i) => (
          <figure
            key={p.src}
            data-src={p.src}
            data-idx={i}
            className={`photo-rail-item relative shrink-0 ${p.widthClass} aspect-[4/3] sm:aspect-[3/2] overflow-hidden rounded-xl`}
            style={{ animationDelay: `${i * 90}ms` }}
          >
            <img
              src={p.src}
              alt={p.alt}
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
              /* Explicit dimensions — browser computes the layout box
                 before pixel data arrives, eliminating CLS regression
                 for slow-network Cleveland customers. Intrinsic ratio
                 is preserved by the figure's aspect-[4/3] / [3/2]. */
              width={1200}
              height={800}
              className="absolute inset-0 w-full h-full object-cover"
              style={p.objectPosition ? { objectPosition: p.objectPosition } : undefined}
              onError={(e) => {
                /* Network or 404 fallback — swap in a transparent SVG
                   so the captioned card still renders without a broken-
                   image icon. The aspect-ratio container preserves layout. */
                const img = e.currentTarget;
                img.style.opacity = "0";
                img.parentElement?.classList.add("photo-rail-item-error");
              }}
            />
            {/* Photo grain — purely CSS via inline SVG noise, no asset bytes */}
            <div className="absolute inset-0 photo-grain pointer-events-none mix-blend-overlay opacity-[0.18]" />
            {/* Bottom gradient + caption */}
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/30 to-transparent pointer-events-none" />
            <figcaption className="absolute left-4 bottom-4 right-4 text-foreground text-[13px] sm:text-base font-semibold tracking-wide drop-shadow-lg">
              {p.caption}
            </figcaption>
            {/* Index marker — small numerical anchor (frontend-design "1 memorable anchor" rule) */}
            <span className="absolute top-3 right-3 text-[10px] font-mono tracking-[0.2em] text-foreground/60 bg-black/35 backdrop-blur-sm px-2 py-1 rounded">
              {String(i + 1).padStart(2, "0")} / {String(orderedPhotos.length).padStart(2, "0")}
            </span>
          </figure>
        ))}
      </div>
    </section>
  );
}

export default PhotoRibbon;
