export const BUSINESS_TIME_ZONE = "America/New_York";

/** Return a stable YYYY-MM-DD calendar key in Nick's Tire's business timezone. */
export function getBusinessDateKey(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part