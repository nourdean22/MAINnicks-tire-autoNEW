import {
  ArrowRight,
  BrainCircuit,
  ClipboardCheck,
  Gauge,
  Star,
  Wrench,
} from "lucide-react";
import { Link } from "wouter";
import { BUSINESS } from "@shared/business";

const proofCards = [
  {
    eyebrow: "THE PROCESS",
    title: "NO APPOINTMENT MAZE",
    icon: ClipboardCheck,
    body: `${BUSINESS.model.walkIns}. Wait with it or drop it off. We check the car, show you what we found, and write the cost down before work starts. You decide.`,
    detail: BUSINESS.hours.shortDisplay,
  },
  {
    eyebrow: "THE CAPABILITY",
    title: "WE TAKE THE JOBS WE CAN STAND BEHIND",
    icon: Wrench,
    body: `${BUSINESS.ase.display}. Tires, brakes, electrical faults, emissions failures, cooling, steering, engine and transmission work can all be handled under one roof.`,
    detail: "If it belongs somewhere else, we say that first.",
  },
  {
    eyebrow: "THE SYSTEM",
    title: "AI BEHIND THE COUNTER. PEOPLE IN THE BAY.",
    icon: BrainCircuit,
    body: "AI-assisted tools help us organize calls, service history, follow-ups, and daily shop data so fewer details fall through the cracks. Software keeps the information straight. The crew still checks the car and turns the wrench.",
    detail: "Technology supports the work. It never replaces the check.",
  },
  {
    eyebrow: "THE PROOF",
    title: `${BUSINESS.reviews.countDisplay} PUBLIC RECEIPTS`,
    icon: Star,
    body: `${BUSINESS.reviews.rating} stars across ${BUSINESS.reviews.countDisplay} Google reviews is not a slogan. It is a public record built one car, one quote, and one decision at a time.`,
    detail: `${BUSINESS.founded.display} on Euclid Ave`,
  },
] as const;

export default function ServicesDifferentiators() {
  return (
    <section className="relative overflow-hidden border-y border-border/30 bg-card/30 py-16 lg:py-24">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(253,185,19,0.09),transparent_32%),radial-gradient(circle_at_88%_82%,rgba(34,94,168,0.08),transparent_30%)]" />

      <div className="container relative">
        <div className="grid gap-8 lg:grid-cols-[1.12fr_0.88fr] lg:items-end">
          <div className="max-w-3xl">
            <span className="font-mono text-sm tracking-wide text-primary">
              WHY THIS SHOP FEELS EASIER
            </span>
            <h2 className="mt-3 font-heading text-3xl font-black uppercase tracking-tight text-foreground sm:text-4xl lg:text-5xl">
              The car gets fixed in the bay.
              <br />
              <span className="text-primary">The rest should not be a mess.</span>
            </h2>
          </div>

          <p className="max-w-xl text-base leading-relaxed text-foreground/70 lg:justify-self-end lg:text-lg">
            Most shops make the customer carry the friction. We moved it to our side of the counter: easier entry, clearer decisions, stronger follow-through, and enough capability to take on serious work when it makes sense.
          </p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {proofCards.map((card, index) => {
            const Icon = card.icon;

            return (
              <article
                key={card.title}
                className="group relative overflow-hidden rounded-2xl border border-border/40 bg-background/65 p-7 transition-colors hover:border-primary/40"
              >
                <div className="absolute right-5 top-3 font-mono text-6xl font-black text-foreground/[0.035]">
                  {String(index + 1).padStart(2, "0")}
                </div>

                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>

                <p className="mt-6 font-mono text-xs uppercase tracking-[0.18em] text-primary">
                  {card.eyebrow}
                </p>
                <h3 className="mt-2 max-w-xl font-heading text-2xl font-black uppercase tracking-tight text-foreground">
                  {card.title}
                </h3>
                <p className="mt-3 max-w-xl leading-relaxed text-foreground/65">
                  {card.body}
                </p>
                <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-border/40 px-3 py-1.5 font-mono text-xs text-foreground/60">
                  <Gauge className="h-3.5 w-3.5 text-primary" />
                  {card.detail}
                </div>
              </article>
            );
          })}
        </div>

        <div className="mt-8 flex flex-col gap-4 border-t border-border/30 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-sm leading-relaxed text-foreground/60">
            Free check. Written quote. You do not pay until you say yes. That simple line only works when the shop behind it is organized enough to keep it.
          </p>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/diagnose"
              className="inline-flex items-center gap-2 rounded-full border border-border/50 px-5 py-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              Describe the problem
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Drop off today
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
