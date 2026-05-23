/**
 * ConesBlock — "The Cones Mean Keep Moving" trust-anchor section per
 * HOMEPAGE_MOCKUP spec. Sits between hero and stats. Asymmetric split:
 * cones photo left, three-icon explanation stack right.
 *
 * Why this exists: customers who haven't been to Nick's see the cones in
 * the parking lot and don't know why. This section explains the FCFS
 * tire-line ritual + the drop-off model in three icons. Single most
 * defensible visual differentiator the site can ship.
 *
 * Mobile: photo on top so phone customers see the cones first when
 * scrolling.
 */
import { Car, ArrowDownToLine, Wrench } from "lucide-react";

export function ConesBlock() {
  return (
    <section
      aria-labelledby="cones-heading"
      className="relative bg-[oklch(0.07_0.005_260)] overflow-hidden border-y border-border/30 halftone-light"
    >
      <div className="container py-14 lg:py-20 relative">
        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1.4fr] gap-8 lg:gap-12 items-center">
          {/* LEFT — cones photo */}
          <div className="order-1">
            <figure className="relative aspect-[4/3] sm:aspect-[1/1] overflow-hidden rounded-xl photo-depth ken-burns-target">
              <img
                src="/photos/exterior-signage-approach.webp"
                alt="Orange cones in the Nick's Tire & Auto parking lot guiding the first-come-first-served tire-install line, with one open service bay and tire stacks visible"
                width={1200}
                height={1200}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 w-full h-full object-cover"
                style={{ objectPosition: "center 60%" }}
              />
              <div className="absolute inset-0 photo-grain pointer-events-none mix-blend-overlay opacity-[0.14]" />
              <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
              <figcaption className="absolute left-4 right-4 bottom-4 text-foreground text-[13px] sm:text-base font-semibold tracking-wide drop-shadow-lg">
                Cones aren't decoration. They're the line.
              </figcaption>
            </figure>
          </div>

          {/* RIGHT — copy + 3-icon stack */}
          <div className="order-2">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-[#FDB913] uppercase mb-3">
              The Cones Mean Keep Moving
            </p>
            <h2
              id="cones-heading"
              className="font-heading text-3xl sm:text-4xl lg:text-5xl font-extrabold uppercase text-foreground tracking-tight leading-[0.9] headline-balance"
            >
              First-come-first-served. <br className="hidden sm:block" />
              <span className="text-[#FDB913] text-gradient-yellow">No appointment games.</span>
            </h2>
            <p className="mt-4 text-foreground/65 text-base sm:text-lg max-w-md body-pretty leading-relaxed">
              Pull up. The cones guide the line. The tire crew works outside. You stay in your car. Bigger repair? Drop it off — we'll call with a written estimate before any wrench moves.
            </p>

            {/* 3-icon stack — Stay In The Car / Drop It Off / We'll Handle It */}
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex flex-col items-start gap-2">
                <div className="w-10 h-10 rounded-lg bg-[#FDB913]/10 border border-[#FDB913]/30 flex items-center justify-center text-[#FDB913]">
                  <Car className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-bold text-foreground text-sm tracking-wide">STAY IN THE CAR</div>
                  <div className="text-foreground/55 text-[12px] mt-1 leading-snug">For tires. The line moves like a pit stop.</div>
                </div>
              </div>
              <div className="flex flex-col items-start gap-2">
                <div className="w-10 h-10 rounded-lg bg-[#FDB913]/10 border border-[#FDB913]/30 flex items-center justify-center text-[#FDB913]">
                  <ArrowDownToLine className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-bold text-foreground text-sm tracking-wide">DROP IT OFF</div>
                  <div className="text-foreground/55 text-[12px] mt-1 leading-snug">For brakes, check-engine, anything bigger.</div>
                </div>
              </div>
              <div className="flex flex-col items-start gap-2">
                <div className="w-10 h-10 rounded-lg bg-[#FDB913]/10 border border-[#FDB913]/30 flex items-center justify-center text-[#FDB913]">
                  <Wrench className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-bold text-foreground text-sm tracking-wide">WE'LL HANDLE IT</div>
                  <div className="text-foreground/55 text-[12px] mt-1 leading-snug">Written estimate before any wrench moves.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default ConesBlock;
