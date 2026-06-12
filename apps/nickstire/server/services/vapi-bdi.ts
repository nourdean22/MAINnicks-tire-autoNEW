/**
 * VAPI BDI (Belief · Desire · Intention) first-message composer
 *
 * Wave-181.x · Tier S compounding move. The existing
 * `vapi-personalization.ts` got us from "stranger" → "name + vehicle" on
 * inbound calls. This goes the next mile · when the caller is a known
 * customer with an unconverted estimate from the last 120 days, Nick
 * opens the call with the recovery hook instead of waiting for the
 * caller to remember + bring it up themselves.
 *
 *   BEFORE · "Nick's Tire and Auto — Marcus, welcome back. What's going
 *             on with the F-150?"
 *
 *   AFTER  · "Nick's Tire and Auto — Marcus, welcome back. Last visit we
 *             quoted $487 for brakes on the F-150 we didn't end up doing.
 *             Calling about that, or something else?"
 *
 * Why this works (per declined-work-recovery doctrine wave-181.x · #44):
 *   1 · BELIEF — caller is X driving Y · already proven safe by
 *       wave-181.63 firstMessage override path
 *   2 · DESIRE — surfaces the most-likely call reason in the first 5
 *       seconds · removes the recall friction · names the dollar amount
 *       so caller doesn't have to ask
 *   3 · INTENTION — open-ended dual offer ("about that, or something
 *       else") gives the caller control · no pressure · no manipulation
 *
 * Mechanism · same `assistantOverrides.firstMessage` path that
 * wave-181.63 hardened. No `model.messages` replacement (that would risk
 * wiping the configured system prompt). No VAPI assistant config change
 * needed. Backward compatible · unknown callers fall through to the
 * default greeting.
 *
 * Fail-open · ANY error returns matched=false so the webhook falls
 * through to the assistant's configured first message. This NEVER
 * blocks a call.
 *
 * PII boundary · same projection as the existing personalization layer
 * (firstName + vehicle string · never lastName · never raw phone). The
 * dollar amount + service IS surfaced when a declined estimate exists,
 * because the caller already received this info via SMS or in person
 * when the estimate was originally written. Bounded by "must be calling
 * FROM the phone tied to the estimate."
 */

import { createLogger } from "../lib/logger";
import { getWeather } from "../weather";

const log = createLogger("services:vapi-bdi");

export type BdiKind =
  | "declined_recovery" // Strongest signal · open with the lost-revenue hook
  | "welcome_back" // Match + no declined estimate · existing greeting
  | "unknown"; // No match · default greeting

export interface BdiResult {
  /** When set, VAPI uses this string as the first thing the agent says. */
  firstMessage?: string;
  /** Diagnostic only · why we did / didn't compose a BDI greeting. */
  reason: string;
  /** True iff we identified the caller from existing customers. */
  matched: boolean;
  /** Which BDI branch fired · used for downstream A/B + eval analysis. */
  kind: BdiKind;
}

/**
 * Compose a BDI-shaped first-message override for a known caller.
 * Returns `matched=false` when the caller is unknown OR lookup fails.
 */
export async function buildBdiFirstMessage(phone: string): Promise<BdiResult> {
  // Single internal caller · reused for both lookups · cheaper than
  // spinning up two createCaller invocations.
  let caller: ReturnType<typeof createInternalCaller>;
  try {
    caller = createInternalCaller();
  } catch (err) {
    log.warn("buildBdiFirstMessage · createCaller failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return { matched: false, kind: "unknown", reason: "caller construction failed" };
  }

  // Fetch capacity and weather in parallel to keep latency minimal
  let waitTime: Awaited<ReturnType<typeof caller.getCurrentWaitTime>> | null = null;
  let activeWeather: "snow" | "rain" | "cold" | null = null;

  try {
    const [waitRes, weatherRes] = await Promise.all([
      caller.getCurrentWaitTime().catch((err) => {
        log.warn("buildBdiFirstMessage · getCurrentWaitTime threw", { err });
        return { available: false } as any;
      }),
      getWeather().catch((err) => {
        log.warn("buildBdiFirstMessage · getWeather threw", { err });
        return null;
      }),
    ]);

    waitTime = waitRes;

    if (weatherRes) {
      const code = weatherRes.weather_code;
      const cond = weatherRes.weather_condition.toLowerCase();
      if (cond.includes("snow") || [71, 73, 75, 77, 85, 86].includes(code)) {
        activeWeather = "snow";
      } else if (cond.includes("rain") || [65, 82].includes(code)) {
        activeWeather = "rain";
      } else if (weatherRes.temperature_f <= 25) {
        activeWeather = "cold";
      }
    }
  } catch (err) {
    log.warn("buildBdiFirstMessage · parallel context fetches failed", { err });
  }

  // Closing-soon evaluation (America/New_York)
  let closingMinutes: number | null = null;
  let isClosingSoon = false;
  try {
    const nyDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const dayOfWeek = nyDate.getDay(); // 0=Sun, 1-6=Mon-Sat
    const hour = nyDate.getHours();
    const minute = nyDate.getMinutes();
    const currentMinutes = hour * 60 + minute;
    const closeMinutes = dayOfWeek === 0 ? 16 * 60 : 18 * 60;
    const diff = closeMinutes - currentMinutes;
    if (diff > 0 && diff <= 60) {
      closingMinutes = diff;
      isClosingSoon = true;
    }
  } catch (err) {
    log.warn("buildBdiFirstMessage · closing calc failed", { err });
  }

  const isLoaded = waitTime?.available && waitTime.load === "loaded";

  // 1 · IDENTITY · existing personalization path · firstName + vehicle
  let lookup: Awaited<ReturnType<typeof caller.lookupCustomer>>;
  try {
    lookup = await caller.lookupCustomer({ phone });
  } catch (err) {
    log.warn("buildBdiFirstMessage · lookupCustomer threw", {
      phoneSuffix: phone.replace(/\D/g, "").slice(-4),
      err: err instanceof Error ? err.message : String(err),
    });
    return { matched: false, kind: "unknown", reason: "lookupCustomer error" };
  }

  // Handle Unmatched Caller (Default Assistant message with overrides if closing/loaded/weather active)
  if (!lookup.found || !lookup.firstName?.trim()) {
    let firstMessage: string | undefined;
    let reason = "unknown caller";

    if (isClosingSoon) {
      firstMessage = `Nick's Tire and Auto — just a heads up, we close in about ${closingMinutes} minutes today, but what can I do for ya?`;
      reason = "closing_soon override for unknown caller";
    } else if (isLoaded) {
      firstMessage = `Nick's Tire and Auto — we're super slammed today with about an hour wait in the bays, but what can I do for you?`;
      reason = "loaded override for unknown caller";
    } else if (activeWeather === "snow") {
      firstMessage = "Nick's Tire and Auto — stay safe in that Cleveland snow today. What can I do for you?";
      reason = "snow override for unknown caller";
    } else if (activeWeather === "rain") {
      firstMessage = "Nick's Tire and Auto — stay safe in that heavy Cleveland rain today. What can I do for you?";
      reason = "rain override for unknown caller";
    } else if (activeWeather === "cold") {
      firstMessage = "Nick's Tire and Auto — stay warm out there in that Cleveland cold today. What can I do for you?";
      reason = "cold override for unknown caller";
    }

    return {
      matched: false,
      kind: "unknown",
      reason,
      firstMessage,
    };
  }

  const firstName = lookup.firstName.trim();

  // 2 · DESIRE · check for an unconverted estimate · if found, open with
  // the recovery hook. If not, fall through to welcome-back.
  let declined: Awaited<ReturnType<typeof caller.getDeclinedEstimate>>;
  try {
    declined = await caller.getDeclinedEstimate({ phone });
  } catch (err) {
    // Non-fatal · if declined lookup fails we still ship the welcome-back
    // greeting. Log and proceed.
    log.warn("buildBdiFirstMessage · getDeclinedEstimate threw", {
      phoneSuffix: phone.replace(/\D/g, "").slice(-4),
      err: err instanceof Error ? err.message : String(err),
    });
    declined = { found: false } as typeof declined;
  }

  // Compose dynamic greeting modifiers for matched callers
  let modifierText = "";
  let statusSentence = "";

  if (isClosingSoon) {
    modifierText = `we close in about ${closingMinutes} minutes today`;
    statusSentence = `We close in about ${closingMinutes} minutes today. `;
  } else if (isLoaded) {
    modifierText = "we're super slammed today with about an hour wait in the bays";
    statusSentence = "We're super slammed today with about an hour wait in the bays. ";
  } else if (activeWeather === "snow") {
    modifierText = "stay safe in that Cleveland snow today";
    statusSentence = "Stay safe in that Cleveland snow today. ";
  } else if (activeWeather === "rain") {
    modifierText = "stay safe in that heavy Cleveland rain today";
    statusSentence = "Stay safe in that heavy Cleveland rain today. ";
  } else if (activeWeather === "cold") {
    modifierText = "stay warm out there in that Cleveland cold today";
    statusSentence = "Stay warm out there in that Cleveland cold today. ";
  }

  // 3 · INTENTION · compose the firstMessage from the strongest available
  // signal. Brand voice · short · direct · no fluff · §11 Eagerness Beat
  // (offer choice, no pressure) · matches existing first-message cadence.
  if (declined.found) {
    const dollars = declined.estimateDollars ?? 0;
    const service = (declined.service ?? "the work we discussed").trim();
    const vehiclePhrase = lookup.vehicle ? ` on the ${lookup.vehicle}` : "";
    // Soften the dollar callout for older estimates · the caller may not
    // remember the exact number from 100+ days ago.
    const daysOld = declined.daysOld ?? 999;
    const recoveryLine =
      daysOld <= 30
        ? `Last visit we quoted ${formatDollars(dollars)} for ${normalizeService(service)}${vehiclePhrase} we didn't end up doing.`
        : `Looks like we wrote you up for ${normalizeService(service)}${vehiclePhrase} a few weeks back and didn't get to finish it.`;

    return {
      matched: true,
      kind: "declined_recovery",
      reason: `declined_recovery · ${dollars}$ · ${daysOld}d old${statusSentence ? ` · status override` : ""}`,
      firstMessage:
        `Nick's Tire and Auto — ${firstName}, welcome back. ${statusSentence}${recoveryLine} Calling about that, or something else?`,
    };
  }

  // Welcome-back · matches the existing wave-181.63 personalization shape
  // so we don't regress on the proven path when no declined estimate is
  // outstanding.
  let welcomeBack = "";
  if (modifierText) {
    // If it's a state modifier (closing / busy), use "but what's going on / what can I do"
    if (isClosingSoon || isLoaded) {
      welcomeBack = lookup.vehicle
        ? `Nick's Tire and Auto — ${firstName}, welcome back. ${modifierText}, but what's going on with the ${lookup.vehicle}?`
        : `Nick's Tire and Auto — ${firstName}, welcome back. ${modifierText}, but what can I do for you?`;
    } else {
      // Weather: separate sentences
      welcomeBack = lookup.vehicle
        ? `Nick's Tire and Auto — ${firstName}, welcome back. ${statusSentence}What's going on with the ${lookup.vehicle}?`
        : `Nick's Tire and Auto — ${firstName}, welcome back. ${statusSentence}What can I do for you?`;
    }
  } else {
    // Normal welcome back
    welcomeBack = lookup.vehicle
      ? `Nick's Tire and Auto — ${firstName}, welcome back. What's going on with the ${lookup.vehicle}?`
      : `Nick's Tire and Auto — ${firstName}, welcome back. What can I do for you?`;
  }

  return {
    matched: true,
    kind: "welcome_back",
    reason: `welcome_back · ${firstName}${lookup.vehicle ? ` · ${lookup.vehicle}` : ""}${statusSentence ? ` · status override` : ""}`,
    firstMessage: welcomeBack,
  };
}

// ── helpers ─────────────────────────────────────────────────────────

function createInternalCaller() {
  // Lazy-load to avoid a router → service cycle at module init.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { voiceAgentRouter } = require("../routers/voiceAgent") as typeof import("../routers/voiceAgent");
  return voiceAgentRouter.createCaller({
    user: null,
    isVoiceAgentInternal: true,
  } as never);
}

/** "$487" → "$487" · "487" → "$487" · 0 → "the amount we quoted" */
function formatDollars(d: number): string {
  if (!d || d <= 0) return "the amount we quoted";
  return `$${d.toLocaleString("en-US")}`;
}

/**
 * Trim verbose ALG service descriptions for the spoken opener. ALG often
 * writes things like "FRONT BRAKE PADS + ROTORS + LABOR (PARTS @ $X)" —
 * too dense for natural speech. Keep the first comma-separated chunk or
 * the first 40 chars, whichever is shorter.
 */
function normalizeService(s: string): string {
  const first = s.split(/[,(\-·]/)[0]?.trim() ?? s;
  const compact = first.length > 40 ? first.slice(0, 40).trim() : first;
  return compact.toLowerCase().replace(/\s+/g, " ");
}
