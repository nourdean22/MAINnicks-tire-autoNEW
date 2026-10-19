import { photoSrcSet } from "@/lib/photoSrcSet";

// Real photos (shop-media job, 2026-10-18): what a driver sees pulling in,
// then the storefront. Shown beside the directions on Home, /contact and
// /tire-shop-near-me. Caption is the short form on purpose: the longer
// "marked tire line" wording was not verified against the lot layout.
const APPROACH = "/photos/nicks-tire-auto-roadside-sign-approach.webp";
const ENTRANCE = "/photos/nicks-tire-auto-euclid-ave-entrance.webp";
const SIZES = "(min-width: 1024px) 300px, 50vw";

export default function ArrivalPhotos({ className = "" }: { className?: string }) {
  return (
    <figure data-testid="arrival-photos" className={className}>
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <img
          src={APPROACH}
          srcSet={photoSrcSet(APPROACH)}
          sizes={SIZES}
          alt="The Nick's Tire & Auto roadside sign on Euclid Avenue as you pull in, with a car parked in the lot"
          width={1440}
          height={1920}
          loading="lazy"
          decoding="async"
          className="aspect-[4/3] w-full rounded-xl object-cover [object-position:center_25%]"
        />
        <img
          src={ENTRANCE}
          srcSet={photoSrcSet(ENTRANCE, 1920)}
          sizes={SIZES}
          alt="The Nick's Tire & Auto storefront and service bays on Euclid Avenue, seen from the front lot"
          width={1920}
          height={1440}
          loading="lazy"
          decoding="async"
          className="aspect-[4/3] w-full rounded-xl object-cover"
        />
      </div>
      <figcaption className="mt-3 text-sm text-foreground/70">
        This is the Euclid Avenue entrance. Pull in and come to the counter.
      </figcaption>
    </figure>
  );
}
