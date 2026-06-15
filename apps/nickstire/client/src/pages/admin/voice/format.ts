// ─── VAPI dashboard URL helpers (wave-89) ───────────────────
// Operator wants escape hatches into the VAPI dashboard for things
// the admin doesn't expose (advanced assistant tuning, phone-number
// config, account billing, etc.). All open in a new tab.
const VAPI_DASHBOARD_BASE = "https://dashboard.vapi.ai";
export const VAPI_LINKS = {
  callDetail: (callId: string) => `${VAPI_DASHBOARD_BASE}/calls/${callId}`,
};

// ─── Sort / filter types (wave-89) ──────────────────────────
export type SortMode = "newest" | "longest" | "shortest";
export const SORT_LABELS: Record<SortMode, string> = {
  newest: "Newest first",
  longest: "Longest first",
  shortest: "Shortest first",
};

// ─── Date range (wave-91) ────────────────────────────────────
// Operator wants to look at calls beyond today. Quick chips for the
// most common windows + a custom range picker for everything else.
export type RangePreset = "today" | "7d" | "30d" | "custom";

export const RANGE_LABELS: Record<RangePreset, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  custom: "Custom",
};

export function rangeToISO(preset: RangePreset, customSince?: string, customUntil?: string): {
  sinceISO: string;
  untilISO?: string;
  shortLabel: string;
} {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  if (preset === "today") {
    return { sinceISO: startOfToday.toISOString(), shortLabel: "today" };
  }
  if (preset === "7d") {
    const since = new Date(now);
    since.setDate(since.getDate() - 7);
    since.setHours(0, 0, 0, 0);
    return { sinceISO: since.toISOString(), shortLabel: "last 7 days" };
  }
  if (preset === "30d") {
    const since = new Date(now);
    since.setDate(since.getDate() - 30);
    since.setHours(0, 0, 0, 0);
    return { sinceISO: since.toISOString(), shortLabel: "last 30 days" };
  }
  // custom — expect YYYY-MM-DD strings from <input type=date>
  const since = customSince ? new Date(customSince + "T00:00:00") : startOfToday;
  const until = customUntil ? new Date(customUntil + "T23:59:59.999") : now;
  return {
    sinceISO: since.toISOString(),
    untilISO: until.toISOString(),
    shortLabel:
      customSince && customUntil
        ? `${customSince} → ${customUntil}`
        : "custom range",
  };
}

export function defaultDateString(daysBack: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ─── Helpers ────────────────────────────────────────────────
export function fmtDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function fmtPhone(num: string | null): string {
  if (!num) return "Anonymous";
  // +12169264490 → (216) 926-4490
  const digits = num.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return num;
}

// wave-181.x Voice mobile polish · end-reason buckets compressed
// from 8 to 4 actionable categories (Forwarded · Nick closed ·
// Caller closed · Other). Per audit agent: carrier-hangup ·
// silence-timeout · max-duration · assistant-error are operator-
// noise · the operator doesn't act differently on them. Collapsing
// to "Other" makes the chart + filter chips scannable in 1 second.
// Future · if a specific subtype becomes actionable (e.g. silence-
// timeout indicates a Nick prompt regression), surface it then.
export const REASON_PRETTY: Record<string, { label: string; color: string }> = {
  "assistant-forwarded-call":   { label: "Forwarded",     color: "text-amber-400" },
  "assistant-ended-call":       { label: "Nick closed",   color: "text-emerald-400" },
  "customer-ended-call":        { label: "Caller closed", color: "text-blue-400" },
  // Everything else falls into "Other" via the prettyReason() fallback
  // below · the explicit entries below are noise-grade buckets that the
  // chart used to surface individually · now they all funnel to "Other".
  "assistant-error":            { label: "Other",         color: "text-foreground/40" },
  "phone-call-provider-closed-websocket": { label: "Other", color: "text-foreground/40" },
  "silence-timed-out":          { label: "Other",         color: "text-foreground/40" },
  "exceeded-max-duration":      { label: "Other",         color: "text-foreground/40" },
  unknown:                      { label: "Other",         color: "text-foreground/40" },
};

export function prettyReason(reason: string | null | undefined): { label: string; color: string } {
  // Null-safe: a call still in progress — or one VAPI never reported an
  // end reason for — has endedReason null/undefined. REASON_PRETTY[undefined]
  // is falsy, so the old `|| reason.replace(...)` branch crashed the whole
  // section with "Cannot read properties of undefined (reading 'replace')".
  if (!reason) return REASON_PRETTY.unknown;
  // Any reason not in the 8 explicit keys (rare VAPI additions) falls
  // through to the "Other" bucket via the unknown entry.
  return REASON_PRETTY[reason] ?? REASON_PRETTY.unknown;
}

export function maskPhone(num: string | null): string {
  if (!num) return "Anonymous";
  const digits = num.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ***-${digits.slice(7)}`;
  }
  return num.slice(0, -4) + "****";
}

export const OUTCOME_PRETTY: Record<string, { label: string; color: string; bg: string }> = {
  hard_conversion:            { label: "Hard Conversion",            color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  walk_in_directed:           { label: "Walk-In Directed",           color: "text-teal-400",    bg: "bg-teal-500/10 border-teal-500/20" },
  human_handoff:              { label: "Human Handoff",              color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20" },
  callback_needed:            { label: "Callback Needed",            color: "text-cyan-400",    bg: "bg-cyan-500/10 border-cyan-500/20" },
  tire_availability_intent:   { label: "Tire Stock Inquiry",         color: "text-indigo-400",  bg: "bg-indigo-500/10 border-indigo-500/20" },
  quote_or_inspection_intent: { label: "Quote Inquiry",              color: "text-purple-400",  bg: "bg-purple-500/10 border-purple-500/20" },
  resolved_info:              { label: "Resolved Info",              color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/20" },
  lost_opportunity:           { label: "Lost Opportunity",           color: "text-rose-400",    bg: "bg-rose-500/10 border-rose-500/20" },
  spam_or_wrong_number:       { label: "Spam / Wrong Number",        color: "text-foreground/30", bg: "bg-foreground/5 border-foreground/10" },
  abandoned_before_connect:   { label: "Abandoned Call",             color: "text-foreground/30", bg: "bg-foreground/5 border-foreground/10" },
  tech_failure:               { label: "Technical Failure",          color: "text-red-400",     bg: "bg-red-500/10 border-red-500/20" },
  unknown:                    { label: "Unknown",                    color: "text-foreground/45", bg: "bg-foreground/5 border-foreground/10" },
};

export function prettyOutcome(outcome: string | null | undefined): { label: string; color: string; bg: string } {
  if (!outcome) return OUTCOME_PRETTY.unknown;
  return OUTCOME_PRETTY[outcome] ?? { label: outcome.replace(/_/g, " "), color: "text-foreground/50", bg: "bg-foreground/5 border-foreground/10" };
}
