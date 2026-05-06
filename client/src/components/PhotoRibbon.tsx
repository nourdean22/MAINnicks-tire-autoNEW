/**
 * PhotoRibbon — horizontally-scrolling cinematic strip of real shop photos.
 *
 * Why this exists: the strongest social proof for Nick's Tire is the
 * physical lot — cars, bays, stacks, real Cleveland weather. This
 * component turns those existing photos into a dimensional ribbon that
 * reinforces the "lines of cars" mental model before any copy is read.
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
import { useEffect, useRef, useState } from "react";

type RibbonPhoto = {
  src: string;
  /** Wider than tall photos look better in a landscape ribbon */
  alt: string;
  /** Caption shown over a translucent gradient at the bottom-left */
  caption: string;
  /** Tailwind width override — produces the asymmetric/non-grid feel */
  widthClass: string;
};

const PHOTOS: RibbonPhoto[] = [
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
    src: "/photos/exterior-facade-wide.webp",
    alt: "The Nick's Tire & Auto storefront on Euclid Ave, full facade view",
    caption: "Right on Euclid Ave.",
    widthClass: "w-[80vw] sm:w-[500px] md:w-[600px]",
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

export function PhotoRibbon() {
  const railRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

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

  return (
    <section
      aria-labelledby="photo-ribbon-heading"
      className="bg-[oklch(0.05_0.004_260)] py-14 lg:py-20 border-y border-border/30 overflow-hidden"
    >
      <div className="container mb-8 lg:mb-10 flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-[#FDB913] uppercase mb-2">
            The Lot · The Bays · The Real Thing
          </p>
          <h2
            id="photo-ribbon-heading"
            className="font-heading text-3xl sm:text-4xl lg:text-5xl font-extrabold uppercase text-foreground tracking-tight leading-[0.9]"
          >
            Walk past on Euclid <br className="hidden sm:block" />
            <span className="text-[#FDB913] text-gradient-yellow">and you'll see this.</span>
          </h2>
          <p className="mt-3 text-foreground/55 text-sm sm:text-base max-w-md">
            No stock photos. No staging. Just the actual shop running on a normal day.
          </p>
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
        {PHOTOS.map((p, i) => (
          <figure
            key={p.src}
            className={`photo-rail-item relative shrink-0 ${p.widthClass} aspect-[4/3] sm:aspect-[3/2] overflow-hidden rounded-xl`}
            style={{ animationDelay: `${i * 90}ms` }}
          >
            <img
              src={p.src}
              alt={p.alt}
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover"
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
              {String(i + 1).padStart(2, "0")} / {String(PHOTOS.length).padStart(2, "0")}
            </span>
          </figure>
        ))}
      </div>
    </section>
  );
}

export default PhotoRibbon;
