/**
 * AUTO-PROMOTE GATE (job 2026-10-31-self-learning-nickstire, W2).
 *
 * One shape for every learning loop that may change what the shop's systems do
 * on its own: an offline gate, then (W3) a live canary with automatic
 * rollback, always under a kill switch Nour controls and a version history he
 * can undo from. Nour, 2026-10-30: the loops should learn daily and apply their
 * own wins with no manual step. That covers what passes this gate, never a way
 * around it.
 *
 * The decision core is pure (no DB, no clock, no network). The receptionist's
 * push lives in receptionistPromotion.ts.
 *
 * FLOORS. A learned edit may never touch the text that carries the shop's
 * promises: prices, opt-out handling, hours, offers, legal or payment wording,
 * transfers and callbacks, phone numbers or the shop's identity. The check runs on the FULL
 * changed region (removed and added lines), recomputed here from the two
 * prompts, never on the capped operator diff. It is strict on purpose: a false
 * refusal costs one night's candidate, a false pass reaches callers.
 */
import { BUSINESS } from "@shared/business";

export const RECEPTIONIST_LOOP = "receptionist_prompt";

/** The optimizer's own caps (promptEvolution.ts EDIT_FIND_MAX_CHARS + EDIT_GROWTH_MAX_CHARS): one bounded section. */
const MAX_CHANGED_CHARS = 6000 + 2500;

interface FloorRule {
  name: string;
  rx: RegExp;
}

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Checked in order; the first hit names the refusal. */
const RECEPTIONIST_FLOORS: readonly FloorRule[] = [
  { name: "price", rx: /\$\s?\d|\b\d+(?:\.\d+)?\s?(?:dollars?|bucks)\b/i },
  { name: "opt_out", rx: /\b(?:stop|opt[- ]?out|unsubscribe|do not call|don'?t call|not to be called)\b/i },
  {
    name: "hours",
    rx: /\b\d{1,2}(?::\d{2})?\s?[ap]\.?m\b\.?|\b(?:hours|open|close[sd]?|closing)\b[^.\n]*\b(?:\d|daily|every day|weekend|(?:mon|tues|wednes|thurs|fri|satur|sun)day)/i,
  },
  { name: "offer", rx: /\b(?:discounts?|percent off|coupons?|promo\w*|specials?|deals?|free|price[- ]?match\w*|warrant\w*|guarantee\w*)\b|\d+\s?%/i },
  { name: "legal_or_payment", rx: /\b(?:financ\w*|payment programs?|credit|leas(?:e|ing)|legal\w*|liabilit\w*|consent|record(?:ed|ing)|privacy|attorney)\b/i },
  { name: "transfer", rx: /\b(?:transfer\w*|manager|forward\w*|escalat\w*|human|owner)\b/i },
  // The transfer and callback script belongs to the transfer-callback lane (manager ruling 2026-10-31).
  { name: "callback", rx: /\b(?:call(?:ing)?[- ]?backs?|ring (?:you|them) back|return(?:ed)? (?:the |your )?call)\b/i },
  { name: "phone_number", rx: /\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/ },
  {
    name: "business_fact",
    rx: new RegExp(
      [BUSINESS.name, BUSINESS.legalName, BUSINESS.phone.raw, BUSINESS.address.street, BUSINESS.address.zip].map(escapeRx).join("|"),
      "i",
    ),
  },
];

const lines = (s: string) => s.replace(/\r\n/g, "\n").split("\n");

/** Common leading and trailing line counts between two texts. */
function commonEnds(a: string[], b: string[]): { pre: number; suf: number } {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  return { pre, suf };
}

/** The changed lines between the common leading and trailing lines, in full (no caps). null = identical. */
function changedRegion(base: string, candidate: string): { removed: string[]; added: string[] } | null {
  const a = lines(base);
  const b = lines(candidate);
  const { pre, suf } = commonEnds(a, b);
  const removed = a.slice(pre, a.length - suf);
  const added = b.slice(pre, b.length - suf);
  return removed.length || added.length ? { removed, added } : null;
}

/** The first floor the edit touches (in a removed or an added line), or null. */
function floorHit(base: string, candidate: string, rules: readonly FloorRule[] = RECEPTIONIST_FLOORS): string | null {
  const region = changedRegion(base, candidate);
  if (!region) return null;
  const changed = [...region.removed, ...region.added];
  for (const rule of rules) if (changed.some((l) => rule.rx.test(l))) return rule.name;
  return null;
}

export type PromotionDecision = { verdict: "promote" } | { verdict: "hold"; reason: string };

export interface ReceptionistPromotionInput {
  /** Kill switch: true = paused, null = unreadable (holds: fail closed). */
  paused: boolean | null;
  /** EvolutionOutcome. */
  outcome: string;
  /** accepted.confirmed: the sealed set confirmed the holdout pass. */
  confirmed: boolean;
  /** baseline.parity: identical | code_plus_lessons | diverged. */
  parity: string;
  /** candidateDiff.codeEdit: true = the edit sits in the code prompt, so a manual push can carry it (the overlay). */
  codeEdit: boolean | null;
  basePrompt: string | null;
  candidatePrompt: string | null;
  /** ASSISTANT_SYSTEM_PROMPT: the edit must apply to it once, or a manual push would silently drop it. */
  codePrompt: string;
  /** A promotion whose canary has not ended (W3): one live change is measured at a time. */
  canaryOpen?: boolean;
}

/** One nightly receptionist decision. Order matters: the first refusal is the reason. */
export function decideReceptionistPromotion(input: ReceptionistPromotionInput): PromotionDecision {
  const hold = (reason: string): PromotionDecision => ({ verdict: "hold", reason });
  if (input.paused === null) return hold("kill_switch_unreadable");
  if (input.paused) return hold("kill_switch");
  if (input.canaryOpen) return hold("canary_open");
  if (input.outcome !== "accepted") return hold(`offline_${input.outcome}`);
  if (!input.confirmed) return hold("offline_unconfirmed");
  if (input.parity === "diverged") return hold("live_prompt_diverged");
  if (input.codeEdit !== true) return hold("not_a_code_edit");
  if (!input.basePrompt || !input.candidatePrompt) return hold("texts_unavailable");
  const region = changedRegion(input.basePrompt, input.candidatePrompt);
  if (!region) return hold("no_change");
  const changedChars = [...region.removed, ...region.added].reduce((n, l) => n + l.length + 1, 0);
  if (changedChars > MAX_CHANGED_CHARS) return hold("edit_too_large");
  const floor = floorHit(input.basePrompt, input.candidatePrompt);
  if (floor) return hold(`floor_${floor}`);
  const overlay = buildOverlay(input.basePrompt, input.candidatePrompt);
  if (!overlay || applyOverlay(input.codePrompt, overlay) === null) return hold("overlay_not_applicable");
  return { verdict: "promote" };
}

/**
 * The promoted edit as find/replace text with one unchanged line of context on
 * each side, so a pure insertion still has an anchor. null = no change.
 */
export interface PromptOverlay {
  find: string;
  replace: string;
}

export function buildOverlay(base: string, candidate: string): PromptOverlay | null {
  const a = lines(base);
  const b = lines(candidate);
  const { pre, suf } = commonEnds(a, b);
  if (pre === a.length && pre === b.length) return null;
  const from = Math.max(0, pre - 1);
  const aEnd = Math.min(a.length, a.length - suf + 1);
  const bEnd = Math.min(b.length, b.length - suf + 1);
  return { find: a.slice(from, aEnd).join("\n"), replace: b.slice(from, bEnd).join("\n") };
}

/**
 * The code prompt with the promoted edit applied, or null when the find text is
 * not there exactly once (the code changed since: code wins, the edit is stale).
 */
export function applyOverlay(codePrompt: string, overlay: PromptOverlay): string | null {
  const text = codePrompt.replace(/\r\n/g, "\n");
  const at = text.indexOf(overlay.find);
  if (at < 0 || text.indexOf(overlay.find, at + 1) >= 0) return null;
  return text.slice(0, at) + overlay.replace + text.slice(at + overlay.find.length);
}

export type PromotionStatus =
  | "would_promote"
  | "held"
  | "promoting"
  | "promoted"
  | "push_failed"
  | "readback_restored"
  // W3: the canary's end states and the rollback's.
  | "canary_passed"
  | "rolling_back"
  | "rolled_back"
  | "undone"
  | "rollback_failed";

/** Statuses that end a promotion's canary. */
const CANARY_ENDED: ReadonlySet<PromotionStatus> = new Set(["canary_passed", "rolling_back", "rolled_back", "undone", "rollback_failed"]);

/**
 * The promotion whose canary is still open: the newest "promoted" row with no
 * ending row after it. null = none (every later row is a hold, a would-promote or
 * a failed push, which change nothing live).
 */
export function openPromotion(rows: readonly PromotionRecord[]): PromotionRecord | null {
  for (const row of rows) {
    if (CANARY_ENDED.has(row.status)) return null;
    if (row.status === "promoted") return row;
  }
  return null;
}

export interface PromotionRecord {
  versionId: string;
  at: string;
  loop: string;
  status: PromotionStatus;
  reason: string | null;
  baseHash: string;
  candidateHash: string | null;
}

/** Longer than a 14-day canary of nightly rows, so an open promotion never scrolls out. */
const HISTORY_CAP = 40;

/**
 * The new history row, newest first, capped. null = the stored row exists and is not a list:
 * the caller must NOT write, so a revert trail is never overwritten on a guess.
 */
export function appendPromotionHistory(raw: string | null, rec: PromotionRecord): string | null {
  let list: unknown[] = [];
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      list = parsed;
    } catch {
      return null;
    }
  }
  return JSON.stringify([rec, ...list].slice(0, HISTORY_CAP));
}

/** The kv row holding one loop's promotion history. */
export const promotionHistoryKey = (loop: string) => `autopromote_${loop}_history`;
