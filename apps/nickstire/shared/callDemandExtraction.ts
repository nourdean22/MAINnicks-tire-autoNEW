/**
 * CALL DEMAND EXTRACTION — pull the buying specifics out of what the CALLER said.
 *
 * WHY THIS EXISTS. Audited 2026-09-18: nothing in this app extracted a tire
 * size, a vehicle, a quantity or new-vs-used from a call. `detectIntents` sets
 * boolean flags ("a tire was mentioned"), `aiSummary` is prose written by the
 * assistant, and the one structured extractor (`vapiActionExtraction.ts`) is an
 * LLM path gated off by default. So the follow-up text could not name the thing
 * the caller spent two minutes describing, and no report could say which sizes
 * the phone actually demands.
 *
 * WHY DETERMINISTIC, NOT AN LLM. Tire sizes are a rigid grammar, the corpus is
 * every call, and an LLM here would add per-call cost and a hallucination
 * surface to the one field that must never be wrong — a wrong size sends a
 * customer home with tires that do not fit. Regex is cheap, auditable, and
 * fails CLOSED: no confident parse yields `null`, never a guess.
 *
 * THE SPEECH PROBLEM, which is the actual engineering content here. Nobody says
 * "two one five slash six zero R seventeen". Transcripts carry:
 *
 *     "two fifteen sixty seventeen"      "215 60 17"      "215/60/17"
 *     "two twenty five sixty five R18"   "P215/60R17"     "215 60 R 17"
 *
 * All of those are the same tire. Handling only the digit forms would silently
 * drop the spoken ones, which are the majority on a phone line.
 *
 * INPUT IS CUSTOMER TURNS ONLY. Never the assistant's, and never `aiSummary` —
 * Nick recites sizes back to confirm them, so parsing his speech would attribute
 * his confirmation to the caller and would re-introduce the exact contamination
 * that manufactured the missed-revenue queue.
 *
 * Pure and browser-safe.
 */

/** Spoken number words that appear inside tire sizes. */
const ONES: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/**
 * Convert spoken number words to digit runs, preserving everything else.
 *
 * "two fifteen sixty seventeen" -> "2 15 60 17", which the size patterns below
 * then read as 215/60R17. Deliberately does NOT do full number parsing: it
 * emits each spoken group as its own token and lets the size grammar decide how
 * to join them, because "two fifteen" is 215 in a tire size and 2:15 nowhere
 * else in this domain.
 */
export function spokenNumbersToDigits(text: string): string {
  const words = text.toLowerCase().split(/([^a-z0-9]+)/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w || /^[^a-z0-9]+$/.test(w)) {
      out.push(w);
      continue;
    }
    if (w in TENS) {
      // "sixty five" -> 65 ; bare "sixty" -> 60
      const next = words[i + 2];
      if (next && next in ONES && ONES[next] !== 0) {
        out.push(String(TENS[w] + ONES[next]));
        i += 2;
        continue;
      }
      out.push(String(TENS[w]));
      continue;
    }
    if (w in TEENS) { out.push(String(TEENS[w])); continue; }
    if (w in ONES) { out.push(String(ONES[w])); continue; }
    out.push(w);
  }
  return out.join("");
}

/** Plausible ranges. Outside these we refuse rather than guess. */
const WIDTH = { min: 125, max: 355 };
const ASPECT = { min: 25, max: 85 };
const RIM = { min: 12, max: 26 };

const inRange = (n: number, r: { min: number; max: number }) => n >= r.min && n <= r.max;

/**
 * Extract a tire size, normalised to `215/60R17`.
 *
 * Returns null unless all three components are individually plausible — a
 * partial or out-of-range parse is worse than no parse, because downstream it
 * would be quoted back to the customer as fact.
 */
export function extractTireSize(customerText: string): string | null {
  const digits = spokenNumbersToDigits(customerText);

  // Joined spoken form: "2 15 60 17" -> width 215. The leading 1-digit token
  // followed by a 2-digit token is how "two fifteen" arrives.
  const joined = digits.replace(
    /\b([1-3])\s+(\d{2})\b/g,
    (_m, a: string, b: string) => `${a}${b}`,
  );

  const patterns = [
    // 215/60R17 · 215/60/17 · 215-60-17 · P215/60R17 · LT215/60R17
    /\b(?:p|lt)?\s?(\d{3})\s*[/\-]\s*(\d{2})\s*(?:\/|-|\s)?\s*r?\s*(\d{2})\b/i,
    // 215 60 17 · 215 60 R 17
    /\b(\d{3})\s+(\d{2})\s+r?\s*(\d{2})\b/i,
  ];

  for (const source of [joined, digits, customerText]) {
    for (const re of patterns) {
      const m = re.exec(source);
      if (!m) continue;
      const w = Number(m[1]);
      const a = Number(m[2]);
      const r = Number(m[3]);
      if (inRange(w, WIDTH) && inRange(a, ASPECT) && inRange(r, RIM)) {
        return `${w}/${a}R${r}`;
      }
    }
  }
  return null;
}

/** How many tires. "a pair" and "all four" are the common spoken forms. */
export function extractQuantity(customerText: string): number | null {
  const t = customerText.toLowerCase();
  if (/\ball four\b|\bfour of them\b|\bfull set\b|\ba set\b/.test(t)) return 4;
  if (/\ba pair\b|\bpair of\b|\bboth\b/.test(t)) return 2;
  const m = /\b(one|two|three|four|1|2|3|4)\s+(?:used\s+|new\s+)?(?:tire|tires)\b/.exec(t);
  if (m) {
    const w = m[1];
    return Number(w) || ONES[w] || null;
  }
  // "two of the 215s", "I need two"
  const bare = /\bneed\s+(one|two|three|four|1|2|3|4)\b/.exec(t);
  if (bare) return Number(bare[1]) || ONES[bare[1]] || null;
  return null;
}

export function extractCondition(customerText: string): "new" | "used" | null {
  const t = customerText.toLowerCase();
  const used = /\b(used|second.?hand|pre.?owned|cheap(?:er|est)?)\b/.test(t);
  const isNew = /\b(new|brand.?new)\b/.test(t);
  if (used && !isNew) return "used";
  if (isNew && !used) return "new";
  return null; // said both, or neither — a human decides
}

export function extractUrgency(customerText: string): "today" | "this_week" | "flexible" | null {
  const t = customerText.toLowerCase();
  if (/\b(today|right now|this morning|this afternoon|asap|as soon as|on my way|now)\b/.test(t)) return "today";
  if (/\b(tomorrow|this week|saturday|sunday|monday|tuesday|wednesday|thursday|friday)\b/.test(t)) return "this_week";
  if (/\b(next week|sometime|no rush|whenever)\b/.test(t)) return "flexible";
  return null;
}

/**
 * Vehicle makes seen on a Cleveland tire counter. Deliberately a closed list:
 * an open-ended "capitalised word near a year" heuristic produced false vehicles
 * in testing ("Euclid Honda" from an address line).
 */
const MAKES = [
  "acura", "audi", "bmw", "buick", "cadillac", "chevy", "chevrolet", "chrysler",
  "dodge", "ford", "gmc", "honda", "hyundai", "infiniti", "jeep", "kia",
  "lexus", "lincoln", "mazda", "mercedes", "mercury", "mitsubishi", "nissan",
  "pontiac", "ram", "subaru", "tesla", "toyota", "volkswagen", "vw", "volvo",
] as const;

const MAKE_DISPLAY: Record<string, string> = {
  chevy: "Chevy", chevrolet: "Chevrolet", bmw: "BMW", gmc: "GMC", vw: "VW",
  volkswagen: "Volkswagen", mercedes: "Mercedes",
};

/**
 * Extract "2023 Honda" or "Honda HR-V" style vehicle descriptions.
 *
 * Model is captured only as the token immediately following a known make, and
 * only when it looks like a model rather than a stopword — a wrong model on a
 * text is worse than no model.
 */
export function extractVehicle(customerText: string): string | null {
  const t = customerText.toLowerCase();
  const year = /\b(19[8-9]\d|20[0-4]\d)\b/.exec(t)?.[1] ?? null;

  for (const make of MAKES) {
    const re = new RegExp(`\\b${make}\\b\\s*([a-z0-9][a-z0-9-]{1,12})?`, "i");
    const m = re.exec(t);
    if (!m) continue;
    const display = MAKE_DISPLAY[make] ?? make.charAt(0).toUpperCase() + make.slice(1);
    const rawModel = m[1];
    const STOP = new Set([
      "and", "the", "for", "with", "it", "is", "was", "car", "truck", "suv",
      "please", "i", "my", "that", "this", "but", "so", "in", "on", "at", "to",
      "tire", "tires", "needs", "need", "has", "have",
    ]);
    const model = rawModel && !STOP.has(rawModel) && !/^\d{4}$/.test(rawModel)
      ? rawModel.toUpperCase().length <= 4
        ? rawModel.toUpperCase()
        : rawModel.charAt(0).toUpperCase() + rawModel.slice(1)
      : null;
    return [year, display, model].filter(Boolean).join(" ");
  }
  return year ? null : null; // a bare year is not a vehicle
}

export interface ExtractedDemand {
  tireSize: string | null;
  quantity: number | null;
  condition: "new" | "used" | null;
  vehicle: string | null;
  urgency: "today" | "this_week" | "flexible" | null;
  /** True when enough was captured to quote or check stock against. */
  hasCapturedSpecifics: boolean;
}

/**
 * Extract everything, from CUSTOMER TURNS ONLY.
 *
 * Callers must pass the caller's own turns — `extractCustomerTurns(...).turns`,
 * never the raw transcript. Passing assistant speech here re-creates the
 * contamination documented in `vapiCallClassifierSpeakerAttribution.test.ts`.
 */
export function extractDemand(customerTurns: readonly string[]): ExtractedDemand {
  const text = customerTurns.join(" ");
  const tireSize = extractTireSize(text);
  const quantity = extractQuantity(text);
  const condition = extractCondition(text);
  const vehicle = extractVehicle(text);
  const urgency = extractUrgency(text);
  return {
    tireSize,
    quantity,
    condition,
    vehicle,
    urgency,
    // A size alone is quotable. A vehicle plus a condition is enough to look up.
    hasCapturedSpecifics: Boolean(tireSize || (vehicle && condition)),
  };
}
