/**
 * Quality diagnostics for NICK chat.
 *
 * These scores are deterministic heuristics, not calibrated probabilities or
 * claims of human-level quality. Keeping that distinction in one module avoids
 * UI surfaces silently upgrading "no regex penalty" into "perfect".
 */

export interface QualityDiagnosticPayload {
  critic?: {
    overall?: number;
    specificity?: number;
    cliche?: number;
    antiNour?: number;
    length?: number;
    wordCount?: number;
    shouldRegen?: boolean;
    reasons?: string[];
    contentMode?: boolean;
    brandElement?: number;
    cta?: number;
    hashtagQuality?: number;
  };
  gate?: {
    severity?: number;
    shouldRegen?: boolean;
    reasons?: string[];
  };
  factCheck?: {
    total?: number;
    unverified?: number;
  };
  truth?: {
    total?: number;
    flags?: Array<{ kind?: string; rule?: string; snippet?: string; severity?: number }>;
  };
  receipt?: {
    ok?: boolean;
    toolsFired?: Array<{ toolName?: string; status?: string }>;
    offenders?: Array<{ toolName?: string; status?: string; label?: string }>;
  };
}

export const CRITIC_HEURISTIC_NOTE =
  "heuristic indices only — 100 means no penalty under that detector, not calibrated perfection";

function finite(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function show(value: number | undefined): string {
  const n = finite(value);
  return n === undefined ? "n/a" : String(n);
}

/**
 * One canonical predicate for whether the diagnostic strip must render.
 *
 * Receipt and truth warnings outrank style cleanliness: a polished answer is
 * not "clean" when an action is unverified or the truth guard fired.
 */
export function qualityHasIssue(payload: QualityDiagnosticPayload | undefined): boolean {
  if (!payload) return false;

  const overall = finite(payload.critic?.overall) ?? 100;
  const severity = finite(payload.gate?.severity) ?? 0;
  const unverified = finite(payload.factCheck?.unverified) ?? 0;
  const truthCount =
    finite(payload.truth?.total) ??
    (Array.isArray(payload.truth?.flags) ? payload.truth.flags.length : 0);
  const receiptFailed =
    payload.receipt?.ok === false ||
    (Array.isArray(payload.receipt?.offenders) && payload.receipt.offenders.length > 0);

  return !(
    overall >= 80 &&
    severity === 0 &&
    unverified === 0 &&
    truthCount === 0 &&
    !receiptFailed
  );
}

export function criticDiagnosticLine(
  critic: QualityDiagnosticPayload["critic"],
): string | null {
  if (!critic || finite(critic.overall) === undefined) return null;

  return [
    `critic heuristic · composite=${show(critic.overall)}`,
    `specificity-signal=${show(critic.specificity)}`,
    `cliche-avoidance=${show(critic.cliche)}`,
    `voice-guard=${show(critic.antiNour)}`,
    `length-fit=${show(critic.length)}`,
    `words=${show(critic.wordCount)}`,
  ].join(" · ");
}

export function truthWarningCount(payload: QualityDiagnosticPayload): number {
  return (
    finite(payload.truth?.total) ??
    (Array.isArray(payload.truth?.flags) ? payload.truth.flags.length : 0)
  );
}

export function receiptHasIssue(payload: QualityDiagnosticPayload): boolean {
  return (
    payload.receipt?.ok === false ||
    (Array.isArray(payload.receipt?.offenders) && payload.receipt.offenders.length > 0)
  );
}
