/**
 * Cookie Consent Manager for Nick's Tire & Auto
 * Manages user consent for analytics (GA4, Web Vitals) and marketing (Meta Pixel).
 * "necessary" cookies are always allowed.
 */

export type ConsentCategory = "analytics" | "marketing";

interface ConsentState {
  analytics: boolean;
  marketing: boolean;
  timestamp: number;
}

type ConsentChangeCallback = (state: ConsentState) => void;

const COOKIE_NAME = "nta_consent";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year in seconds

const listeners: ConsentChangeCallback[] = [];
let currentState: ConsentState | null = null;

function parseCookie(): ConsentState | null {
  try {
    const match = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${COOKIE_NAME}=`));
    if (!match) return null;
    return JSON.parse(decodeURIComponent(match.split("=")[1]));
  } catch {
    return null;
  }
}

function saveCookie(state: ConsentState): void {
  const value = encodeURIComponent(JSON.stringify(state));
  document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

/** Initialize consent state from saved cookie. */
export function initConsent(): ConsentState | null {
  currentState = parseCookie();
  return currentState;
}

/** Check if user has granted consent for a specific category. */
export function hasConsent(category: ConsentCategory): boolean {
  if (!currentState) currentState = parseCookie();
  if (!currentState) return false;
  return currentState[category] === true;
}

/** Check if user has made any consent choice (banner was dismissed). */
export function hasConsentChoice(): boolean {
  if (!currentState) currentState = parseCookie();
  return currentState !== null;
}

/** Set consent for specific categories. */
export function setConsent(categories: Partial<Record<ConsentCategory, boolean>>): void {
  const state: ConsentState = {
    analytics: categories.analytics ?? false,
    marketing: categories.marketing ?? false,
    timestamp: Date.now(),
  };
  currentState = state;
  saveCookie(state);
  listeners.forEach((cb) => cb(state));
}

/** Accept all consent categories. */
export function acceptAll(): void {
  setConsent({ analytics: true, marketing: true });
}

/** Reject all non-necessary categories. */
export function rejectAll(): void {
  setConsent({ analytics: false, marketing: false });
}

/** Register a callback for consent state changes. */
export function onConsentChange(callback: ConsentChangeCallback): () => void {
  listeners.push(callback);
  return () => {
    const idx = listeners.indexOf(callback);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/** Get current consent state (read-only). */
export function getConsentState(): ConsentState | null {
  if (!currentState) currentState = parseCookie();
  return currentState;
}
