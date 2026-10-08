/**
 * Sunrise, sunset and civil twilight for the shop, computed locally (camera audit 2026-10-07,
 * N3). No external service: this feeds a health state, and a health state that depends on a
 * third-party API has a second way to be wrong.
 *
 * NOAA's solar calculator equations (the spreadsheet form), evaluated once at the local day's
 * solar noon. Accuracy is about a minute, which is more than the use needs: the shop-sign
 * camera is solar-powered and goes dark around civil dusk, and the two measured recoveries
 * (2026-10-04 09:15 ET, 2026-10-07 09:23 ET) came about two hours after sunrise, so the
 * expected-offline window is [civil dusk, sunrise + recoveryMinutes). Loss inside that window
 * is expected and does not page; loss outside it is a camera to go look at.
 *
 * Reference the tests pin: Cleveland, 2026-10-08 -- sunrise 07:29 EDT, sunset 18:58 EDT,
 * civil twilight about 07:03 / 19:25 EDT.
 */
import { BUSINESS } from "../../shared/business";

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;

export type SolarDay = {
  /** The local calendar day these events belong to, as YYYY-MM-DD in the shop's time zone. */
  localDay: string;
  sunriseMs: number;
  sunsetMs: number;
  civilDawnMs: number;
  civilDuskMs: number;
};

type Place = { lat: number; lng: number; timezone: string };

const SHOP: Place = { lat: BUSINESS.geo.lat, lng: BUSINESS.geo.lng, timezone: BUSINESS.timezone };

/** YYYY-MM-DD of `at` in `timezone`, via Intl so DST is the platform's problem, not ours. */
export function localDayOf(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, p) => (p.type === "literal" ? acc : { ...acc, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Hour angle (degrees) for a given zenith, or null when the sun never reaches it that day. */
function hourAngle(zenithDeg: number, latDeg: number, declDeg: number): number | null {
  const cosHa =
    Math.cos(zenithDeg * RAD) / (Math.cos(latDeg * RAD) * Math.cos(declDeg * RAD)) -
    Math.tan(latDeg * RAD) * Math.tan(declDeg * RAD);
  if (cosHa < -1 || cosHa > 1) return null;
  return Math.acos(cosHa) / RAD;
}

/**
 * Solar events for the local calendar day `localDay` (YYYY-MM-DD) at `place`, as UTC epoch ms.
 * Events are computed against the UTC date of that day's local noon; for places west of
 * Greenwich that is the same calendar date, which keeps "today's sunset" on today.
 */
export function solarDay(localDay: string, place: Place = SHOP): SolarDay {
  const [y, m, d] = localDay.split("-").map(Number);
  const dayStartUtcMs = Date.UTC(y, m - 1, d);
  // Fractional day of local solar noon in UTC: 12h minus the longitude offset.
  const noonFraction = (720 - 4 * place.lng) / 1440;
  const jd = dayStartUtcMs / DAY_MS + 2440587.5 + noonFraction;
  const jc = (jd - 2451545) / 36525;

  const gmls = ((280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360 + 360) % 360;
  const gmas = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const eeo = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const seoc =
    Math.sin(gmas * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * gmas * RAD) * (0.019993 - 0.000101 * jc) +
    Math.sin(3 * gmas * RAD) * 0.000289;
  const stl = gmls + seoc;
  const sal = stl - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * jc) * RAD);
  const moe = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const oc = moe + 0.00256 * Math.cos((125.04 - 1934.136 * jc) * RAD);
  const decl = Math.asin(Math.sin(oc * RAD) * Math.sin(sal * RAD)) / RAD;
  const yv = Math.tan((oc / 2) * RAD) ** 2;
  const eqTimeMin =
    (4 / RAD) *
    (yv * Math.sin(2 * gmls * RAD) -
      2 * eeo * Math.sin(gmas * RAD) +
      4 * eeo * yv * Math.sin(gmas * RAD) * Math.cos(2 * gmls * RAD) -
      0.5 * yv * yv * Math.sin(4 * gmls * RAD) -
      1.25 * eeo * eeo * Math.sin(2 * gmas * RAD));

  const solarNoonMin = 720 - 4 * place.lng - eqTimeMin; // minutes after UTC midnight
  const at = (minutes: number) => dayStartUtcMs + Math.round(minutes * 60_000);

  // Polar day/night never happens at 41.55N; fall back to noon so callers still get numbers.
  const haSun = hourAngle(90.833, place.lat, decl) ?? 0;
  const haCivil = hourAngle(96, place.lat, decl) ?? 0;
  return {
    localDay,
    sunriseMs: at(solarNoonMin - 4 * haSun),
    sunsetMs: at(solarNoonMin + 4 * haSun),
    civilDawnMs: at(solarNoonMin - 4 * haCivil),
    civilDuskMs: at(solarNoonMin + 4 * haCivil),
  };
}

export type SolarExpectation = {
  expectedOffline: boolean;
  /** The window in force for `now`: dark from `fromMs` (civil dusk) until `untilMs` (sunrise + lag). */
  fromMs: number;
  untilMs: number;
  reason: string;
};

export const SOLAR_RECOVERY_MINUTES = 120;

/**
 * Whether a solar-powered camera is expected to be dark at `now`: between the previous civil
 * dusk and `recoveryMinutes` after the next sunrise. The window is anchored on `now`'s local
 * day: before today's sunrise+lag it is last night's window; after today's dusk it is tonight's.
 */
export function solarExpectedOffline(
  now: Date,
  place: Place = SHOP,
  recoveryMinutes: number = SOLAR_RECOVERY_MINUTES,
): SolarExpectation {
  const today = solarDay(localDayOf(now, place.timezone), place);
  const t = now.getTime();
  const recoverBy = today.sunriseMs + recoveryMinutes * 60_000;
  const hhmm = (ms: number) =>
    new Intl.DateTimeFormat("en-US", { timeZone: place.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));

  if (t < recoverBy) {
    const yesterday = solarDay(localDayOf(new Date(today.sunriseMs - DAY_MS / 2), place.timezone), place);
    return {
      expectedOffline: true,
      fromMs: yesterday.civilDuskMs,
      untilMs: recoverBy,
      reason: `solar camera: dark from civil dusk ${hhmm(yesterday.civilDuskMs)} until about ${hhmm(recoverBy)} (sunrise ${hhmm(today.sunriseMs)} + ${recoveryMinutes} min) is expected`,
    };
  }
  if (t >= today.civilDuskMs) {
    const tomorrow = solarDay(localDayOf(new Date(today.sunsetMs + DAY_MS / 2), place.timezone), place);
    const nextRecover = tomorrow.sunriseMs + recoveryMinutes * 60_000;
    return {
      expectedOffline: true,
      fromMs: today.civilDuskMs,
      untilMs: nextRecover,
      reason: `solar camera: dark from civil dusk ${hhmm(today.civilDuskMs)} until about ${hhmm(nextRecover)} (sunrise ${hhmm(tomorrow.sunriseMs)} + ${recoveryMinutes} min) is expected`,
    };
  }
  return {
    expectedOffline: false,
    fromMs: recoverBy,
    untilMs: today.civilDuskMs,
    reason: `daylight: the solar camera should be awake from about ${hhmm(recoverBy)} until civil dusk ${hhmm(today.civilDuskMs)}`,
  };
}
