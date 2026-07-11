import {
  ArrowRight,
  BrainCircuit,
  ClipboardCheck,
  Eye,
  FileText,
  Star,
  Wrench,
} from "lucide-react";
import { Link } from "wouter";
import { trackEvent } from "@/components/SEO";
import { BUSINESS } from "@shared/business";

const PROCESS_STEPS = [
  {
    number: "01",
    title: "PULL IN OR DROP IT OFF",
    icon: ClipboardCheck,
    body: `${BUSINESS.model.noAppointment}. ${BUSINESS.model.walkIns}. Wait with it or leave the keys and keep moving.`,
  },
  {
    number: "02",
    title: "WE CHECK THE CAR",
    icon: Wrench,
    body: "We follow the symptom to the cause instead of selling the first part that sounds related.",
  },
  {
    number: "03",
    title: "YOU SEE THE PROBLEM AND THE NUMBER",
    icon: Eye,
    body: "We show you what we found and put the cost in writing before the work starts.",
  },
  {
    number: "04",
    title: "YOU DECIDE",
    icon: FileText,
    body: "Approve the work, use a payment program, or take the car. Nothing moves without your yes.",
  },
] as const;

const PROOF_CARDS = [
  {
    eyebrow: "THE CAPABILITY",
    title: "ONE SHOP CAN FOLLOW THE PROBLEM",
    icon: Wrench,
    body: `${BUSINESS.ase.capability}. Tires, brakes, electrical faults, emissions failures, cooling, steering, engine, and transmission work can stay under one roof when the job fits our crew and equipment.`,
    detail: "If it belongs somewhere else, we say that before you spend money.",
  },
  {
    eyebrow: "THE OPERATING SYSTEM",
    title: "AI KEEPS THE DETAILS FROM GETTING LOST",
    icon: BrainCircuit,
    body: "AI-assisted systems help organize calls, service history, parts research, customer updates, follow-ups, and daily shop data. That gives the crew more context and gives you a clearer answer when you call or come in.",
    detail: "Software organizes the information. People check the car and make the call.",
  },
  {
    eyebrow: "THE PUBLIC RECORD",
    title: `${BUSINESS.reviews.countDisplay} REVIEWS. READ THEM YOURSELF.`,
    icon: Star,
    body: `${BUSINESS.reviews.rating} stars across ${BUSINESS.reviews.countDisplay} ${BUSINESS.reviews.source} reviews gives you more than a slogan. It gives you a deep public record from people who already brought us their cars.`,
    detail: `${BUSINESS.founded.display} at one independent location on Euclid Ave.`,
  },
] as const;

function trackServicesAction(action: string, destination: string) {
  trackEvent("services_cta_click", {
    surface: "process_and_proof",
    action,
    destination,
  });
}

export default function ServicesDifferentiators() {
  return (
    <section className="relative overflow-hidden border-y border-border/30 bg-card/30 py-16 lg:py-24">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(253,185,19,0.09),transparent_32%),radial-gradient(circle_at_88%_82%,rgba(34,94,168,0.08),transparent_30%)]" />

      <div className="container relative">
        <div className="grid gap-8 lg:grid-cols-[1.08fr_0.92fr] lg:items-end">
          <div className="max-w-3xl">
            <span className="font-mono text-sm tracking-wide text-primary">
              HOW IT WORKS
            </span>
            <h2 className="mt-3 font-heading text-3xl font-black uppercase tracking-tight text-foreground sm:text-4xl lg:text-5xl">
              Pull in. See it.
              <br />
              <span className="text-primary">Decide.</span>
            </h2>
          </div>

          <p className="max-w-xl text-base leading-relaxed text-foreground/70 lg:justify-self-end lg:text-lg">
            The repair may be complicated. Getting an answer should not be. We built the process around one rule: you see the problem and the cost before you choose the next move.
          </p>
        </div>

        <div className="mt-12 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {PROCESS_STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <article
                key={step.number}
                className="relative overflow-hidden rounded-2xl border border-border/40 bg-background/70 p-6"
              >
                <span className="absolute right-4 top-2 font-mono text-5xl font-black text-foreground/[0.04]">
                  {step.number}
                </span>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 font-heading text-xl font-black uppercase tracking-tight text-foreground">
                  {step.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-foreground/65">
                  {step.body}
                </p>
              </article>
            );
          })}
        </div>

        <div className="mt-12 border-t border-border/30 pt-12">
          <div className="mb-8 max-w-3xl">
            <span className="font-mono text-sm tracking-wide text-primary">
              WHY THIS SHOP RUNS DIFFERENTLY
            </span>
            <h2 className="mt-3 font-heading text-3xl font-black uppercase tracking-tight text-foreground sm:text-4xl">
              The car gets fixed in the bay.
              <br />
              <span className="text-primary">The rest should not be a mess.</span>
            </h2>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {PROOF_CARDS.map((card) => {
              const Icon = card.icon;
              return (
                <article
                  key={card.title}
                  className="group flex h-full flex-col rounded-2xl border border-border/40 bg-background/65 p-7 transition-colors hover:border-primary/40"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <p className="mt-6 font-mono text-xs uppercase tracking-[0.18em] text-primary">
                    {card.eyebrow}
                  </p>
                  <h3 className="mt-2 font-heading text-2xl font-black uppercase tracking-tight text-foreground">
                    {card.title}
                  </h3>
                  <p className="mt-3 leading-relaxed text-foreground/65">
                    {card.body}
                  </p>
                  <p className="mt-auto pt-5 text-sm leading-relaxed text-foreground/50">
                    {card.detail}
                  </p>
                  {card.eyebrow === "THE PUBLIC RECORD" && (
                    <a
                      href={BUSINESS.reviews.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => trackServicesAction("read_reviews", BUSINESS.reviews.url)}
                      className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline"
                    >
                      Read the public record
                      <ArrowRight className="h-4 w-4" />
                    </a>
                  )}
                </article>
              );
            })}
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-5 border-t border-border/30 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-sm leading-relaxed text-foreground/60">
            Free check. Written quote. You don't pay until you say yes. That promise only works when the shop behind it is organized enough to keep it.
          </p>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/diagnose"
              onClick={() => trackServicesAction("describe_problem", "/diagnose")}
              className="inline-flex items-center gap-2 rounded-full border border-border/50 px-5 py-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              Describe the problem
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/contact"
              onClick={() => trackServicesAction("drop_off", "/contact")}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Drop it off
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
