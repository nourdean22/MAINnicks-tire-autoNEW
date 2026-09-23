/**
 * Tire Identification Number (TIN, the "DOT code") capture + 49 CFR 574.8 registration.
 *
 * LEGAL FRAME (eCFR, read 2026-09-23; 574.8 last amended 73 FR 72368, 2008-11-28):
 * - 49 CFR 574.8(a): an independent dealer selling NEW tires must, for each sale, do ONE of
 *   (i)   give the purchaser a paper registration form on which the dealer has recorded the
 *         tire identification number(s) and the dealer's name and street address;
 *   (ii)  record the purchaser's name/address + the TINs on a paper form and return it to the
 *         manufacturer (or its designee) at no charge, within 30 days of the sale; or
 *   (iii) transmit the same data electronically, by secure means, within 30 days.
 *   Several tires sold to one purchaser may go on one form. 574.8 names new tires only; a USED
 *   tire has no registration duty, but its TIN is still worth capturing (age, recalls).
 * - 49 CFR 574.5: symbols are A-Z and 0-9 EXCEPT G, I, O, Q, S, Z. A current new-tire TIN is 13
 *   symbols: plant code (3) + manufacturer's code (6) + date code (4, week + year). Plants with
 *   an older two-symbol assignment could use the older layout (plant 2 + size 2 + optional
 *   up to 4 + date 4) through 2025-04-13, so those tires are still on shelves. A retread TIN is
 *   7 symbols. Tires made before 2000 carry a THREE-digit date code (week + last digit of the
 *   year) — flagged here, never accepted as valid.
 *
 * This module is pure: no DB, no network. The system never submits a registration or contacts
 * a customer — it produces the form and records what the shop did.
 */

const TIN_ALLOWED = /^[ABCDEFHJKLMNPRTUVWXY0-9]+$/;
const EXCLUDED_LETTERS = ["G", "I", "O", "Q", "S", "Z"] as const;

export type TinStatus = "valid" | "legacy_date_code" | "invalid";

export interface TinCheck {
  status: TinStatus;
  /** Uppercased, spaces/hyphens and a leading "DOT" removed. */
  normalized: string;
  plantCode: string | null;
  week: number | null;
  /** Four-digit year of manufacture (null for a 3-digit legacy code — the decade is ambiguous). */
  year: number | null;
  /** Human-readable problems, empty when valid. */
  issues: string[];
}

function normalizeTin(raw: string): string {
  let s = (raw ?? "").toUpperCase().replace(/[\s\-_.]/g, "");
  if (s.startsWith("DOT")) s = s.slice(3);
  return s;
}

function weekOk(week: number): boolean {
  return week >= 1 && week <= 53;
}

/**
 * Validate a TIN as typed off the sidewall. `now` is injectable so tests pin the clock.
 * The date code is the LAST group, so it is read from the end of the string.
 */
export function checkTin(raw: string, now: Date = new Date()): TinCheck {
  const normalized = normalizeTin(raw);
  const fail = (issues: string[]): TinCheck => ({
    status: "invalid", normalized, plantCode: null, week: null, year: null, issues,
  });

  if (!normalized) return fail(["Enter the DOT code from the sidewall."]);

  if (!TIN_ALLOWED.test(normalized)) {
    const bad = Array.from(new Set(normalized.split("").filter((c) => !/[A-Z0-9]/.test(c) || EXCLUDED_LETTERS.includes(c as never))));
    const hint = bad.includes("O") ? " (the letter O is never used — it is probably a zero)" : "";
    return fail([`Contains symbols a TIN never uses: ${bad.join(" ")}${hint}.`]);
  }

  if (normalized.length < 7 || normalized.length > 13) {
    return fail([`A TIN is 7 to 13 symbols after "DOT"; this one has ${normalized.length}.`]);
  }

  const plantCode = normalized.length === 13 ? normalized.slice(0, 3) : normalized.slice(0, 2);
  const currentYear = now.getUTCFullYear();

  const last4 = normalized.slice(-4);
  if (/^\d{4}$/.test(last4)) {
    const week = Number(last4.slice(0, 2));
    const year = 2000 + Number(last4.slice(2));
    const currentWeekApprox = Math.ceil(((now.getTime() - Date.UTC(currentYear, 0, 1)) / 86_400_000 + 1) / 7);
    const future = year > currentYear || (year === currentYear && week > currentWeekApprox + 1);
    if (weekOk(week) && !future) {
      return { status: "valid", normalized, plantCode, week, year, issues: [] };
    }
    // Not a plausible WWYY: maybe a pre-2000 three-digit code (e.g. "...5239" = week 23 of 199x).
    const legacy = legacyCheck(normalized, plantCode);
    if (legacy) return legacy;
    return fail([
      future
        ? `Date code ${last4} is in the future (week ${week} of ${year}).`
        : `Date code ${last4}: week ${week} does not exist (weeks run 01-53).`,
    ]);
  }

  const legacy = legacyCheck(normalized, plantCode);
  if (legacy) return legacy;
  return fail([`The TIN must end in a 4-digit date code (week + year, e.g. 2324); it ends in "${last4}".`]);
}

function legacyCheck(normalized: string, plantCode: string): TinCheck | null {
  const last3 = normalized.slice(-3);
  if (!/^\d{3}$/.test(last3)) return null;
  // A 3-digit code has a non-digit (or the 4th digit) before it; only the 7-11 symbol pre-2000
  // layout (plant 2 + size 2 + optional + date 3) can carry one.
  if (normalized.length > 11) return null;
  const week = Number(last3.slice(0, 2));
  if (!weekOk(week)) return null;
  return {
    status: "legacy_date_code",
    normalized,
    plantCode,
    week,
    year: null,
    issues: [
      `3-digit date code ${last3}: made before 2000 (week ${week} of a year ending in ${last3[2]}). ` +
        "Too old to sell or install — check the tire.",
    ],
  };
}

/** Whole years since the week of manufacture (null when unknown). */
export function tinAgeYears(check: TinCheck, now: Date = new Date()): number | null {
  if (check.status !== "valid" || check.week == null || check.year == null) return null;
  const made = Date.UTC(check.year, 0, 1) + (check.week - 1) * 7 * 86_400_000;
  return Math.floor((now.getTime() - made) / (365.25 * 86_400_000));
}

// ─── Positions + registration methods ──────────────────────────────────────

export const TIRE_POSITIONS = ["LF", "RF", "LR", "RR", "LRI", "RRI", "SPARE"] as const;
export type TirePosition = (typeof TIRE_POSITIONS)[number];
export const TIRE_POSITION_LABELS: Record<TirePosition, string> = {
  LF: "Left front", RF: "Right front", LR: "Left rear", RR: "Right rear",
  LRI: "Left rear inner", RRI: "Right rear inner", SPARE: "Spare",
};

export const TIRE_CONDITIONS = ["new", "used"] as const;
export type TireCondition = (typeof TIRE_CONDITIONS)[number];

/**
 * What the shop did to satisfy 574.8 for this tire. VARCHAR(32) in the DB — longest is 27.
 * The system RECORDS these; it never performs the submission itself.
 */
export const REGISTRATION_METHODS = [
  "pending",
  "form_given",                 // 574.8(a)(1)(i)
  "dealer_submitted_paper",     // 574.8(a)(1)(ii)
  "dealer_submitted_electronic", // 574.8(a)(1)(iii)
  "not_required_used",          // used tire — 574.8 covers new tires only
] as const;
export type RegistrationMethod = (typeof REGISTRATION_METHODS)[number];
export const REGISTRATION_METHOD_LABELS: Record<RegistrationMethod, string> = {
  pending: "Not registered yet",
  form_given: "Form handed to customer",
  dealer_submitted_paper: "Shop mailed form to maker",
  dealer_submitted_electronic: "Shop registered online",
  not_required_used: "Used tire — not required",
};

/** 574.8(a)(1)(ii)/(iii): the dealer-submitted routes are due within 30 days of the sale. */
export const REGISTRATION_WINDOW_DAYS = 30;

// ─── Completeness ──────────────────────────────────────────────────────────

export interface RegistrationRowLike {
  position: string;
  tin: string | null;
  tinStatus: string | null;
  tireCondition: string;
  registrationMethod: string;
}

export interface WorkOrderLineLike {
  type: string;
  quantity: string | number | null;
  approved?: boolean | null;
  declined?: boolean | null;
}

/** Tires the order says were sold: approved, non-declined `tire` lines, summed by quantity. */
export function expectedTireCount(items: WorkOrderLineLike[]): number {
  return items
    .filter((i) => i.type === "tire" && i.declined !== true && i.approved !== false)
    .reduce((n, i) => n + Math.max(0, Math.round(Number(i.quantity ?? 0)) || 0), 0);
}

export type RegistrationState = "unknown" | "not_applicable" | "incomplete" | "complete";

export interface RegistrationSummary {
  state: RegistrationState;
  expected: number | null;
  /** Positions with a valid TIN. */
  captured: number;
  /** Missing TINs, as "N more tire(s)" plus rows whose TIN is not valid. */
  missingTins: number;
  invalidPositions: string[];
  pendingPositions: string[];
}

/**
 * `expected === null` means the order could not be read. That renders as UNKNOWN — never as
 * "0 tires", which would read as "nothing to register" (empty-vs-error).
 */
export function summarizeRegistration(
  expected: number | null,
  rows: RegistrationRowLike[] | null,
): RegistrationSummary {
  if (expected == null || rows == null) {
    return { state: "unknown", expected, captured: 0, missingTins: 0, invalidPositions: [], pendingPositions: [] };
  }
  const withTin = rows.filter((r) => r.tin);
  const valid = withTin.filter((r) => r.tinStatus === "valid");
  const invalidPositions = withTin.filter((r) => r.tinStatus !== "valid").map((r) => r.position);
  const pendingPositions = rows
    .filter((r) => r.registrationMethod === "pending" || !REGISTRATION_METHODS.includes(r.registrationMethod as RegistrationMethod))
    .map((r) => r.position);
  const missingTins = Math.max(0, expected - valid.length) + invalidPositions.length;

  if (expected === 0 && rows.length === 0) {
    return { state: "not_applicable", expected, captured: 0, missingTins: 0, invalidPositions, pendingPositions };
  }
  const complete = missingTins === 0 && invalidPositions.length === 0 && pendingPositions.length === 0;
  return {
    state: complete ? "complete" : "incomplete",
    expected, captured: valid.length, missingTins, invalidPositions, pendingPositions,
  };
}

// ─── Manufacturer registration links ───────────────────────────────────────

/**
 * Only URLs verified to load (HTTP 200, 2026-09-23). Every other brand gets a web search for
 * "<brand> tire registration", labelled as a search — a guessed URL rots silently.
 */
const VERIFIED_REGISTRATION_URLS: Record<string, string> = {
  hankook: "https://www.hankooktire.com/us/en/register-your-tires.html",
};

export function registrationLink(brand: string | null | undefined): { url: string; verified: boolean } {
  const key = (brand ?? "").trim().toLowerCase();
  const url = VERIFIED_REGISTRATION_URLS[key];
  if (url) return { url, verified: true };
  const q = encodeURIComponent(`${(brand ?? "").trim() || "tire"} tire registration`);
  return { url: `https://www.google.com/search?q=${q}`, verified: false };
}

// ─── Printable registration form (574.8(a)(1)(i)) ──────────────────────────

export interface RegistrationFormInput {
  dealerName: string;
  dealerStreet: string;
  dealerCityStateZip: string;
  orderNumber: string;
  saleDate: string; // pre-formatted, e.g. "Sep 23, 2026"
  vehicle: string | null;
  tires: Array<{ position: string; tin: string; brand: string | null; tireCondition: string }>;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A self-contained HTML page: dealer name + street address and every TIN pre-filled; the
 * purchaser's name and address are left blank for the customer to complete and mail/enter,
 * so the shop's record holds no extra customer PII. Used tires are listed but marked as not
 * covered. Throws if there are no new tires — an empty form is not a compliance record.
 */
export function renderRegistrationFormHtml(input: RegistrationFormInput): string {
  const newTires = input.tires.filter((t) => t.tireCondition !== "used");
  if (newTires.length === 0) throw new Error("No new tires with a TIN on this order — nothing to register.");
  const brands = Array.from(new Set(newTires.map((t) => (t.brand ?? "").trim()).filter(Boolean)));
  const rows = input.tires
    .map((t) => `<tr><td>${esc(t.position)}</td><td class="tin">${esc(t.tin)}</td><td>${esc(t.brand ?? "")}</td><td>${
      t.tireCondition === "used" ? "Used — not covered by 574.8" : "New"}</td></tr>`)
    .join("");
  const links = brands
    .map((b) => { const l = registrationLink(b); return `<li>${esc(b)}: ${esc(l.verified ? l.url : "search “" + b + " tire registration”")}</li>`; })
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tire registration — ${esc(input.orderNumber)}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#111;background:#fff}
h1{font-size:20px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:12px 0}td,th{border:1px solid #999;padding:6px 8px;text-align:left}
.tin{font-family:ui-monospace,monospace;font-size:15px;letter-spacing:.06em}.line{border-bottom:1px solid #333;height:28px;margin:6px 0 12px}
.small{font-size:12px;color:#444}button{min-height:48px;min-width:48px;padding:0 20px;font-size:16px;margin:12px 0}
@media print{button{display:none}body{margin:0}}</style></head><body>
<h1>Tire Registration Form</h1>
<p class="small">Federal law (49 CFR 574.8) — keep your tires registered so the manufacturer can reach you about a recall.</p>
<p><strong>Sold by:</strong> ${esc(input.dealerName)}<br>${esc(input.dealerStreet)}<br>${esc(input.dealerCityStateZip)}</p>
<p><strong>Order:</strong> ${esc(input.orderNumber)} &nbsp; <strong>Date of sale:</strong> ${esc(input.saleDate)}${
    input.vehicle ? ` &nbsp; <strong>Vehicle:</strong> ${esc(input.vehicle)}` : ""}</p>
<table><thead><tr><th>Position</th><th>Tire identification number (DOT)</th><th>Brand</th><th>Condition</th></tr></thead><tbody>${rows}</tbody></table>
<p><strong>Purchaser name</strong></p><div class="line"></div>
<p><strong>Purchaser street address, city, state, ZIP</strong></p><div class="line"></div><div class="line"></div>
<p class="small">To register: fill in your name and address and mail this form to the tire manufacturer, or register online with the numbers above.</p>
${links ? `<ul class="small">${links}</ul>` : ""}
<button type="button" onclick="window.print()">Print</button>
</body></html>`;
}
