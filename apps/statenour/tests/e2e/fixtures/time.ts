/**
 * The one instant every v3 fixture render believes it is (2026-10-15 14:00 ET,
 * a Thursday). Literal strings only: a fixture that reads the real clock makes
 * "2h ago" drift between the baseline run and the run it is compared with.
 * installFixtures() hands FIXED_TIME to page.clock.setFixedTime.
 */
export const FIXED_TIME = "2026-10-15T14:00:00-04:00";
/** The same instant as the ISO string the server would put on the wire. */
export const NOW_ISO = "2026-10-15T18:00:00.000Z";
