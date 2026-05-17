/**
 * HALLUCINATION GUARD — fact-check AI claims against real data.
 *
 * v7 · BATCH 1C · Apr 28. Post-stream pass that scans Nick's reply for
 * specific factual CLAIMS about Nick's data (revenue, leads, customers,
 * tasks, scores) and verifies them against the actual DB. Flags
 * mismatches inline so Nour sees what's wrong before acting on it.
 *
 * v9.1.13 · STATUS: code-review surfaced this as DEFERRED-WIRED. The
 * implementation is real but the chat route does not call it by
 * default. Set `NICK_HALLUCINATION_GUARD=1` to enable in dev/staging
 * and let it run alongside the lighter `fact-check.ts` (which only
 * checks substring presence in the fed prompt context). The two are
 * complementary: fact-check is cheap (regex + indexOf), this one is
 * heavier (live DB query per claim) but more honest. Once it's been
 * shadow-evaluated for a week, flip the default.
 *
 * Scope (v1):
 *   · Revenue claims: "today's revenue is $X" / "we've made $Y this week"
 *   · Lead-count claims: "you have N leads" / "5 stale leads"
 *   · Customer-count claims: "X customers in DB"
 *   · Task-count claims: "you have N open tasks"
 *   · Score claims: "your score is X/100"
 *   · Customer name + service claims: "S. brought in a 2014 Camry for brakes"
 *
 * Architecture:
 *   1. Extract claims via regex pattern bank (one regex per claim type)
 *   2. For each claim, query the actual DB via existing query helpers
 *   3. Compare — if ±10% off, flag as suspect
 *   4. Return list of flagged claims for the chat route to render
 *
 * Output rendered as:
 *   ⚠️ Fact-check: claim "today's revenue is $850" — actual: $720 (15% off)
 *
 * Doesn't BLOCK the reply — just flags. Nour decides whether to retry.
 */

import { prisma } from "@/lib/prisma";

interface ClaimPattern {
  /** Regex extracts (label, value) groups */
  pattern: RegExp;
  /** Claim type for routing to the right verifier */
  type: "revenue_today" | "lead_count" | "customer_count" | "task_count" | "score" | "customer_story";
  /** Human label for the flag */
  label: string;
}

const CLAIM_PATTERNS: ClaimPattern[] = [
  // Revenue claims
  { pattern: /\btoday'?s\s+revenue\s+(?:is|=|at)\s+\$?([\d,]+)/i, type: "revenue_today", label: "today's revenue" },
  { pattern: /\bwe(?:'ve)?\s+(?:made|earned|booked)\s+\$?([\d,]+)\s+today\b/i, type: "revenue_today", label: "today's revenue" },
  { pattern: /\brevenue\s+(?:today|so\s+far)\s+(?:is|=|:)\s*\$?([\d,]+)/i, type: "revenue_today", label: "today's revenue" },
  // Lead count
  { pattern: /\byou\s+have\s+(\d+)\s+(?:open|active|stale)?\s*leads?\b/i, type: "lead_count", label: "open leads" },
  { pattern: /\b(\d+)\s+(?:open|active|stale)\s+leads?\b/i, type: "lead_count", label: "open leads" },
  // Customer count
  { pattern: /\b(\d+)\s+customers?\s+in\s+(?:the\s+)?(?:db|database|crm|system)/i, type: "customer_count", label: "customers in DB" },
  { pattern: /\byou\s+have\s+(\d+)\s+customers?\b/i, type: "customer_count", label: "customer count" },
  // Task count
  { pattern: /\byou\s+have\s+(\d+)\s+(?:open|active)?\s*tasks?\b/i, type: "task_count", label: "open tasks" },
  { pattern: /\b(\d+)\s+(?:open|active)\s+tasks?\b/i, type: "task_count", label: "open tasks" },
  // Score
  { pattern: /\b(?:your|today'?s)\s+score\s+(?:is|=)\s*(\d+)\s*\/\s*100/i, type: "score", label: "daily score" },
];

export interface ExtractedClaim {
  type: ClaimPattern["type"];
  label: string;
  rawMatch: string;
  /** Numeric value extracted from the claim */
  claimedValue: number;
  /** Where in the text it appeared (for surfacing) */
  index: number;
}

export interface FactCheckResult {
  claim: ExtractedClaim;
  /** Actual value from DB (null = couldn't verify) */
  actualValue: number | null;
  /** Verdict */
  verdict: "match" | "off" | "way_off" | "unverifiable";
  /** Difference as % of claimed */
  errorPct: number | null;
}

// ─────────────────────────────────────────────────────────────────────
// EXTRACT
// ─────────────────────────────────────────────────────────────────────

export function extractClaims(text: string): ExtractedClaim[] {
  if (!text) return [];
  const claims: ExtractedClaim[] = [];
  for (const cp of CLAIM_PATTERNS) {
    const re = new RegExp(cp.pattern.source, cp.pattern.flags); // fresh instance — avoids lastIndex issues
    const m = re.exec(text);
    if (m && m[1]) {
      const cleaned = m[1].replace(/,/g, "");
      const claimedValue = parseFloat(cleaned);
      if (!isNaN(claimedValue)) {
        claims.push({
          type: cp.type,
          label: cp.label,
          rawMatch: m[0],
          claimedValue,
          index: m.index,
        });
      }
    }
  }
  return claims;
}

// ─────────────────────────────────────────────────────────────────────
// VERIFY against the DB
// ─────────────────────────────────────────────────────────────────────

async function getActual(type: ClaimPattern["type"]): Promise<number | null> {
  try {
    switch (type) {
      case "revenue_today": {
        // Try the nickstire query bridge first — it's the canonical source
        try {
          const { queryNickBatch } = await import("@/lib/nickstire/query");
          const data = await queryNickBatch([{ query: "revenue_today" }]);
          const rev = (data.revenue_today as { data?: { totalDollars?: number } })?.data;
          if (typeof rev?.totalDollars === "number") return rev.totalDollars;
        } catch {
          // bridge unavailable — fall through to local count of approximations
        }
        return null;
      }
      case "lead_count": {
        // No local Lead table on statenour — bridge to nickstire
        try {
          const { queryNickBatch } = await import("@/lib/nickstire/query");
          const data = await queryNickBatch([{ query: "leads_urgent" }]);
          const leads = (data.leads_urgent as { data?: { count?: number } })?.data;
          if (typeof leads?.count === "number") return leads.count;
        } catch {
          // unavailable
        }
        return null;
      }
      case "customer_count":
        // No local Customer table — bridge to nickstire (or skip)
        return null;
      case "task_count": {
        const count = await prisma.task.count({
          where: { status: { in: ["INBOX", "READY", "DOING", "WAITING"] } },
        });
        return count;
      }
      case "score": {
        // brain_memory category=daily_score
        const row = await prisma.brainMemory.findFirst({
          where: { category: "daily_score", deletedAt: null }, // v10.0.66 · grounding signal
          orderBy: { createdAt: "desc" },
          select: { metadata: true },
        });
        const meta = row?.metadata as { score?: number } | null;
        if (typeof meta?.score === "number") return meta.score;
        return null;
      }
      default:
        return null;
    }
  } catch (err) {
    console.warn(
      `[hallucination-guard] verify ${type} failed:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// MAIN — scan text, return flagged claims
// ─────────────────────────────────────────────────────────────────────

export async function checkClaims(text: string): Promise<FactCheckResult[]> {
  const claims = extractClaims(text);
  if (claims.length === 0) return [];

  const results: FactCheckResult[] = [];
  for (const claim of claims) {
    const actual = await getActual(claim.type);
    if (actual === null) {
      results.push({ claim, actualValue: null, verdict: "unverifiable", errorPct: null });
      continue;
    }
    if (actual === 0 && claim.claimedValue === 0) {
      results.push({ claim, actualValue: actual, verdict: "match", errorPct: 0 });
      continue;
    }
    const denom = Math.max(actual, claim.claimedValue, 1);
    const errorPct = Math.abs(claim.claimedValue - actual) / denom;
    let verdict: FactCheckResult["verdict"];
    if (errorPct <= 0.05) verdict = "match";
    else if (errorPct <= 0.2) verdict = "off";
    else verdict = "way_off";
    results.push({ claim, actualValue: actual, verdict, errorPct });
  }
  return results;
}

/**
 * Format flagged claims as a markdown block to append to the assistant
 * reply (or surface as a separate UI hint).
 */
export function formatClaimWarnings(results: FactCheckResult[]): string {
  const flagged = results.filter((r) => r.verdict === "off" || r.verdict === "way_off");
  if (flagged.length === 0) return "";
  const lines = flagged.map((r) => {
    const errPct = r.errorPct !== null ? `${(r.errorPct * 100).toFixed(0)}% off` : "off";
    return `  · ${r.claim.label}: claim **${r.claim.claimedValue}** vs actual **${r.actualValue}** (${errPct})`;
  });
  return `\n\n⚠️ **Fact-check flag${flagged.length === 1 ? "" : "s"}** (auto-verified against DB):\n${lines.join("\n")}\n_If this is wrong, the model hallucinated. Regenerate or verify directly._`;
}
