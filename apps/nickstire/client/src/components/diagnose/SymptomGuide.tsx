/**
 * Static, crawlable symptom guide that sits under the /diagnose tool.
 *
 * WHY THIS EXISTS
 * The tool's answers are generated per-visitor and never reach an index — so
 * /diagnose had almost nothing crawlable on it beyond nav chrome and a form.
 * A page whose entire value is behind a button click is not a search asset, no
 * matter how good the button is. This is the part Google can actually read: the
 * plain-language answers people search for at 11pm, each one routed to the
 * dedicated problem page that already exists for it.
 *
 * EDITING RULES
 * - Every claim here must be something the shop would say out loud to a
 *   customer's face. No invented statistics, no invented prices, no scare copy.
 * - `urgent` lines must agree with server/diagnose-safety.ts RED_FLAG_RULES.
 *   If you change a stop-driving rule there, change it here too — customers
 *   reading this and customers running the tool must not get different answers.
 * - Links must point at pages that exist (see App.tsx). A guide that 404s is
 *   worse than no guide.
 */

import { Link } from "wouter";
import { ChevronRight, ShieldAlert } from "lucide-react";

type GuideEntry = {
  id: string;
  /** The question as a customer would type it into Google. */
  question: string;
  /** Plain answer. What it usually means, in the shop's voice. */
  answer: string;
  /** Concrete specifics — the part that makes this worth reading. */
  points: string[];
  /** When it stops being a "book it soon" and becomes a "stop driving". */
  urgent?: string;
  links: { href: string; label: string }[];
};

const GUIDE: GuideEntry[] = [
  {
    id: "check-engine-light",
    question: "What does the check engine light mean?",
    answer:
      "It means the computer stored a fault code — not that your engine is about to die. The important part is whether the light is steady or flashing, and almost nobody tells you that.",
    points: [
      "Steady light: the car logged a fault. Common causes run from a loose gas cap to an oxygen sensor to a misfire. It's a \"get it read soon\" job, not an emergency.",
      "Flashing light: that's a misfire actively dumping raw fuel into the exhaust. It can cook the catalytic converter in minutes, and that turns a small repair into a big one.",
      "The code is a starting point, not a diagnosis. A code that says \"oxygen sensor\" often means something upstream is making the sensor read wrong. Replacing the part the code names is how people waste money.",
    ],
    urgent: "If it's flashing, pull over and shut it off. Don't drive it home to deal with later.",
    links: [
      { href: "/check-engine-light-flashing", label: "Flashing check engine light" },
      { href: "/check-engine-light-on", label: "Check engine light on" },
      { href: "/diagnostics", label: "Our diagnostic service" },
    ],
  },
  {
    id: "wont-start",
    question: "Why won't my car start?",
    answer:
      "What it does when you turn the key narrows it down fast. There's a real difference between cranking, clicking, and doing nothing at all.",
    points: [
      "Cranks but won't fire: it's turning over, so the battery is probably fine. You're missing fuel, spark, or compression.",
      "Single click, or rapid clicking: usually not enough current. That's a weak battery, corroded terminals, or a starter drawing too much.",
      "Nothing at all — no lights, no click: think battery, connections, or ignition switch before anything expensive.",
      "Starts fine, then dies in traffic and won't restart hot: that pattern points somewhere different than a no-start-cold. Tell us which one it is.",
    ],
    links: [
      { href: "/car-wont-start", label: "Car won't start" },
      { href: "/battery-keeps-dying", label: "Battery keeps dying" },
      { href: "/starter-alternator", label: "Starter & alternator" },
    ],
  },
  {
    id: "brake-noise",
    question: "Why are my brakes squealing or grinding?",
    answer:
      "Squealing and grinding are two different stages of the same story, and the gap between them is money.",
    points: [
      "Squeal: many pads have a small metal wear tab that's designed to squeal when the pad gets thin. That's the car asking for pads — the cheap stage.",
      "Grinding, metal-on-metal: the pad material is gone and the backing plate is cutting the rotor. Now you're buying rotors too.",
      "A light squeak on a cold, damp morning that goes away after a few stops is usually just surface rust burning off. That one's normal.",
      "Pulling to one side while braking, or a pedal that sinks toward the floor, is not a pad-wear noise. That's a different problem.",
    ],
    urgent: "A pedal that goes to the floor, or a car that won't stop the way it should, gets towed — not driven in.",
    links: [
      { href: "/brakes-grinding", label: "Brakes grinding" },
      { href: "/grinding-noise-when-braking", label: "Grinding noise when braking" },
      { href: "/brakes", label: "Brake service" },
    ],
  },
  {
    id: "shaking",
    question: "Why is my car shaking?",
    answer:
      "When it shakes tells you more than how hard it shakes. Pay attention to what you're doing when it starts.",
    points: [
      "Only while braking: think rotors or a sticking caliper — the shake follows the brake pedal.",
      "At one specific speed, usually somewhere around highway pace, and smooth again above and below: that's the classic wheel-balance signature.",
      "At idle, sitting still in gear: that's an engine-running-rough problem, not a wheel problem.",
      "In the steering wheel means it's usually front. Felt in the seat or the floor means it's usually rear.",
    ],
    urgent: "Violent shaking, or the car feeling like it's getting away from you at speed, means stop driving it.",
    links: [
      { href: "/car-shaking-while-driving", label: "Car shaking while driving" },
      { href: "/steering-wheel-shaking", label: "Steering wheel shaking" },
      { href: "/alignment", label: "Alignment & balance" },
    ],
  },
  {
    id: "leaks",
    question: "What's the puddle under my car?",
    answer:
      "Colour and location do most of the work. Slide a piece of cardboard under it overnight and you'll know a lot more than you did.",
    points: [
      "Clear and watery, under the passenger side on a hot day: that's almost always AC condensation. Not a leak. Nothing to fix.",
      "Light brown to black, slick: engine oil. Where it sits under the car matters more than how much there is.",
      "Green, orange, or pink and slightly sweet-smelling: coolant. Worth taking seriously — this is the thing that turns into an overheat.",
      "Reddish and thin: transmission or power steering fluid.",
      "A drop or two after it sits is a different conversation than a spreading puddle you can see forming.",
    ],
    links: [
      { href: "/oil-leak-under-car", label: "Oil leak under car" },
      { href: "/cooling", label: "Cooling system service" },
      { href: "/general-repair", label: "General repair" },
    ],
  },
  {
    id: "overheating",
    question: "Why is my car running hot?",
    answer:
      "Overheating is the one where the repair bill depends almost entirely on what you do in the next ten minutes.",
    points: [
      "Heat gauge climbing in stop-and-go traffic but fine on the highway often points at airflow — think cooling fan.",
      "Climbing on the highway but fine in town points more at flow or coolant level.",
      "Heater blowing cold while the engine runs hot is a classic low-coolant tell.",
      "Never open a hot radiator cap. It's pressurised and it will burn you badly.",
    ],
    urgent: "Pull over and let it cool. Driving an overheating engine warps heads and blows head gaskets — that's the difference between a small bill and a huge one.",
    links: [
      { href: "/car-overheating", label: "Car overheating" },
      { href: "/cooling", label: "Cooling system service" },
    ],
  },
  {
    id: "smells",
    question: "What does that smell or smoke mean?",
    answer:
      "Your nose is a decent diagnostic tool. Most smells map to something specific.",
    points: [
      "Sweet, syrupy: coolant. Usually a leak finding a hot surface.",
      "Burning oil, sharp and acrid: oil dripping onto the exhaust.",
      "Rotten eggs: often the catalytic converter.",
      "Hot, sharp, like burnt carpet after a hard stop or a long hill: overheated brakes.",
      "Blue smoke from the tailpipe means oil is burning. White means coolant or condensation. Black means it's running rich.",
    ],
    urgent: "Any smell of raw gasoline, or any smoke from under the hood or the dash, means don't drive it and don't park it in a garage.",
    links: [
      { href: "/exhaust", label: "Exhaust service" },
      { href: "/emissions", label: "Emissions" },
      { href: "/electrical", label: "Electrical" },
    ],
  },
  {
    id: "ac",
    question: "Why is my AC blowing warm?",
    answer:
      "AC is a sealed system. If it's low, it's low because it leaked — refrigerant doesn't get used up.",
    points: [
      "Cold at highway speed, warm at idle: often a cooling-fan or airflow issue rather than the AC itself.",
      "Warm all the time: usually low refrigerant, which means there's a leak somewhere to find.",
      "A recharge that lasts three weeks is not a repair. It's the same leak, plus your money.",
      "Musty smell when you first turn it on is usually the evaporator, not a refrigerant problem.",
    ],
    links: [
      { href: "/ac-not-blowing-cold", label: "AC not blowing cold" },
      { href: "/ac-repair", label: "AC repair" },
    ],
  },
];

export default function SymptomGuide() {
  return (
    <section className="bg-background py-12 lg:py-16 border-t border-border" aria-labelledby="symptom-guide-heading">
      <div className="container max-w-3xl">
        <h2 id="symptom-guide-heading" className="font-heading text-2xl lg:text-3xl text-foreground tracking-tight mb-2">
          WHAT THESE SYMPTOMS <span className="text-primary">USUALLY MEAN</span>
        </h2>
        <p className="text-foreground/50 text-sm mb-8 max-w-2xl">
          Straight answers to what people ask us most, written the way we&apos;d explain it standing at your car.
          No login, no form &mdash; just read it.
        </p>

        <div className="space-y-8">
          {GUIDE.map((entry) => (
            <article key={entry.id} className="border-l-2 border-border pl-5">
              <h3 className="font-heading text-lg text-foreground tracking-tight mb-2">{entry.question}</h3>
              <p className="text-foreground/70 text-sm leading-relaxed">{entry.answer}</p>

              <ul className="mt-3 space-y-2">
                {entry.points.map((point, i) => (
                  <li key={i} className="text-foreground/60 text-sm leading-relaxed flex gap-2">
                    <span aria-hidden="true" className="text-primary/50 shrink-0">&bull;</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>

              {entry.urgent && (
                <p className="mt-3 flex gap-2 text-sm leading-relaxed text-danger/90">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span><strong className="font-bold">Don&apos;t wait on this one:</strong> {entry.urgent}</span>
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                {entry.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="inline-flex items-center gap-1 text-primary/80 hover:text-primary text-xs font-semibold transition-colors"
                  >
                    {link.label}
                    <ChevronRight className="w-3 h-3" aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Exported for the test that pins guide links against real routes. */
export const SYMPTOM_GUIDE_LINKS = GUIDE.flatMap((e) => e.links.map((l) => l.href));
/** Exported so the urgent lines can be pinned against the server's red flags. */
export const SYMPTOM_GUIDE_URGENT_IDS = GUIDE.filter((e) => e.urgent).map((e) => e.id);
