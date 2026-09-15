/**
 * Persona scouts — synthetic Cleveland customers with ONE goal and a budget.
 *
 * Scouts, not voters. A persona run finds where a real path is unclear; it
 * never decides anything. What it finds becomes (a) an H2 claim in the
 * Reality Ledger and (b) a candidate ExperienceEpisode that a human refines
 * into `apps/nickstire/tests/episodes/` — where deterministic Playwright, not
 * an LLM, is the oracle from then on.
 *
 * READ-ONLY by construction: `permission` is the literal "read", so the
 * browse-and-do planner never plans an `act` step (no forms, no calls, no
 * taps that could reach the shop). The test pins this.
 *
 * Diversity is deliberate, not prompted: 2026 research found LLM-generated
 * personas collapse toward stereotypes even when asked for spread, so these
 * are hand-written around distinct situations, devices and constraints.
 */
export interface PersonaScout {
  id: string;
  /** Who they are and what they are trying to do — the browse goal, in their words. */
  goal: string;
  startUrl: string;
  /** Planner steps; each costs money. */
  maxSteps: number;
  budgetMs: number;
  /** What a success looks like, for the human reading the receipt. */
  successLooksLike: string;
  /** Goal contract this scout serves (apps/nickstire/goals/<goalId>.json). */
  goalId: string;
  permission: "read";
}

export const NICKSTIRE_ORIGIN = "https://nickstire.org";

export const PERSONA_SCOUTS: readonly PersonaScout[] = [
  {
    id: "flat-at-4-50-seventy-dollars",
    goal: "I have a flat on a 2012 Civic, it is 4:50 PM on a weekday, I have about $70. From the home page, find out whether Nick's can get me a used tire installed today, what it roughly costs installed, and whether I should drive over now or call first. Do not fill any form. Report what you found and what was unclear.",
    startUrl: `${NICKSTIRE_ORIGIN}/`,
    maxSteps: 6,
    budgetMs: 150_000,
    successLooksLike: "Finds the used-tire installed price band and the hours/first-come-first-served truth within 3 pages; knows whether to pull up or call.",
    goalId: "nicks-public-tires-arrivals",
    permission: "read",
  },
  {
    id: "check-engine-distrust",
    goal: "My check engine light is on and I don't trust mechanics. Starting from the home page, find out what Nick's will do before charging me anything and whether I get a written quote first. Do not submit anything. Report the exact wording you relied on and anything that felt like a sales trick.",
    startUrl: `${NICKSTIRE_ORIGIN}/`,
    maxSteps: 6,
    budgetMs: 150_000,
    successLooksLike: "Reaches the diagnose/brakes framing: free check, written quote first, you don't pay until you say yes.",
    goalId: "nicks-public-tires-arrivals",
    permission: "read",
  },
  {
    id: "sunday-used-225-60r16",
    goal: "It is Sunday morning. I need used 225/60R16 tires today. Starting from the tires page, find out if Nick's is open Sundays, whether I can search my size, and what 'installed' includes. Do not submit the search form. Report the Sunday hours you found and where.",
    startUrl: `${NICKSTIRE_ORIGIN}/tires`,
    maxSteps: 5,
    budgetMs: 120_000,
    successLooksLike: "Finds Sunday 9AM-4PM and the installed-price framing without leaving /tires.",
    goalId: "nicks-public-tires-arrivals",
    permission: "read",
  },
  {
    id: "payment-programs-confusion",
    goal: "I need brakes but can't pay it all today. Starting from the home page, find out whether Nick's has a payment option, whether it is a loan or a lease, and whether applying reserves a time. Do not apply. Report anything that implied an appointment or a guarantee.",
    startUrl: `${NICKSTIRE_ORIGIN}/`,
    maxSteps: 6,
    budgetMs: 150_000,
    successLooksLike: "Finds 'Payment Programs' (never 'financing' as the frame), understands no appointment is implied.",
    goalId: "nicks-public-shop-state",
    permission: "read",
  },
  {
    id: "drop-off-uber-out",
    goal: "I want to drop my car off before work and take an Uber. Starting from the booking page, find out whether I need an appointment, what happens when I drop the keys, and how I'll know it's done. Do not submit anything. Report the exact promise the page makes about timing, if any.",
    startUrl: `${NICKSTIRE_ORIGIN}/booking`,
    maxSteps: 5,
    budgetMs: 120_000,
    successLooksLike: "Learns no appointments / just pull up / text when done, with no timing promise.",
    goalId: "nicks-public-shop-state",
    permission: "read",
  },
];
