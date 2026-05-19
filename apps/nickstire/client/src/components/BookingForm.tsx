/**
 * BookingForm — REPURPOSED to a Drop-Off CTA (alias of BookingWizard).
 *
 * 2026-05-19 · See BookingWizard.tsx for the full Elon-cut rationale.
 * This file used to host a separate simpler form variant; now it just
 * re-exports BookingWizard so any embed renders the same CTA.
 *
 * Keeping the named file + default export so the 40+ call sites don't
 * need updates. Operator can collapse to one component in a future
 * follow-up.
 */
export { default } from "./BookingWizard";
