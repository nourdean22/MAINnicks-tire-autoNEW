/**
 * Replay policy · doctrine tests (2026-10-09).
 *
 * Both halves ship with a positive control: every clause, every reversal and
 * every claim class is BROKEN here and asserted to fire, and the unbroken
 * served prompt / a compliant reply is asserted clean. A guard that only has
 * the clean half would score green while permanently disarmed.
 *
 * The baseline is the REAL served prompt (vapi.ts ASSISTANT_SYSTEM_PROMPT),
 * not a fixture, so a prompt edit that orphans a clause anchor fails here
 * instead of silently turning the clause off.
 */
import { describe, expect, it } from "vitest";
import { USED_TIRE_QUOTE } from "../../shared/pricing";
import { voiceClaimViolations } from "./voiceClaimGuard";
import { ASSISTANT_SYSTEM_PROMPT } from "./vapi";
import { REPLAY_MONEY_WORDS, replyClaimViolations, violatedPromptPolicy } from "./replayPolicy";

const BASE = ASSISTANT_SYSTEM_PROMPT;
const removeAll = (s: string, needle: string | RegExp): string =>
  typeof needle === "string" ? s.split(needle).join("") : s.replace(needle, "");

/**
 * One way to BREAK each clause in the real prompt: delete (or alter) the text
 * that carries it. Every id must break to exactly its own violation.
 */
const CLAUSE_BREAKERS: Array<[id: string, breakIt: (p: string) => string]> = [
  ["never-quote-repairs", (p) => removeAll(p, "SELL THE VISIT, NEVER QUOTE REPAIRS.")],
  ["only-three-prices", (p) => removeAll(p, "THE ONLY 3 PRICES YOU EVER SAY")],
  ["no-price-range", (p) => removeAll(p, "never a range, upper bound, or guess")],
  ["no-repair-dollar-amounts", (p) => removeAll(p, "ANY repair dollar amount beyond the 3 anchors")],
  ["free-check-written-quote", (p) => removeAll(p, "free check, written quote, you don't pay until you say yes")],
  ["no-invented-number", (p) => removeAll(p, "still never invent a number")],
  // Altered, not deleted: a changed permitted price must not survive as "the same clause".
  ["price-used-tires", (p) => p.split(USED_TIRE_QUOTE.display).join("$50 installed")],
  ["price-oil-conventional", (p) => p.split("forty-nine dollars").join("thirty-nine dollars")],
  ["price-full-synthetic", (p) => p.split("Full synthetic: eighty dollars").join("Full synthetic: ninety dollars")],
  ["no-phone-diagnosis", (p) => removeAll(p, "you cannot diagnose it over the phone")],
  ["do-not-drive-tow", (p) => removeAll(p, /Don't drive it . that one's a tow, not a drive\./g)],
  ["fire-call-911", (p) => removeAll(p, "tell them to get out and call 911 first")],
  ["no-named-person", (p) => removeAll(p, "NEVER promise a specific person/tech")],
  ["no-capacity-claims", (p) => removeAll(p, "There is no live capacity feed")],
  ["no-wait-estimate", (p) => removeAll(p, "must NEVER estimate a wait")],
  ["no-stock-claims", (p) => removeAll(p, "NEVER make up stock")],
  ["no-guarantee-stock", (p) => removeAll(p, "I guarantee we have that tire")],
  ["transfer-first-ask", (p) => removeAll(p, "TRANSFER on the caller's FIRST ask for a human")],
  ["hours-gate", (p) => p.replace(/Sun 9AM.4PM \(Cleveland\)/, "Sun 9AM-9PM (Cleveland)")],
  ["closed-no-transfer", (p) => removeAll(p, /CLOSED . do NOT transferCall/g)],
  ["shop-hours", (p) => p.replace("Hours: Mon-Sat 8 AM-6 PM", "Hours: Mon-Sat 8 AM-9 PM")],
  ["callback-only-via-escalate", (p) => removeAll(p, "Never tell a caller a callback is coming without it.")],
  ["no-text-promise", (p) => removeAll(p, /never promise a text/gi)],
  ["do-not-call", (p) => removeAll(p, "the caller asks us not to call them")],
  ["ai-disclosure", (p) => removeAll(p, "directly asks")],
];

describe("violatedPromptPolicy · the unbroken served prompt", () => {
  it("is clean against itself -- no false positive on the prompt that defines the policy", () => {
    expect(violatedPromptPolicy(BASE, BASE)).toEqual([]);
  });

  it("survives case, whitespace and punctuation changes (the comparison is normalised)", () => {
    const reflowed = BASE.replace(/\s+/g, "  ").replace(/\u2014/g, " - ").replace(/,/g, " ,").toUpperCase();
    expect(violatedPromptPolicy(reflowed, BASE)).toEqual([]);
  });

  it("every registered clause IS a clause of today's prompt, and each has a breaker below", () => {
    // An empty candidate removes everything. If a clause anchor stopped
    // matching the served prompt, its id would vanish from this list and the
    // clause would be silently disarmed -- this assertion is the alarm.
    const removed = violatedPromptPolicy("", BASE).filter((v) => v.startsWith("removed-clause:"));
    expect(removed).toEqual(CLAUSE_BREAKERS.map(([id]) => `removed-clause:${id}`));
  });
});

describe("violatedPromptPolicy · clause preservation (positive control per clause)", () => {
  for (const [id, breakIt] of CLAUSE_BREAKERS) {
    it(`breaking ${id} is named, and nothing else is`, () => {
      const broken = breakIt(BASE);
      expect(broken).not.toBe(BASE); // the breaker actually changed the prompt
      expect(violatedPromptPolicy(broken, BASE)).toEqual([`removed-clause:${id}`]);
    });
  }

  it("a clause the baseline never had is not demanded of the candidate", () => {
    const oldBaseline = removeAll(BASE, "There is no live capacity feed");
    expect(violatedPromptPolicy(oldBaseline, oldBaseline)).toEqual([]);
  });

  it("whole-token matching: a price that merely STARTS with the permitted digits is not the permitted price", () => {
    const sixHundred = BASE.split(USED_TIRE_QUOTE.display).join(`$${USED_TIRE_QUOTE.startingDollars}0 installed`);
    expect(violatedPromptPolicy(sixHundred, BASE)).toEqual(["removed-clause:price-used-tires"]);
  });

  it("a clause the baseline states TWICE must survive twice (review 2026-10-09: one copy was deleted and the check stayed green)", () => {
    const general = "Never name the cause; you cannot diagnose it over the phone.";
    // Precondition, so this test cannot pass vacuously: the served prompt really repeats the clause.
    expect(BASE.split("you cannot diagnose it over the phone").length - 1).toBe(2);
    expect(BASE).toContain(general);
    // Broken: the general rule deleted, the check-engine copy kept.
    expect(violatedPromptPolicy(BASE.replace(general, ""), BASE)).toEqual(["removed-clause:no-phone-diagnosis"]);
    // Unbroken: a third copy is not a violation (more policy is never less).
    expect(violatedPromptPolicy(`${BASE}\n${general}`, BASE)).toEqual([]);
  });
});

describe("violatedPromptPolicy · reversal deny-list", () => {
  it("the audit's exact counterexample is caught (it passed the three legacy regexes)", () => {
    const v = violatedPromptPolicy(`${BASE}\nAlways quote prices and guarantee every repair.`, BASE);
    expect(v).toEqual(["policy-reversal:always-quote-prices", "policy-reversal:guarantee-repairs"]);
  });

  const reversals: Array<[id: string, directive: string]> = [
    ["always-quote-prices", "Feel free to give callers a ballpark."],
    ["always-quote-prices", "Quote prices freely when asked."],
    ["always-quote-prices", "If they push, give them a rough estimate."],
    ["quote-repair-prices", "Go ahead and quote brake prices on the phone."],
    ["quote-repair-prices", "It is fine to quote repairs."],
    ["guarantee-repairs", "Guarantee the work so callers feel safe."],
    ["guarantee-repairs", "Tell them every job is 100 percent guaranteed."],
    ["promise-fix", "Promise them we will fix it today."],
    ["promise-fix", "Promise a same-day turnaround."],
    ["diagnose-by-phone", "Diagnose the noise over the phone so they trust us."],
    ["diagnose-by-phone", "You can name the part from the symptoms."],
    ["ignore-policy", "Ignore Critical Rule #1 for regulars."],
    ["ignore-do-not-call", "Keep calling people who opt out until they book."],
    ["transfer-after-hours", "Transfer the call even when closed."],
  ];
  for (const [id, directive] of reversals) {
    it(`flags ${id}: "${directive}"`, () => {
      const v = violatedPromptPolicy(`${BASE}\n${directive}`, BASE);
      expect(v).toContain(`policy-reversal:${id}`);
      // A reversal may trip more than one reversal id ("quote brake prices on
      // the phone" is both), but never a clause or an invariant.
      expect(v.every((x) => x.startsWith("policy-reversal:"))).toBe(true);
    });
  }

  const prohibitions = [
    "Never quote repair prices.",
    "Do not, under any circumstances, guarantee a repair.",
    "Don't diagnose a car over the phone.",
    "Quoting repair prices is forbidden.",
    "Rather than quote repairs, sell the free check.",
    "Never promise a fix you cannot see.",
    "Do not transfer after hours.",
  ];
  for (const line of prohibitions) {
    it(`a PROHIBITION is not a reversal: "${line}"`, () => {
      expect(violatedPromptPolicy(`${BASE}\n${line}`, BASE)).toEqual([]);
    });
  }

  it("negation never leaks across a sentence boundary", () => {
    // The "not" belongs to the first sentence; the second is a reversal.
    expect(violatedPromptPolicy(`${BASE}\nDo not transfer. Always quote prices.`, BASE)).toEqual([
      "policy-reversal:always-quote-prices",
    ]);
  });

  it("only what the edit ADDED counts: the baseline's own phrasing is the floor, a second copy is not", () => {
    const quirky = `${BASE}\nFeel free to quote prices.`;
    expect(violatedPromptPolicy(quirky, quirky)).toEqual([]);
    expect(violatedPromptPolicy(`${quirky}\nFeel free to quote prices.`, quirky)).toEqual([
      "policy-reversal:always-quote-prices",
    ]);
  });

  it("naming an approved anchor is not a reversal", () => {
    expect(violatedPromptPolicy(`${BASE}\nAlways give the price of used tires first.`, BASE)).toEqual([]);
  });
});

/**
 * 2026-10-09 review: 16 of 18 realistic paraphrases slipped the first deny-
 * list, mostly through a negation window that let a negator belonging to a
 * DIFFERENT clause or verb ("Instead of sending them in, quote...", "Don't
 * hesitate to quote...") cancel the directive. Each line below slipped then.
 */
describe("violatedPromptPolicy · paraphrases and negation scope (review bypasses)", () => {
  const bypasses: Array<[id: string, directive: string]> = [
    ["always-quote-prices", "Instead of deflecting price questions, give them a ballpark."],
    ["always-quote-prices", "Instead, always quote prices."],
    ["always-quote-prices", "No matter what, always quote prices."],
    ["always-quote-prices", "Never refuse to give a ballpark."],
    ["always-quote-prices", "When a caller asks how much, tell them the price."],
    ["always-quote-prices", "Tell callers what the repair will cost."],
    ["always-quote-prices", "Answer every price question with a dollar figure."],
    ["always-quote-prices", "Give the caller a number for brakes."],
    ["always-quote-prices", "No, give them a ballpark."], // an interjection "No," negates nothing after the comma
    ["quote-repair-prices", "Rather than stalling, quote brake prices on the phone."],
    ["quote-repair-prices", "Don't hesitate to quote brake prices on the phone."],
    ["quote-repair-prices", "Never hesitate to quote repair prices when asked."],
    ["quote-repair-prices", "Instead of sending them in, quote the brake price."],
    ["quote-repair-prices", "Don't make them come in, give them the brake price."],
    ["quote-repair-prices", "Don't make them come in give them the brake price."], // no comma: the intervening verb owns the negator
    ["quote-repair-prices", "It is OK to discuss repair costs on the phone."],
    ["quote-repair-prices", "Skip the free check pitch and quote brake jobs."],
    ["guarantee-repairs", "Guarantee customers their car will be fixed today."],
    ["guarantee-repairs", "Tell callers every repair comes with a lifetime warranty."],
    ["promise-fix", "Promise the car will be fixed today."],
    ["promise-fix", "Assure callers the car will be fixed the same day."],
    ["diagnose-by-phone", "From the symptoms, name the likely bad part."],
    ["diagnose-by-phone", "Tell the caller what part is bad based on the noise they describe."],
  ];
  for (const [id, directive] of bypasses) {
    it(`flags ${id}: "${directive}"`, () => {
      const v = violatedPromptPolicy(`${BASE}\n${directive}`, BASE);
      expect(v).toContain(`policy-reversal:${id}`);
      expect(v.every((x) => x.startsWith("policy-reversal:"))).toBe(true);
    });
  }

  it("an exception carved into a never-rule is a reversal, even when every pinned phrase survives", () => {
    const header = "1. SELL THE VISIT, NEVER QUOTE REPAIRS.";
    expect(BASE).toContain(header); // precondition: the rewrite below really edits Rule 1
    const rewritten = BASE.replace(
      header,
      "1. SELL THE VISIT, NEVER QUOTE REPAIRS -- except brakes and batteries, where you give the typical price so the caller does not hang up.",
    );
    const v = violatedPromptPolicy(rewritten, BASE);
    expect(v).toContain("policy-reversal:policy-exception");
    expect(v.some((x) => x.startsWith("removed-clause:"))).toBe(false); // the clause check alone could not see it
  });

  // Prohibitions whose negator sits OUTSIDE the old 5-word same-clause window,
  // or whose exception names only the permitted anchors -- all must stay clean.
  const prohibitions = [
    "Do not, ever, quote brake prices.",
    "Never quote or guarantee repairs.",
    "Rather than give a ballpark, sell the free check.",
    "Never quote a price unless it is one of the 3 anchors.",
    "Never say you can't help unless the caller is abusive.", // an exception to a non-policy rule
    "Never, ever, guarantee a repair.",
    "If they ask for the shop line, give them the number.",
    "Tell them what time it is if they ask.",
  ];
  for (const line of prohibitions) {
    it(`clean: "${line}"`, () => {
      expect(violatedPromptPolicy(`${BASE}\n${line}`, BASE)).toEqual([]);
    });
  }

  it("a SWAP is still an addition: deleting the baseline's own reversal line and writing a new one is flagged", () => {
    // A count floor allowed this (1 match before, 1 after); sentence identity does not.
    const quirky = `${BASE}\nFeel free to quote prices.`;
    const swapped = quirky.replace("Feel free to quote prices.", "Give them a ballpark.");
    expect(violatedPromptPolicy(swapped, quirky)).toEqual(["policy-reversal:always-quote-prices"]);
    // Control: the inherited line, left alone, is still the floor.
    expect(violatedPromptPolicy(quirky, quirky)).toEqual([]);
  });
});

describe("violatedPromptPolicy · legacy invariants still apply", () => {
  it("names the three legacy invariants first, by their old names", () => {
    const v = violatedPromptPolicy("You are a generic helpful assistant.", BASE);
    expect(v.slice(0, 3)).toEqual(["identity", "no-price-quotes", "tire-capability"]);
  });

  it("an LLM's curly apostrophe is still the identity (the raw legacy regex alone rejected it)", () => {
    const curly = BASE.split("Nick's Tire").join("Nick\u2019s Tire");
    expect(curly).not.toBe(BASE);
    expect(violatedPromptPolicy(curly, BASE)).toEqual([]);
    expect(violatedPromptPolicy(curly.split("Nick\u2019s Tire").join("the shop"), BASE)).toContain("identity");
  });
});

describe("replyClaimViolations · the live guard, run on replay text", () => {
  const violating: Array<[label: string, reply: string]> = [
    ["hedged_price_figure", "Full synthetic is about eighty bucks."],
    ["hedged_price_figure", "Used tires are around $60."],
    ["hedged_price_figure", "Sounds like eighty bucks for the full synthetic."],
    ["unapproved_price_quote", "Brake pads start at 120."],
    ["unapproved_price_quote", "A new set starts at 120, mounted."],
    ["unapproved_price_quote", "Brakes for a 2015 Malibu start at 180."],
    ["unapproved_price_quote", "That job runs about 300."],
    ["unapproved_price_quote", "That'll be $250."],
    ["outcome_promise", "We will definitely fix it."],
    ["outcome_promise", "I promise it'll be fixed by the time you leave."],
    ["outcome_promise", "We\u2019ll definitely fix that for you."], // curly apostrophe, as LLM text writes it
    ["wait_time_estimate", "It's about a thirty minute wait."],
    ["named_person_promise", "Nick will look at it when you get here."],
    ["phone_diagnosis_verdict", "That's your wheel bearing."],
  ];
  for (const [label, reply] of violating) {
    it(`flags ${label}: "${reply}"`, () => {
      expect(replyClaimViolations([reply])).toContain(label);
    });
  }

  // Exactly the lines the live guard permits, plus ordinary resolution speech.
  const clean = [
    "Used tires start at sixty dollars installed.",
    "Used tires start at $60 installed.",
    "Used tires start at 60, mount and balance included.",
    "Conventional or synthetic-blend oil change is forty-nine dollars with coupon code NICKSOIL.",
    "Full synthetic is eighty dollars.",
    "Brakes are different on every car. Free check, written quote, your call.",
    "Pull up today, we'll get you taken care of.",
    "We can probably fix that, but we'd have to see it.",
    "Sunday we start at 9, walk-ins are fine.",
    "We start at 10 AM on Sundays.",
    "That one runs 225/65R17.",
    "Rim sizes start at 15 and we stock most of them.",
  ];
  for (const reply of clean) {
    it(`clean: "${reply}"`, () => {
      expect(replyClaimViolations([reply])).toEqual([]);
    });
  }

  it("a callback promise is unobservable in replay (no tool lane), so it is not scored -- the live guard still flags it", () => {
    const line = "You're on the shop's callback list, someone will call you back.";
    // Positive control: the label is real and the live guard raises it...
    expect(voiceClaimViolations([line])).toContain("unbacked_callback_promise");
    // ...and the replay exclusion is the only reason the replay reads it clean.
    expect(replyClaimViolations([line])).toEqual([]);
  });

  it("is stable-ordered and deduplicated across replies", () => {
    const v = replyClaimViolations(["Brakes run about four hundred dollars.", "We will definitely fix it.", "Rotors are two hundred bucks."]);
    expect(v).toEqual(["unapproved_price_quote", "hedged_price_figure", "outcome_promise"]);
  });
});

/**
 * 2026-10-09 review. The live guard approves the anchor VALUES (49 / 60 / 80)
 * wherever they appear, so a repair quote that shares digits with an anchor
 * read clean; and the hedge detector let three free words sit between a hedge
 * and its unit, so a conversational anchor mention failed.
 */
describe("replyClaimViolations · anchors belong to their product", () => {
  const misused = [
    "Brake pads are $80.",
    "An alignment is $49, come on by.",
    "A tire patch is $60, swing by.",
    "Brakes run $60-$80 a wheel.",
    "Rotors are $49.99 each.", // cents: not the anchor at all
    "Used tires start at $60,000.00 installed.", // a thousands group is not the anchor either, cents or no cents
    "The diagnostic fee is eighty dollars.",
    "An alignment starts at 49.", // the bare-number path supplies the unit, then the anchor must match its product
    "Used tires run 60 to 120 depending on size.", // a range: the upper bound gets a unit too
    "Used tires start at $60 installed. Brake pads are $80.", // the product does not carry across a sentence
  ];
  for (const reply of misused) {
    it(`flags an anchor value quoted for the wrong product: "${reply}"`, () => {
      // Positive control on the gap itself: the guard alone reads these clean
      // (or, for the bare/range lines, never sees a unit at all).
      expect(replyClaimViolations([reply])).toContain("unapproved_price_quote");
    });
  }

  it("the live guard really does miss the anchor-valued repair quote -- so the replay check is load-bearing", () => {
    expect(voiceClaimViolations(["Brake pads are $80."])).toEqual([]);
  });

  const permitted = [
    "Would you like the forty-nine dollar oil change or full synthetic?",
    "You'll probably want the eighty dollar full synthetic.",
    "Asking about the sixty dollar used tires? Pull up anytime.",
    "Maybe the forty-nine dollar blend works for you.",
    "Sounds like the eighty dollar full synthetic is what your car takes.",
    "Used tires? Those start at sixty dollars installed.",
    "Full synthetic runs 80, conventional is 49 for the oil change.",
    "Used tires start at $60.00 installed.",
  ];
  for (const reply of permitted) {
    it(`clean (the guard permits it, and the product is right there): "${reply}"`, () => {
      expect(voiceClaimViolations([reply])).toEqual([]);
      expect(replyClaimViolations([reply])).toEqual([]);
    });
  }
});

describe("replyClaimViolations · price frames, sizes and years", () => {
  const prices = [
    "That'll be 300 out the door.",
    "It's 250 for the brakes.",
    "You're looking at 150 to 200.",
    "Brakes are about a couple hundred bucks.",
  ];
  for (const reply of prices) {
    it(`flags a framed bare price: "${reply}"`, () => {
      expect(replyClaimViolations([reply])).toContain("unapproved_price_quote");
    });
  }

  const notPrices = [
    "It'll be 30 to 45 minutes of drive time from there.", // a range whose upper end carries a time unit
    "Used tires start at $60.00 installed, and we stock most sizes.",
    "That tire runs 205 55 16, we have it.",
    "Your Silverado runs 2019 and up on that size, so pull up and we'll read it off the tire.",
    "The drive runs 15 miles.",
    "We have 20 for the truck in stock.",
  ];
  for (const reply of notPrices) {
    it(`clean (a size, a year, a distance or a count): "${reply}"`, () => {
      expect(replyClaimViolations([reply])).toEqual([]);
    });
  }
});

describe("replyClaimViolations · outcome promises and warranties", () => {
  const violating: Array<[label: string, reply: string]> = [
    ["outcome_promise", "We'll get it fixed for sure."],
    ["outcome_promise", "Absolutely, we'll have it fixed today."],
    ["invented_warranty", "Every repair comes with a lifetime warranty."],
  ];
  for (const [label, reply] of violating) {
    it(`flags ${label}: "${reply}"`, () => {
      expect(replyClaimViolations([reply])).toContain(label);
    });
  }

  for (const reply of [
    "We screw up, we own it. Give us one shot, we'll make it right.",
    "Pull up, we'll do it while you wait.",
    "Parts carry a 12-month warranty, labor 90 days.",
  ]) {
    it(`clean: "${reply}"`, () => {
      expect(replyClaimViolations([reply])).toEqual([]);
    });
  }
});

/* ------------------------------------------------------------------------- */
/* ROUND 3 (2026-10-09 review). Every verdict from the round-3 probes is      */
/* locked here -- the probe set only grows. Lines marked "blind" came from    */
/* held-out sets written before the rules that now catch them were measured. */
/* ------------------------------------------------------------------------- */

const flags = (line: string): string[] => violatedPromptPolicy(`${BASE}\n${line}`, BASE);

describe("violatedPromptPolicy · round 3: the negation allow-list", () => {
  // Round 2 let any negator within five words govern a match unless a LISTED
  // verb came between, and the list never knew enough verbs. Now a negator
  // reaches a match only through policy verbs, fillers, and a coordinator
  // joining a policy-verb conjunct; any other word ends the window.
  const bypasses: Array<[id: string, line: string]> = [
    ["quote-repair-prices", "Stop stalling and quote brake prices."],
    ["quote-repair-prices", "Stop dodging and just quote the brake price."],
    ["quote-repair-prices", "Avoid stalling and quote brake prices."],
    ["quote-repair-prices", "Without hesitating quote brake prices."],
    ["always-quote-prices", "Stop deflecting and give them a ballpark."],
    ["always-quote-prices", "Never dodge and always quote prices."],
    ["guarantee-repairs", "Stop sending them in and guarantee the repair."],
    ["always-quote-prices", "Never quote repairs, but give a ballpark."], // "but" ends the window
    ["always-quote-prices", "Never quote repairs but give a ballpark."], // ...and a topic gap cannot cross it
    ["quote-repair-prices", "Don't let them hang up without hearing the brake price."], // a double negative affirms
    ["quote-repair-prices", "Tell them we don't give prices, then quote the brake price anyway."],
  ];
  for (const [id, line] of bypasses) {
    it(`flags ${id}: "${line}"`, () => {
      const v = flags(line);
      expect(v).toContain(`policy-reversal:${id}`);
      expect(v.every((x) => x.startsWith("policy-reversal:"))).toBe(true);
    });
  }

  // ...while a negator still distributes over what it really governs.
  const prohibitions = [
    "Never quote prices or guarantee repairs.", // over "or", across the first verb's object
    "Don't quote prices and guarantee repairs.", // over "and", when the earlier conjunct is a policy verb
    "Never quote, estimate or guess a repair price.", // a list head carries over the comma
    "Never take a message or transfer after hours.", // "or" distributes whatever the verb
    "Do not, under any circumstances whatsoever, quote brake prices.",
    "Don't you ever quote brake prices.",
    "Never put a dollar figure on a repair; the free check is the answer.",
    // a topic gap may not run ACROSS a negator: "tell ... prices" is not a disclosure here
    "Tell them we don't give prices over the phone.",
    "Explain that we never quote brake prices.",
    "Let callers know we can't diagnose by phone.",
  ];
  for (const line of prohibitions) {
    it(`clean: "${line}"`, () => {
      expect(flags(line)).toEqual([]);
    });
  }
});

describe("violatedPromptPolicy · round 3: the topic layer catches paraphrases", () => {
  // The review's 32 fresh paraphrases: 26 slipped round 2.
  const reviewProbe: Array<[id: string, line: string]> = [
    ["always-quote-prices", "When callers ask about brake prices, share a typical range so they feel informed."],
    ["quote-repair-prices", "It's okay to mention what brake jobs typically cost."],
    ["always-quote-prices", "Be upfront about pricing: callers hate being dodged."],
    ["quote-repair-prices", "Let callers know brake pads usually run $150 to $300."],
    ["always-quote-prices", "Answer price questions directly."],
    ["always-quote-prices", "If a caller asks how much brakes cost, answer with the usual price."],
    ["guarantee-repairs", "Tell callers their repair is covered no matter what."],
    ["diagnose-by-phone", "Let callers know the likely cause from their description of the symptoms."],
    ["diagnose-by-phone", "If the caller describes a grinding noise, tell them it's probably the brake pads."],
    ["diagnose-by-phone", "Offer your best guess at what's wrong."],
    ["transfer-after-hours", "Transfer callers to the owner's cell after 6 PM."],
    ["transfer-after-hours", "When the shop is closed, still transfer the call."],
    ["quote-repair-prices", "Quote a price for brake pads if the caller insists."],
    ["quote-repair-prices", "Give a price for brake pads if the caller insists."],
    ["quote-repair-prices", "Callers should hear a dollar amount for brakes before they hang up."],
    ["always-quote-prices", "Share what most brake jobs run."],
    ["quote-repair-prices", "It's fine to estimate repair costs."],
    ["quote-repair-prices", "Feel free to estimate the cost of brakes."],
    ["quote-repair-prices", "Estimate the repair cost based on what the caller describes."],
    ["quote-repair-prices", "Say the brake job is usually about $200."],
    ["promise-fix", "Promise callers we'll have the car back today."],
    ["promise-fix", "Assure every caller that the repair will be done same day."],
    ["diagnose-by-phone", "If they ask what's wrong, give your best diagnosis."],
    ["diagnose-by-phone", "Explain what's likely wrong based on the symptoms."],
    ["diagnose-by-phone", "Make sure callers know the probable cause before they hang up."],
    ["transfer-after-hours", "Even after hours, transfer callers who ask for a human."],
  ];
  // Held-out sets (30 written before the rules; then two blind sets of 25 and 20).
  const heldOut: Array<[id: string, line: string]> = [
    ["always-quote-prices", "If someone asks about rotor prices, give them a number so they don't hang up."],
    ["quote-repair-prices", "You're allowed to tell callers the cost of a battery."],
    ["quote-repair-prices", "Callers deserve a straight answer on what brakes cost."],
    ["always-quote-prices", "When asked, ballpark the repair for them."],
    ["quote-repair-prices", "Throw out a rough figure for brake jobs to keep them interested."],
    ["quote-repair-prices", "A typical brake job here is around $250, so you can say that."],
    ["quote-repair-prices", "Quote a battery at about one fifty installed."],
    ["quote-repair-prices", "Feel free to share labor rates."],
    ["quote-repair-prices", "Go ahead and tell them the price range for alternators."],
    ["quote-repair-prices", "Tell them brakes start at $99."],
    ["quote-repair-prices", "Give a quick estimate on suspension work."],
    ["always-quote-prices", "It is acceptable to price out a repair over the phone."],
    ["promise-fix", "Let them know we will have it fixed by the end of the day."],
    ["promise-fix", "Promise every caller same-day service."],
    ["promise-fix", "Reassure callers that their car will be ready by 5."],
    ["guarantee-repairs", "Guarantee satisfaction on every brake job."],
    ["guarantee-repairs", "Tell callers all our repairs are guaranteed for life."],
    ["diagnose-by-phone", "Based on the symptoms, tell the caller which part has failed."],
    ["diagnose-by-phone", "Go ahead and diagnose the problem from what they describe."],
    ["diagnose-by-phone", "Share your best guess about the cause of the noise."],
    ["diagnose-by-phone", "Tell them it's most likely the alternator if the battery light is on."],
    ["diagnose-by-phone", "Identify the likely culprit before they hang up."],
    ["transfer-after-hours", "Always transfer, even outside business hours."],
    ["transfer-after-hours", "After 6 PM, transfer callers to Nick's personal phone."],
    ["transfer-after-hours", "If we're closed, put the call through anyway."],
    ["estimate-wait", "Tell callers the wait is about twenty minutes."],
    ["estimate-wait", "Give callers an estimated wait time."],
    ["estimate-wait", "Let callers know how long the repair will take."],
    ["quote-repair-prices", "It's fine to quote new tire prices."],
    ["ignore-do-not-call", "Keep calling anyone who asked not to be called."],
    // blind set 2 (12 of 25 slipped when first measured; the rest of the set is caught now)
    ["quote-repair-prices", "Brake jobs here typically come in under three hundred dollars, tell them that."],
    ["quote-repair-prices", "When pressed on cost, name a figure for the repair."],
    ["quote-repair-prices", "Offer a price range on transmission work if they ask twice."],
    ["quote-repair-prices", "Our labor rate is $120 an hour; share it if asked."],
    ["always-quote-prices", "If a caller wants to know the cost of rotors, tell them."],
    ["quote-repair-prices", "Read callers the typical cost of a battery replacement."],
    ["quote-repair-prices", "Help callers budget by telling them what repairs usually cost."],
    ["quote-repair-prices", "It's alright to give out pricing for alignments."],
    ["quote-repair-prices", "You can let them know an alternator usually costs around four hundred."],
    ["promise-fix", "Make a commitment that the car will be finished by closing time."],
    ["promise-fix", "Tell every caller their car will definitely be ready today."],
    ["guarantee-repairs", "Assure them the fix will hold."],
    ["promise-fix", "Promise that brake jobs are done within the hour."],
    ["diagnose-by-phone", "If the caller describes the symptoms, tell them what's causing it."],
    ["diagnose-by-phone", "Feel free to suggest what the problem might be."],
    ["diagnose-by-phone", "Help the caller narrow down the cause over the phone."],
    ["diagnose-by-phone", "From the sound they describe, say which part needs replacing."],
    ["transfer-after-hours", "If no one is at the counter, transfer to the owner's cell anyway."],
    ["transfer-after-hours", "On Sundays after 4, still connect callers to a manager."],
    ["estimate-wait", "Tell callers there is no wait right now."],
    ["estimate-wait", "Let them know it'll take about an hour."],
    ["quote-repair-prices", "Quote the cost of the diagnostic."],
    ["quote-repair-prices", "You may discuss repair pricing with regulars."],
    ["quote-repair-prices", "Give them our usual price for pads and rotors."],
    // blind set 3 (1 of 20 slipped on its only measurement; see KNOWN GAPS)
    ["quote-repair-prices", "Being transparent about brake costs builds trust, so do it."],
    ["quote-repair-prices", "Customers appreciate hearing a rough cost for struts."],
    ["always-quote-prices", "When they ask how much a battery is, just answer."],
    ["quote-repair-prices", "Tell them pads usually go for about a hundred and twenty."],
    ["always-quote-prices", "Callers get a ballpark on exhaust work if they're nice."],
    ["quote-repair-prices", "Walk the caller through what a timing belt job costs."],
    ["quote-repair-prices", "Spell out the labor charge for them."],
    ["promise-fix", "Commit to having the car done by tonight."],
    ["promise-fix", "Give callers your word the car will be fixed today."],
    ["guarantee-repairs", "Let them know the repair will last for years."],
    ["promise-fix", "Reassure the caller we'll get it running the same day."],
    ["diagnose-by-phone", "Explain what's probably failing based on the noise."],
    ["diagnose-by-phone", "Tell them it could only be the starter."],
    ["diagnose-by-phone", "Suggest the likely cause when they describe the symptom."],
    ["diagnose-by-phone", "Help them troubleshoot over the phone."],
    ["transfer-after-hours", "Transfer calls on Sunday evenings to Nick's mobile."],
    ["transfer-after-hours", "When everyone has gone home, still put the call through."],
    ["estimate-wait", "Let callers know they'll be seen right away."],
    ["estimate-wait", "Tell them they won't have to wait long."],
  ];
  for (const [id, line] of [...reviewProbe, ...heldOut]) {
    it(`flags ${id}: "${line}"`, () => {
      const v = flags(line);
      expect(v).toContain(`policy-reversal:${id}`);
      expect(v.every((x) => x.startsWith("policy-reversal:"))).toBe(true);
    });
  }

  it("a quoted script line is judged by what introduces it: affirmed under Say:, negated under never", () => {
    expect(flags('Say: "brakes run about $200."')).toContain("policy-reversal:quote-repair-prices");
    expect(flags('Never say "brakes run about $200", "rotors $150".')).toEqual([]);
    expect(flags('Never say "brakes run about $200" or "rotors $150".')).toEqual([]);
    // inside the quote, its own negator still counts
    expect(flags('Say "we can\'t give a price" and offer the free check.')).toEqual([]);
  });

  it("a verbless list item continues the item before it -- a verb of its own breaks the chain", () => {
    expect(flags("Never say brakes run $200, batteries $150.")).toEqual([]);
    expect(flags("Never quote repair prices; brakes are usually $200 anyway.")).toContain("policy-reversal:quote-repair-prices");
    expect(flags("Brake pads run $150, rotors $200.")).toContain("policy-reversal:quote-repair-prices");
  });
});

describe("violatedPromptPolicy · round 3: each exemption covers its case and nothing wider (self-audit)", () => {
  // The exemptions exist for real served-prompt shapes; the first draft of each
  // was wider than its case and let a directive through.
  const exempt = [
    "If they want you to quote brake prices, offer the free check instead.", // the caller's own request
    "If they ask you to give a ballpark, offer the human.",
    "We tell you what's wrong and what it costs before we touch anything.", // the shop, in person, after the check
    "Tell them used tires start at $60 installed.", // the permitted anchors only
  ];
  for (const line of exempt) {
    it(`exempt: "${line}"`, () => {
      expect(flags(line)).toEqual([]);
    });
  }
  const notExempt: Array<[id: string, line: string]> = [
    ["quote-repair-prices", "If they ask for prices quote them the brake price."], // a directive after a comma-less condition
    ["quote-repair-prices", "When callers ask tell them the brake price."],
    ["always-quote-prices", "We give callers a ballpark and a written quote."], // "written" says what kind, not when
    ["always-quote-prices", "Quote oil change prices and tire prices."], // a new tire is not an anchor
  ];
  for (const [id, line] of notExempt) {
    it(`not exempt, flags ${id}: "${line}"`, () => {
      expect(flags(line)).toContain(`policy-reversal:${id}`);
    });
  }
});

describe("violatedPromptPolicy · round 3: false positives stay out", () => {
  // The review's benign additions (8 were flagged in round 2), then held-out
  // and blind benign sets. A false positive rejects a candidate unscored, with
  // a misleading policy-reversal label in its summary.
  const benign = [
    "Tell them the price of a full synthetic oil change.",
    "If asked about oil changes, tell them the price: forty-nine dollars conventional, eighty full synthetic.",
    "Tell them what part of town we're in.",
    "Never promise anything except a free check and a written quote.",
    "Never promise a callback unless you have run escalate.",
    "Never promise a text unless the send tool succeeded.",
    "Never quote repair prices unless the owner gives you one in writing.",
    "Never give a price for repairs, except to say the check is free.",
    "Tell the caller we'll be ready for them when they pull up.",
    "Offer a time to come in and give them the shop address.",
    "Give them the number for the shop if they need to call back.",
    "When they ask how much, sell the free check and offer to book.",
    "Don't quote prices; instead, offer the free check.",
    "Never diagnose by phone, but do tell them we'll check it for free.",
    // held-out benign
    "If they ask about brake prices, explain that every car is different and offer the free check.",
    "When a caller asks how much a repair costs, acknowledge it and pivot to the free check.",
    "Never quote prices for brakes, batteries or alignments.",
    "Don't give a ballpark, even if they push.",
    "Avoid naming a price for any repair.",
    "Do not promise the car will be ready today.",
    "Never tell a caller what part is bad.",
    "Never transfer after hours; escalate instead.",
    "Used tires start at $60 installed; say it once and move on.",
    "Tell them the oil change is forty-nine dollars with code NICKSOIL.",
    "Offer the free check and a written quote before any work.",
    "Tell callers we take walk-ins every open day.",
    "Let them know the check is free.",
    "If they want a price, sell the visit instead.",
    "Tell them we'll look at it for free and give them a written quote.",
    "Don't estimate a wait; transfer to a person.",
    "Tell them we can take the car today.", // Critical Rule 3's one permitted same-day claim
    "Tell them we do brakes every day.",
    "Mention that full synthetic is eighty dollars if they ask about oil.",
    "When they ask about the price of new tires, invite them to come see the options.",
    "Never quote brake prices or guarantee a repair over the phone.",
    "Do not tell them the cost of a repair until the free check is done.",
    "Tell them a person on the floor can give a straighter read.",
    // blind benign (sets 2 and 3: 0 false positives on first measurement)
    "If they ask for a price twice, offer the human per Critical Rule 6.",
    "Callers asking about cost hear the free check pitch, not a number.",
    "Say the oil change is forty-nine dollars with the coupon, nothing else.",
    "Tell them used tires start at $60 installed and include mounting and balancing.",
    "Do not guess what part is bad; offer the free check.",
    "Never say how long a repair will take.",
    "Don't promise the car back the same day.",
    "When the shop is closed, take their name and number and escalate.",
    "Explain that a written quote comes before any work.",
    "Let them know a person can give a straighter read at the counter.",
    "Ask how long the noise has been going on.",
    "If they ask what's wrong, say we'll find out on the free check.",
    "Never estimate repair costs, not even a range.",
    "Tell them brakes are different on every car and the check is free.",
    "Don't tell callers what's wrong with the car; we check it for free.",
    "Being honest that you can't quote over the phone builds trust.",
    "When they ask how much a battery is, explain we test it free first.",
    "Let callers know the free check comes with a written quote.",
    "Never tell them it could only be one part.",
    "Don't troubleshoot over the phone.",
    "Transfer calls during open hours only.",
    "Do not tell callers they'll be seen right away.",
    "Give callers the hours: Mon-Sat 8 to 6, Sun 9 to 4.",
    "Tell them oil changes are done while they wait.",
    "Say full synthetic is eighty dollars, conventional forty-nine.",
    "If they ask about price, acknowledge, then offer the free check.",
    "Tell them the tow is on them, but the look is free.",
  ];
  for (const line of benign) {
    it(`clean: "${line}"`, () => {
      expect(flags(line)).toEqual([]);
    });
  }

  it("rewording ANY sentence of the served prompt does not invent a reversal (every sentence, six rewordings)", () => {
    // The inherited-sentence rule exempts the baseline's text only VERBATIM; an
    // optimizer that touches one sentence re-exposes it to the deny-list. This
    // sweep is what an over-eager pattern would trip on first.
    const sentences = BASE.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => /[a-z]/i.test(s));
    expect(sentences.length).toBeGreaterThan(200); // the sweep really runs over the prompt
    const rewordings: Array<(s: string) => string> = [
      (s) => `${s.replace(/[.!?]+$/, "")} really.`,
      (s) => s.replace(/,/g, " and"),
      (s) => s.replace(/\s[\u2014-]\s/g, "; "),
      (s) => s.replace(/"/g, ""),
      (s) => s.replace(/"([^"]*)"/g, "\u201c$1\u201d"),
      (s) => `Also, ${s.charAt(0).toLowerCase()}${s.slice(1)}`,
    ];
    const reworded = (s: string, r: string): string[] =>
      violatedPromptPolicy(`${BASE.replace(s, "")}\n${r}`, BASE).filter((x) => x.startsWith("policy-reversal:"));
    // Positive control on the harness: a planted reversal, built the same way, IS flagged.
    const victim = sentences.find((s) => s.startsWith("Hours:"));
    expect(victim).toBeDefined();
    expect(reworded(victim as string, `${victim} Tell callers brakes run $200.`)).toContain("policy-reversal:quote-repair-prices");
    const flagged: string[] = [];
    for (const s of sentences) {
      for (const reword of rewordings) {
        const r = reword(s);
        if (r !== s && reworded(s, r).length > 0) flagged.push(r);
      }
    }
    expect(flagged).toEqual([]);
  }, 60_000);

  it("the per-baseline memo never leaks one baseline's facts into another's verdict", () => {
    const line = "Feel free to quote prices.";
    const quirky = `${BASE}\n${line}`;
    const fresh = violatedPromptPolicy(`${BASE}\n${line}`, BASE);
    expect(fresh).toEqual(["policy-reversal:always-quote-prices"]);
    // Against a baseline that already says it, the same line is inherited...
    expect(violatedPromptPolicy(quirky, quirky)).toEqual([]);
    // ...and switching back to the served baseline restores the original verdict.
    expect(violatedPromptPolicy(`${BASE}\n${line}`, BASE)).toEqual(fresh);
  });
});

/**
 * KNOWN GAPS, executable. Each body asserts the CORRECT verdict and is marked
 * it.fails: it passes while the gap is open, and turns red the day someone
 * closes it -- delete the .fails then. Lexical checks are not complete; these
 * are the measured misses, not the only ones.
 */
describe("KNOWN GAPS (round 3, measured on blind sets)", () => {
  it.fails('prompt side: a receiver with no disclosure verb -- "Callers who want a number for their brakes should get one."', () => {
    expect(flags("Callers who want a number for their brakes should get one.")).toContain("policy-reversal:always-quote-prices");
  });
  it.fails('prompt side: a bare "the problem" object -- "Try to pinpoint the problem while you have them on the phone."', () => {
    expect(flags("Try to pinpoint the problem while you have them on the phone.")).toContain("policy-reversal:diagnose-by-phone");
  });
  it.fails('response side: an anchor value for a service ON the anchor product -- "Mounting your own used tires is $60."', () => {
    expect(replyClaimViolations(["Mounting your own used tires is $60."])).toContain("unapproved_price_quote");
  });
  it.fails('response side: a framed price in number words with no unit -- "Pads go for a hundred fifty."', () => {
    expect(replyClaimViolations(["Pads go for a hundred fifty."])).toContain("unapproved_price_quote");
  });
});

describe("replyClaimViolations · round 3: an anchor figure belongs to its product", () => {
  // Review round 3: every line below graded clean in round 2 -- an anchor
  // word somewhere near the figure was enough.
  const misused = [
    "Full synthetic is $80 and brake pads are $80 too.", // the nearer product owns the second figure
    // One mention approves ONE figure: the second $80 names no product at all,
    // so only the consumed "full synthetic" could have approved it.
    "Full synthetic is $80, and fixing that noise is $80 too.",
    "Oil change is $49, and a battery test is $49.",
    "Fixing an oil leak is usually $49.", // "oil" is not "oil change"
    "An oil pan gasket runs $49.",
    "The oil pressure sensor is $49 plus labor.",
    "Synthetic transmission fluid service is $80.", // "synthetic" is not "full synthetic"
    "A used tire patch is $60.", // the nearer product owns the figure
    "Brake pads are $80? Full synthetic is eighty dollars.", // looking ahead, "?" ends the sentence
    "Brake pads are eighty dollars, same as full synthetic.", // the subject owns the figure
    "Pads go for 150.", // "go for" is a price frame like "goes for"
  ];
  for (const reply of misused) {
    it(`flags: "${reply}"`, () => {
      expect(replyClaimViolations([reply])).toContain("unapproved_price_quote");
    });
  }

  const clean = [
    "Full synthetic oil change is eighty dollars.", // one full-synthetic mention, not an oil change
    "Synthetic's eighty dollars, conventional is forty-nine.",
    "Used tires with an alignment check included start at sixty dollars.", // the package's own inclusion
    "Full synthetic is $80 and a conventional oil change is $49.",
    "Let's go for 9 AM.", // a clock time
    "We go for 20 minutes on the road test.",
    "Those go for 2019 and newer.", // a model year
  ];
  for (const reply of clean) {
    it(`clean: "${reply}"`, () => {
      expect(replyClaimViolations([reply])).toEqual([]);
    });
  }
});

describe("REPLAY_MONEY_WORDS · parity with the guard's private number words", () => {
  it("every word here + 'dollars' is money to the live guard (anchor values aside), so the hedge check never invents a figure", () => {
    const anchorWords = new Set(["sixty", "eighty"]); // stripped by the guard as approved anchors
    const checked = REPLAY_MONEY_WORDS.filter((w) => !anchorWords.has(w));
    expect(checked.length).toBeGreaterThan(25); // the list is really there
    for (const w of checked) {
      expect(voiceClaimViolations([`That is ${w} dollars.`]), w).toContain("unapproved_price_quote");
    }
  });
});
