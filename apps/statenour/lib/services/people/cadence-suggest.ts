/**
 * A cadence PROPOSAL for one person (people W2, 2026-10-30). Pure.
 *
 * His own rhythm when the ledger holds 3+ real contacts (the median gap), else
 * a role band. Dunbar layers are guidance, never quotas (manager's research,
 * 2026-10-30), and roles with no personal rhythm get no proposal at all. The
 * caller parks the result for Nour's accept; nothing here sets a cadence.
 */

const DAY_MS = 86_400_000;
const MIN_DAYS = 3;
const MAX_DAYS = 180;

const ROLE_BANDS: Record<string, { days: number; note?: string }> = {
  family: { days: 7, note: "inner circle" },
  romantic: { days: 7, note: "inner circle" },
  close_friend: { days: 14 },
  friend: { days: 30 },
  mentor: { days: 30 },
  mentee: { days: 30 },
  acquaintance: { days: 90 },
  network_only: { days: 90 },
};

export interface CadenceSuggestion {
  days: number;
  basis: string;
}

export function suggestCadence(input: { role: string; contacts: readonly Date[] }): CadenceSuggestion | null {
  const times = input.contacts
    .filter((d): d is Date => d instanceof Date)
    .map((d) => d.getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (times.length >= 3) {
    const gaps = times.slice(1).map((t, i) => (t - times[i]) / DAY_MS).sort((a, b) => a - b);
    const mid = Math.floor(gaps.length / 2);
    const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
    const days = Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(median)));
    return { days, basis: `median gap between ${times.length} logged contacts` };
  }
  const band = ROLE_BANDS[input.role];
  if (!band) return null;
  const label = input.role.replace(/_/g, " ");
  return { days: band.days, basis: `default for ${label}${band.note ? ` (${band.note})` : ""}` };
}
