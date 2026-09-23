/**
 * /mechanic-pay-calculator — flat rate vs hourly with the tech's own numbers.
 *
 * Useful to any technician weighing a pay plan, which is what keeps it from
 * being a doorway page; Nick's appears once, as the hourly example, with the
 * same band its job page publishes (shared/jobOpenings.ts). Math lives in
 * shared/payCalculator.ts and is unit-tested (server/payCalculator.test.ts).
 * Rationale: docs/recruiting/RECRUITING-ENGINE-2026-09.md Sec. 5 and 15.
 */
import { useState } from "react";
import { Link } from "wouter";
import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs, trackEvent } from "@/components/SEO";
import {
  annualize,
  breakEvenFlagHours,
  clampPayInput,
  PAY_INPUT_LIMITS,
  weeklyFlatRatePay,
  weeklyHourlyPay,
} from "@shared/payCalculator";
import { formatHourlyPayRange, jobOpeningBySlug, jobOpeningPath } from "@shared/jobOpenings";
import { getRouteByPath } from "@shared/routes";

/** Whole dollars for weekly/yearly totals. */
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
/** A rate keeps its cents: $40.25/hr must not print as "$40". */
const usdRate = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
/** Lenient parse of what was typed; blank or partial ("", ".") counts as 0. */
const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const TECH = jobOpeningBySlug("automotive-technician");
const TECH_OPEN = TECH?.status === "open";
const TECH_PAY = TECH ? formatHourlyPayRange(TECH) : null;
// Pre-fill the hourly side with the FLOOR of the published band — the number
// a tech can count on, not the ceiling.
const DEFAULT_HOURLY = TECH?.salaryMinHourlyCents != null ? TECH.salaryMinHourlyCents / 100 : 30;

/**
 * Neutral defaults (2026-09-23 review): the same rate and the same 40 hours on
 * both sides, so the page opens at "same money" and the tech's own numbers
 * decide. The first version defaulted to 45 hours worked against 32 flagged —
 * a slow flat-rate week plus overtime only on the hourly side — which made
 * hourly "win" before anyone typed anything.
 */
const DEFAULTS = {
  hourlyRate: String(DEFAULT_HOURLY),
  hoursWorked: "40",
  flagRate: String(DEFAULT_HOURLY),
  flagged: "40",
  guarantee: "0",
  weeks: "50",
};

function NumberField({
  label,
  value,
  onChange,
  suffix,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  max: number;
}) {
  // Text + inputMode="decimal", holding exactly what was typed: a number input
  // bound to a number snapped a cleared field to "0" (then "03", "032") and
  // could not hold a leading ".5".
  const over = num(value) > max;
  return (
    <label className="block">
      <span className="text-xs font-semibold tracking-[0.05em] uppercase text-foreground/45 block mb-1.5">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
          className="w-full min-h-[48px] bg-[oklch(0.08_0.004_260)] border border-border/30 rounded-lg px-4 text-base text-foreground focus:border-primary/50 focus:outline-none"
        />
        {suffix && <span className="text-xs text-foreground/45 shrink-0">{suffix}</span>}
      </div>
      {over && <span className="mt-1 block text-[11px] text-amber-400">Counted as {max} — the calculator's maximum.</span>}
    </label>
  );
}

export default function MechanicPayCalculator() {
  const [hourlyRate, setHourlyRate] = useState(DEFAULTS.hourlyRate);
  const [hoursWorked, setHoursWorked] = useState(DEFAULTS.hoursWorked);
  const [flagRate, setFlagRate] = useState(DEFAULTS.flagRate);
  const [flagged, setFlagged] = useState(DEFAULTS.flagged);
  const [guarantee, setGuarantee] = useState(DEFAULTS.guarantee);
  const [weeks, setWeeks] = useState(DEFAULTS.weeks);

  const hourly = { ratePerHour: num(hourlyRate), hoursWorked: num(hoursWorked) };
  const hourlyWeek = weeklyHourlyPay(hourly);
  const flatWeek = weeklyFlatRatePay({
    ratePerFlagHour: num(flagRate),
    flaggedHours: num(flagged),
    guaranteedHours: num(guarantee),
  });
  const breakEven = breakEvenFlagHours(hourly, num(flagRate));
  // The rate the math actually used, for the sentence below.
  const flagRateUsed = clampPayInput("rate", num(flagRate));
  const weeksUsed = num(weeks);
  const diff = hourlyWeek - flatWeek;

  return (
    <PageLayout activeHref="/careers" showChat={false}>
      <SEOHead
        title="Mechanic Pay Calculator: Flat Rate vs Hourly | Nick's Tire & Auto"
        description={getRouteByPath("/mechanic-pay-calculator")?.description ?? ""}
        canonicalPath="/mechanic-pay-calculator"
      />
      <Breadcrumbs items={[{ label: "Careers", href: "/careers" }, { label: "Mechanic Pay Calculator" }]} />

      <section className="pt-28 pb-10 lg:pt-36 border-b border-border/20">
        <div className="container max-w-3xl">
          <p className="text-xs font-semibold tracking-[0.12em] uppercase text-foreground/40 mb-3">For technicians</p>
          <h1 className="font-heading text-4xl lg:text-5xl font-extrabold uppercase text-foreground leading-tight">
            Flat Rate vs Hourly: <span className="text-nick-yellow">What Would You Actually Earn?</span>
          </h1>
          <p className="mt-4 text-foreground/65 leading-relaxed">
            A $40 flag rate sounds better than $30 an hour — until a slow week. Put in your real numbers: what
            you flag in a normal week, what you flag in a slow one, and whether there's a guarantee.
          </p>
        </div>
      </section>

      <section className="py-12">
        <div className="container max-w-3xl grid gap-8 md:grid-cols-2">
          <div className="space-y-4 rounded-2xl border border-border/25 p-5">
            <h2 className="font-heading text-lg font-extrabold uppercase text-foreground">Hourly job</h2>
            <NumberField label="Hourly rate" value={hourlyRate} onChange={setHourlyRate} suffix="$/hr" max={PAY_INPUT_LIMITS.rate} />
            <NumberField label="Hours worked per week" value={hoursWorked} onChange={setHoursWorked} suffix="hrs" max={PAY_INPUT_LIMITS.hoursWorked} />
            <p className="text-xs text-foreground/45">Hours over 40 counted at 1.5×.</p>
          </div>
          <div className="space-y-4 rounded-2xl border border-border/25 p-5">
            <h2 className="font-heading text-lg font-extrabold uppercase text-foreground">Flat-rate job</h2>
            <NumberField label="Flag rate" value={flagRate} onChange={setFlagRate} suffix="$/flag hr" max={PAY_INPUT_LIMITS.rate} />
            <NumberField label="Hours you actually flag per week" value={flagged} onChange={setFlagged} suffix="hrs" max={PAY_INPUT_LIMITS.flaggedHours} />
            <NumberField label="Guaranteed hours (0 if none)" value={guarantee} onChange={setGuarantee} suffix="hrs" max={PAY_INPUT_LIMITS.guaranteedHours} />
          </div>
        </div>

        <div className="container max-w-3xl mt-8">
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6" aria-live="polite">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-foreground/45">Hourly</p>
                <p className="text-2xl font-extrabold text-foreground">{usd(hourlyWeek)}/wk</p>
                <p className="text-sm text-foreground/55">{usd(annualize(hourlyWeek, weeksUsed))}/yr</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-foreground/45">Flat rate</p>
                <p className="text-2xl font-extrabold text-foreground">{usd(flatWeek)}/wk</p>
                <p className="text-sm text-foreground/55">{usd(annualize(flatWeek, weeksUsed))}/yr</p>
              </div>
            </div>
            <p className="mt-4 text-sm text-foreground/75">
              {diff === 0
                ? "Same money this week."
                : diff > 0
                  ? `Hourly pays ${usd(diff)} more this week.`
                  : `Flat rate pays ${usd(-diff)} more this week.`}{" "}
              {breakEven != null &&
                `To match the hourly check you'd need to flag ${breakEven} hours at ${usdRate(flagRateUsed)} — every week, slow weeks included.`}
            </p>
            <p className="mt-2 text-xs text-foreground/45">Gross pay, before taxes and deductions.</p>
            <div className="mt-4 max-w-[220px]">
              <NumberField label="Working weeks per year" value={weeks} onChange={setWeeks} suffix="wks" max={PAY_INPUT_LIMITS.workingWeeks} />
            </div>
          </div>

          <div className="mt-8 space-y-3 text-sm text-foreground/60 leading-relaxed">
            <h2 className="font-heading text-lg font-extrabold uppercase text-foreground">How to use it honestly</h2>
            <p>
              Run it twice: once with a normal week's flag hours, once with your slowest month. The gap between those
              two is the risk flat rate puts on you instead of the shop.
            </p>
            <p>
              What this leaves out: flat-rate overtime (shops calculate it differently — ask how yours does it),
              benefits, PTO, tool costs and bonuses. It's a comparison, not a paycheck and not an offer.
            </p>
            <p>Questions worth asking any shop before you move:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>What did your techs actually flag, week by week, over the last three months?</li>
              <li>Is there a guarantee, and does it reset if you have a slow week?</li>
              <li>Who decides which tech gets which job?</li>
              <li>How much of the work is warranty, and what does warranty pay?</li>
              <li>Which tools does the shop supply?</li>
            </ul>
          </div>

          {TECH_OPEN && TECH_PAY && TECH && (
            <div className="mt-10 rounded-2xl border border-border/25 p-6">
              <p className="text-sm text-foreground/70">
                Nick's Tire &amp; Auto pays automotive technicians <span className="font-bold text-foreground">{TECH_PAY}</span>,
                hourly — not flat rate. Euclid Ave, Cleveland.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  href={jobOpeningPath(TECH.slug)}
                  onClick={() => trackEvent("careers_apply_cta_click", { position: TECH.title, surface: "pay_calculator" })}
                  className="inline-flex items-center min-h-[48px] bg-primary text-primary-foreground px-5 rounded-xl font-semibold text-sm"
                >
                  See the job
                </Link>
                <Link
                  href="/careers#talk"
                  onClick={() => trackEvent("careers_apply_cta_click", { position: "any", surface: "pay_calculator_confidential" })}
                  className="inline-flex items-center min-h-[48px] border border-border/40 text-foreground/80 px-5 rounded-xl font-semibold text-sm"
                >
                  Talk privately first
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>
    </PageLayout>
  );
}
