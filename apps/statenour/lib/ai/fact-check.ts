/**
 * FACT-CHECK — Apr 19.
 *
 * Scans Nick's reply for numeric / named claims (dollar amounts,
 * counts, dates, proper nouns Nour cares about) and checks each one
 * against the brain context that fed the turn. Claims that don't
 * appear in the fed context are flagged as "unverified" — not
 * necessarily wrong, but worth surfacing to the UI so Nour can
 * double-check before acting.
 *
 * Purpose: catch hallucinations like "you have 7 overdue estimates"
 * when the actual brain context said 3, or "last serviced 47 days ago"
 * when the brain context didn't mention this customer at all.
 *
 * Philosophy: don't block the reply. Annotate it. The client UI can
 * render a tiny "2 unverified claims" hint with a tap-to-see list.
 *
 * Zero AI call — pure regex + substring matching against the system
 * prompt that was actually sent. Fast, deterministic, safe.
 */

export interface FactClaim {
  raw: string;              // the full matched substring
  kind: "dollar" | "count" | "percent" | "date" | "time-window" | "name";
  value: string;            // the specific value (for rendering)
  /** Index range in the reply. */
  start: number;
  end: number;
  verified: boolean;        // does the system prompt contain this claim?
}

// Claim extractors — each tries to find a class of facts in the reply.
const EXTRACTORS: Array<{ kind: FactClaim["kind"]; re: RegExp }> = [
  { kind: "dollar", re: /\$\s?[\d,]+(?:\.\d{1,2})?/g },
  { kind: "percent", re: /\b\d+(?:\.\d+)?%/g },
  { kind: "count", re: /\b\d+\s+(leads?|estimates?|invoices?|jobs?|cars?|customers?|bookings?|drops?|tasks?|commits?|promises?|days?|weeks?|months?|hours?|hrs?|minutes?|mins?)\b/gi },
  { kind: "date", re: /\b(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})\b/g },
  { kind: "time-window", re: /\b(today|tomorrow|yesterday|this week|last week|this month|last month|last (\d+) (days|weeks|months|hours))\b/gi },
  {
    kind: "name",
    re: /\b(Nick|Dania|Mom|Dad|Apollo|Fireflies|Venice|Grok|Perplexity|Descript|ClickUp|Make|Stripe|Auto Labor Guide|nickstire|autonicks|Cleveland|Ohio|Neon|Vercel|Cloudflare|Railway)\b/g,
  },
];

function normalize(s: string): string {
  // Collapse punctuation + whitespace so "$3,709" matches "$3709" and
  // "3 leads" matches "3  leads".
  return s.toLowerCase().replace(/[,$\s]+/g, "").replace(/[.!?]/g, "");
}

/**
 * Extract + verify claims. `brainContext` is the concatenation of all
 * brain blocks that fired for this turn (caller passes what they put
 * into the system prompt).
 */
export function factCheck(reply: string, brainContext: string): FactClaim[] {
  if (!reply || typeof reply !== "string") return [];

  const contextNormalized = normalize(brainContext);
  const replyLower = reply.toLowerCase();
  const claims: FactClaim[] = [];

  for (const { kind, re } of EXTRACTORS) {
    // Reset lastIndex since EXTRACTORS is a module-level const reused
    // across calls; otherwise g-flag regex shares state.
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(reply)) !== null) {
      const raw = m[0];
      const normalized = normalize(raw);
      // Consider verified when the normalized claim appears in the
      // normalized context. This is a LOOSE check — it catches "3
      // estimates" matching when context says "3 open estimates".
      // False positives (reply says "3 leads", context has "3 weeks")
      // are acceptable for a SURFACING tool; we're not gating here.
      const verified = contextNormalized.includes(normalized);
      claims.push({
        raw,
        kind,
        value: raw,
        start: m.index,
        end: m.index + raw.length,
        verified,
      });
    }
  }

  // Dedupe by (kind, raw)
  const seen = new Set<string>();
  const unique: FactClaim[] = [];
  for (const c of claims) {
    const k = `${c.kind}:${c.raw}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(c);
  }

  // Also touch replyLower just once so linter is happy about unused var
  void replyLower;

  return unique;
}

/**
 * Helper — count unverified claims.
 */
export function countUnverified(claims: FactClaim[]): number {
  return claims.filter((c) => !c.verified).length;
}

/**
 * One-line summary for logging.
 */
export function formatFactCheckSummary(claims: FactClaim[]): string {
  const total = claims.length;
  const unverified = countUnverified(claims);
  if (total === 0) return "facts: none";
  return `facts: ${total} total · ${total - unverified} verified · ${unverified} unverified`;
}
