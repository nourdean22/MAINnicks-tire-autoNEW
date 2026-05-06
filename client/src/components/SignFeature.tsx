/**
 * SignFeature — dedicated trust-anchor section featuring the Nick's
 * Tire & Auto storefront sign prominently.
 *
 * Why this exists: the brand sign on Euclid Ave is the single highest-
 * signal piece of physical proof. Customers who've driven past it
 * recognize the visual instantly; new customers absorb "real shop,
 * real address." Buried inside a photo ribbon, the sign competes with
 * 6 other photos. Given its own section, it does the trust-anchor
 * work explicitly.
 *
 * Design rules (frontend-design + Antigravity):
 *   - ONE memorable anchor (the sign itself, full-bleed-style)
 *   - Asymmetric split (kills AI-slop symmetry)
 *   - Real address as the proof element, not a marketing tagline
 *   - Mobile fallback: stacked, sign on top so it lands first
 */
import { MapPin, Phone } from "lucide-react";
import { BUSINESS } from "@shared/business";
import { trackPhoneClick } from "@/components/SEO";

export function SignFeature() {
  return (
    <section
      aria-labelledby="sign-feature-heading"
      className="relative bg-[oklch(0.06_0.004_260)] overflow-hidden border-y border-border/30"
    >
      {/* Decorative halftone for "shop manual" texture */}
      <div className="halftone-light absolute inset-0 pointer-events-none" />

      <div className="container py-14 lg:py-20 relative">
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1.4fr] gap-8 lg:gap-12 items-center">
          {/* LEFT — copy block */}
          <div className="order-2 lg:order-1">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-[#FDB913] uppercase mb-3">
              17625 Euclid Ave · Cleveland · OH
            </p>
            <h2
              id="sign-feature-heading"
              className="font-heading text-3xl sm:text-4xl lg:text-5xl font-extrabold uppercase text-foreground tracking-tight leading-[0.9] headline-balance"
            >
              The sign you've <br className="hidden sm:block" />
              <span className="text-[#FDB913] text-gradient-yellow">driven past.</span>
            </h2>
            <p className="mt-4 text-foreground/65 text-base sm:text-lg max-w-md body-pretty leading-relaxed">
              We're not a Yelp ghost. We're not an ad with no address. We're the yellow sign on Euclid Avenue you've passed a hundred times. Pull in any day we're awake — which is all of them — and you'll find a lift, a flashlight, and an estimate before any wrench moves.
            </p>

            {/* Address + map + call CTA */}
            <div className="mt-6 flex flex-col sm:flex-row gap-3 flex-wrap">
              <a
                href={BUSINESS.urls.googleBusiness}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-[#FDB913] text-[#0A0A0A] px-5 py-3 rounded-md font-semibold text-sm hover:bg-[#FDB913]/90 transition-colors btn-premium"
                aria-label="Get directions to Nick's Tire and Auto on Euclid Ave"
              >
                <MapPin className="w-4 h-4" />
                Directions to the sign
              </a>
              <a
                href={BUSINESS.phone.href}
                onClick={() => trackPhoneClick("sign-feature")}
                className="inline-flex items-center gap-2 border-2 border-[#FDB913]/60 text-[#FDB913] px-5 py-3 rounded-md font-semibold text-sm hover:bg-[#FDB913]/10 transition-colors"
              >
                <Phone className="w-4 h-4" />
                {BUSINESS.phone.display}
              </a>
            </div>

            {/* Hours snippet — small, factual, anti-pattern-named */}
            <div className="mt-5 text-[12px] text-foreground/40 leading-relaxed">
              <span className="font-semibold text-foreground/60">Mon–Sat 8a–6p · Sun 9a–4p.</span>
              <br />
              The chains close Sunday. We don't.
            </div>
          </div>

          {/* RIGHT — sign photo, full bleed in container */}
          <div className="order-1 lg:order-2 relative">
            <figure className="relative aspect-[4/3] sm:aspect-[16/10] overflow-hidden rounded-xl photo-depth ken-burns-target">
              {/* 2026-05-06 wave-27 · brand-sign.webp is a 1600×239
                  panoramic banner crop (aspect 6.69:1). object-fit:cover
                  inside a 16/10 figure forces a 4× vertical zoom and
                  shows only ~27% of the sign horizontally — no
                  object-position can recover the full headline.
                  Switched to object-fit:contain so the FULL sign,
                  including "TIRE & AUTO REPAIR · (216) 862-0005" and
                  the address block, always reads. The figure's dark
                  background absorbs the vertical letterbox, and the
                  bottom-fade overlay keeps the caption pin legible. */}
              <img
                src="/brand-sign.webp"
                alt="The Nick's Tire & Auto storefront sign on Euclid Avenue, Cleveland, OH — yellow letters reading TIRE & AUTO REPAIR with phone (216) 862-0005, two stories, visible from Lakeshore Boulevard"
                width={1600}
                height={239}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 w-full h-full object-contain"
                style={{ objectPosition: "center center" }}
              />
              {/* Photo grain — subtle film texture */}
              <div className="absolute inset-0 photo-grain pointer-events-none mix-blend-overlay opacity-[0.14]" />
              {/* Bottom gradient + caption pin */}
              <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
              <figcaption className="absolute left-4 right-4 bottom-4 flex items-center justify-between gap-3">
                <span className="text-foreground text-[13px] sm:text-base font-semibold tracking-wide drop-shadow-lg">
                  Yellow letters. Real address.
                </span>
                <span className="text-[10px] font-mono tracking-[0.2em] text-foreground/70 bg-black/40 backdrop-blur-sm px-2 py-1 rounded">
                  17625
                </span>
              </figcaption>
            </figure>
          </div>
        </div>
      </div>
    </section>
  );
}

export default SignFeature;
