/**
 * SLEEP-CONTEXT MODE — soften chat after late hours.
 *
 * v7 · BATCH 5 · Apr 28. After 10pm Cleveland (UTC -5/-4 depending on
 * DST), Nick's tone shifts:
 *   · No urgent push notifications
 *   · Smaller default response budget
 *   · Wind-down language ("get some sleep") instead of action-pressure
 *   · No "you should..." aggressive nudges
 *
 * Why: Nour's already in bed-ready mode. Heavy responses = mental load
 * = bad sleep = worse decisions tomorrow. Compounding.
 *
 * Returns simple boolean + recommended modifications.
 */

export interface SleepContext {
  isSleepWindow: boolean;
  hour: number;
  timezone: "Cleveland";
  modifications: {
    /** Cap response in tokens — half of usual */
    maxOutputTokens: number;
    /** Add a wind-down hint to the prompt */
    promptHint: string;
    /** Skip non-critical pushes */
    suppressPush: boolean;
    /** Suggest sleep instead of action */
    suggestSleep: boolean;
  };
}

const CLEVELAND_OFFSET_HOURS = -5; // EST. -4 in DST. close enough.

export function getSleepContext(now: Date = new Date()): SleepContext {
  // Convert UTC to Cleveland local hour
  const utcHour = now.getUTCHours();
  let clevelandHour = (utcHour + CLEVELAND_OFFSET_HOURS + 24) % 24;
  // Approximate DST: from second Sunday of March → first Sunday of November
  const month = now.getUTCMonth();
  if (month >= 2 && month <= 10) {
    clevelandHour = (utcHour + CLEVELAND_OFFSET_HOURS + 1 + 24) % 24;
  }

  // Sleep window: 10pm → 6am local
  const isSleep = clevelandHour >= 22 || clevelandHour < 6;

  return {
    isSleepWindow: isSleep,
    hour: clevelandHour,
    timezone: "Cleveland",
    modifications: {
      maxOutputTokens: isSleep ? 600 : 4000,
      promptHint: isSleep
        ? `It's ${clevelandHour}:00 Cleveland. Nour should be winding down. Keep replies short, gentle, action-light. No "you should" pressure. End on rest.`
        : "",
      suppressPush: isSleep,
      suggestSleep: isSleep && clevelandHour < 2,
    },
  };
}
