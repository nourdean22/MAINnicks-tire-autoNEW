/**
 * The one instant every v3 fixture render believes it is (2026-10-15 14:00 ET,
 * a Thursday). One literal: a fixture that reads the real clock makes "2h ago"
 * drift between the baseline run and the run it is compared with.
 * installFixtures() hands FIXED_TIME to page.clock.setFixedTime.
 */
export const FIXED_TIME = "2026-10-15T14:00:00-04:00";
/** The same instant as the server would put it on the wire; derived, never a second literal. */
export const NOW_ISO = new Date(FIXED_TIME).toISOString();
/** Ages in the fixtures are measured from this instant (tests/repo/v3-gate.test.ts recomputes them). */
export const NOW_MS = new Date(FIXED_TIME).getTime();
