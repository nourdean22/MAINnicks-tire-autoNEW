import { prisma } from "@/lib/prisma";
import { specificityDensity, detectAntiNour, ANTI_NOUR } from "@/lib/ai/nour-voice-profile";
import type { OutputShape } from "@/lib/ai/turn-intelligence";

// ═════════════════════════════════════════════════════════════════════════════
// 1. Output Sanitizer (formerly lib/ai/output-sanitizer.ts)
// ═════════════════════════════════════════════════════════════════════════════

const LEAD_FILLER: RegExp[] = [
  /^certainly[!.,]?\s+/i,
  /^of course[!.,]?\s+/i,
  /^absolutely[!.,]?\s+/i,
  /^sure thing[!.,]?\s+/i,
  /^sure[!.,]?\s+/i,
  /^great question[!.,]?\s+/i,
  /^happy to help[!.,]?\s+/i,
  /^I'?d be happy to[^.]*[.,]?\s+/i,
  /^I'?ll (help|explain|walk you through)[^.]*[.,]?\s+/i,
  /^let me (help|explain|clarify)[^.]*[.,]?\s+/i,
  /^here'?s\s+(what|a|the)[^.]{0,80}\.\s*/i,
  /^as an ai[^.]*[.,]?\s+/i,
  /^as a (language model|chatbot)[^.]*[.,]?\s+/i,
];

const ANYWHERE_FILLER: Array<[RegExp, string]> = [
  [/\bi hope this helps[!.]?/gi, ""],
  [/\blet me know if you (need|have)[^.]{0,80}[!.]/gi, ""],
  [/\bfeel free to (ask|reach out)[^.]{0,80}[!.]/gi, ""],
  [/\bif you have any (other )?questions[^.]{0,80}[!.]/gi, ""],
  [/\bhappy to (help|clarify|dive deeper)[^.]{0,80}[!.]/gi, ""],
  [/\bi'?m here to help[!.]?/gi, ""],
  [/\bas an ai[,]?\s*/gi, ""],
  [/\bas a language model[,]?\s*/gi, ""],
  [/\bi don'?t have (real.?time|live) (access|data)[^.]{0,80}[.]?/gi, ""],
  [/\bit seems like[,]?\s+/gi, ""],
  [/\bit appears that\s+/gi, ""],
  [/\bi think (that )?/gi, ""],
  [/\bbased on (my )?(analysis|understanding)[,]?\s*/gi, ""],
  [/^however,?\s+/gim, ""],
  [/^additionally,?\s+/gim, ""],
  [/^furthermore,?\s+/gim, ""],
  [/^moreover,?\s+/gim, ""],
  [/^in conclusion,?\s+/gim, ""],
  [/^to summarize,?\s+/gim, ""],
  [/^in summary,?\s+/gim, ""],
  [/\bin (this|my) (response|answer|reply)[,]?\s*/gi, ""],
];

const WHITESPACE_FIXES: Array<[RegExp, string]> = [
  [/[ \t]+\n/g, "\n"],
  [/\n{3,}/g, "\n\n"],
  [/^[ \t]+/gm, ""],
  [/ {2,}/g, " "],
  [/\s+([.,!?;:])/g, "$1"],
  [/^\s+|\s+$/g, ""],
];

function stripXmlPseudoTemplate(text: string): string {
  let result = text;
  result = result.replace(
    /```\s*xml\s*\n?\s*<request>\s*\n?\s*<instruction>([\s\S]*?)<\/instruction>\s*\n?\s*<\/request>\s*\n?\s*```/gi,
    (_, inner: string) => inner.trim(),
  );
  result = result.replace(
    /<request>\s*\n?\s*<instruction>([\s\S]*?)<\/instruction>\s*\n?\s*<\/request>/gi,
    (_, inner: string) => inner.trim(),
  );
  result = result.replace(
    /<instruction>([\s\S]*?)<\/instruction>/gi,
    (_, inner: string) => inner.trim(),
  );
  return result;
}

export function sanitizeResponse(text: string): { cleaned: string; trimmed: number } {
  if (!text || typeof text !== "string") {
    return { cleaned: "", trimmed: 0 };
  }
  const original = text;
  let result = text;
  result = stripXmlPseudoTemplate(result);

  let keepStripping = true;
  while (keepStripping) {
    keepStripping = false;
    for (const pat of LEAD_FILLER) {
      if (pat.test(result)) {
        result = result.replace(pat, "");
        keepStripping = true;
        break;
      }
    }
  }

  for (const [pat, replacement] of ANYWHERE_FILLER) {
    result = result.replace(pat, replacement);
  }
  for (const [pat, replacement] of WHITESPACE_FIXES) {
    result = result.replace(pat, replacement);
  }

  return {
    cleaned: result,
    trimmed: Math.max(0, original.length - result.length),
  };
}

export function hasFiller(text: string): boolean {
  if (!text) return false;
  for (const pat of LEAD_FILLER) if (pat.test(text)) return true;
  for (const [pat] of ANYWHERE_FILLER) if (pat.test(text)) return true;
  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. Cliche Detector (formerly lib/ai/cliche-detector.ts)
// ═════════════════════════════════════════════════════════════════════════════

const CLICHES: RegExp[] = [
  /\bnavigating the (complex|complexities|landscape)\b/i,
  /\ba wealth of (information|knowledge|data|experience)\b/i,
  /\bat the end of the day\b/i,
  /\bwhen it comes to\b/i,
  /\bin today'?s (fast-paced|dynamic|competitive|digital) (world|landscape|environment|market)\b/i,
  /\bleverage (the|this|these|your)\b/i,
  /\bsynergy\b/i,
  /\bparadigm shift\b/i,
  /\bgame.?changer\b/i,
  /\blow.?hanging fruit\b/i,
  /\bmove the needle\b/i,
  /\bcircle back\b/i,
  /\bdeep dive\b/i,
  /\bboil (it|this|that) down\b/i,
  /\bunpack this\b/i,
  /\bthat being said\b/i,
  /\bwith that in mind\b/i,
  /\bkeep in mind (that)?\b/i,
  /\bit'?s worth (noting|mentioning)\b/i,
  /\bit goes without saying\b/i,
  /\bnot to mention\b/i,
  /\blast but not least\b/i,
  /\bplays? a (crucial|critical|vital|significant|important) role\b/i,
  /\bunderstanding the nuances\b/i,
  /\ba testament to\b/i,
  /\bthe intricacies of\b/i,
  /\btapestry of\b/i,
  /\bdelve into\b/i,
  /\brobust (solution|framework|approach|system)\b/i,
  /\bcutting.?edge\b/i,
  /\bstate.?of.?the.?art\b/i,
  /\bseamless (integration|experience|workflow)\b/i,
  /\bnumerous (ways|options|benefits|factors)\b/i,
  /\bvarious (ways|options|benefits|factors|types)\b/i,
  /\ba myriad of\b/i,
  /\ba plethora of\b/i,
  /\bit'?s important to (note|mention|remember|understand)\b/i,
  /\bit'?s crucial to\b/i,
  /\bit'?s essential to\b/i,
  /\bin today'?s ever.?changing\b/i,
  /\bunlock the (power|potential|secrets) of\b/i,
  /\bstreamline your (workflow|process|operations)\b/i,
];

export function detectCliches(text: string): { count: number; matches: string[] } {
  if (!text || typeof text !== "string") return { count: 0, matches: [] };
  const matches: string[] = [];
  for (const pat of CLICHES) {
    const m = text.match(pat);
    if (m) matches.push(m[0]);
  }
  return { count: matches.length, matches };
}

export function clicheDensity(text: string): number {
  const { count } = detectCliches(text);
  const words = text.trim().split(/\s+/).length;
  if (words === 0) return 0;
  return (count / words) * 100;
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. Output Critic (formerly lib/ai/output-critic.ts)
// ═════════════════════════════════════════════════════════════════════════════

export interface CriticScore {
  overall: number;              // 0-100
  specificity: number;          // 0-100
  cliche: number;               // 0-100
  antiNour: number;             // 0-100
  length: number;               // 0-100
  wordCount: number;
  reasons: string[];            // human-readable flags
  shouldRegen: boolean;         // true if overall < 55
  offenders: {                  // specific phrases caught for UI display
    cliches: string[];
    antiNour: string[];
  };
}

const SHAPE_LENGTH: Record<OutputShape, { min: number; max: number }> = {
  prose: { min: 15, max: 300 },
  email: { min: 40, max: 200 },
  sms: { min: 5, max: 40 },
  proposal: { min: 80, max: 300 },
  list: { min: 15, max: 150 },
  code: { min: 20, max: 400 },
  json: { min: 5, max: 300 },
  table: { min: 15, max: 150 },
  summary: { min: 30, max: 120 },
  none: { min: 2, max: 30 },
};

export function critiqueOutput(
  text: string,
  shape: OutputShape = "prose",
): CriticScore {
  const reasons: string[] = [];
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean).length;

  const specDensity = specificityDensity(trimmed);
  let specScore = 100;
  if (specDensity < 0.5) {
    specScore = 30;
    reasons.push(`spec-density low (${specDensity.toFixed(2)}/100w)`);
  } else if (specDensity < 1.0) {
    specScore = 60;
  } else if (specDensity < 2.0) {
    specScore = 80;
  }

  const clicheD = clicheDensity(trimmed);
  let clicheScore = 100;
  if (clicheD >= 2.0) {
    clicheScore = 20;
    reasons.push(`cliche density high (${clicheD.toFixed(2)}/100w)`);
  } else if (clicheD >= 1.0) {
    clicheScore = 55;
    reasons.push(`cliche density warn (${clicheD.toFixed(2)}/100w)`);
  } else if (clicheD >= 0.5) {
    clicheScore = 80;
  }
  const { matches: clicheMatches } = detectCliches(trimmed);

  const anti = detectAntiNour(trimmed);
  let antiScore = 100;
  if (anti.count >= 3) {
    antiScore = 20;
    reasons.push(`anti-voice hits ${anti.count} (${anti.matches.slice(0, 2).join(", ")})`);
  } else if (anti.count === 2) {
    antiScore = 55;
    reasons.push(`anti-voice hits 2 (${anti.matches.join(", ")})`);
  } else if (anti.count === 1) {
    antiScore = 80;
  }

  const range = SHAPE_LENGTH[shape] ?? SHAPE_LENGTH.prose;
  let lengthScore = 100;
  if (words < range.min * 0.5 || words > range.max * 1.8) {
    lengthScore = 30;
    reasons.push(`length off · shape=${shape} words=${words} want=${range.min}-${range.max}`);
  } else if (words < range.min * 0.7 || words > range.max * 1.4) {
    lengthScore = 60;
    reasons.push(`length warn · words=${words} want=${range.min}-${range.max}`);
  } else if (words < range.min || words > range.max) {
    lengthScore = 80;
  }

  const overall = Math.round(
    specScore * 0.35 + clicheScore * 0.25 + antiScore * 0.20 + lengthScore * 0.20,
  );

  const criticalAxisOffenders: string[] = [];
  if (specScore <= 30) criticalAxisOffenders.push("spec");
  if (clicheScore <= 20) criticalAxisOffenders.push("cliche");
  if (antiScore <= 20) criticalAxisOffenders.push("antiNour");
  if (lengthScore <= 30) criticalAxisOffenders.push("length");

  const hedgePatterns: Array<{ name: string; pat: RegExp }> = [
    { name: "cannot-provide", pat: /^(sorry,?\s+)?i\s+cannot\s+(provide|give|offer|access|retrieve|share)/i },
    { name: "unable-to", pat: /^(sorry,?\s+)?(i'?m\s+|i\s+am\s+)?unable\s+to/i },
    { name: "unfortunately", pat: /^unfortunately[,.]?\s+/i },
    { name: "no-real-time", pat: /\bi\s+(do\s+)?n[o']?t?\s+have\s+(access\s+to|the\s+ability\s+to|real[- ]time)\b/i },
    { name: "as-an-ai", pat: /\bas\s+an?\s+ai\s+(assistant|language\s+model|model)\b/i },
    { name: "cannot-perform-directly", pat: /\bcannot\s+perform\s+directly\b/i },
  ];
  const hedgeHits: string[] = [];
  const replyOpen = trimmed.slice(0, 200);
  for (const { name, pat } of hedgePatterns) {
    if (pat.test(replyOpen) || pat.test(trimmed.slice(0, 600))) {
      hedgeHits.push(name);
    }
  }
  if (hedgeHits.length > 0) {
    criticalAxisOffenders.push("hedge");
    reasons.push(`hedge-detected · ${hedgeHits.join(",")} · model refused / hedged instead of citing data`);
  }

  const overallFailed = overall < 55;
  if (criticalAxisOffenders.length > 0 && !overallFailed) {
    reasons.push(`axis-gate · ${criticalAxisOffenders.join(",")} alone fires regen`);
  }
  const shouldRegen = overallFailed || criticalAxisOffenders.length > 0;

  return {
    overall,
    specificity: specScore,
    cliche: clicheScore,
    antiNour: antiScore,
    length: lengthScore,
    wordCount: words,
    reasons,
    shouldRegen,
    offenders: {
      cliches: clicheMatches,
      antiNour: anti.matches,
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. Fact Check (formerly lib/ai/fact-check.ts)
// ═════════════════════════════════════════════════════════════════════════════

export interface FactClaim {
  raw: string;
  kind: "dollar" | "count" | "percent" | "date" | "time-window" | "name";
  value: string;
  start: number;
  end: number;
  verified: boolean;
}

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
  return s.toLowerCase().replace(/[,$\s]+/g, "").replace(/[.!?]/g, "");
}

export function factCheck(reply: string, brainContext: string): FactClaim[] {
  if (!reply || typeof reply !== "string") return [];

  const contextNormalized = normalize(brainContext);
  const claims: FactClaim[] = [];

  for (const { kind, re } of EXTRACTORS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(reply)) !== null) {
      const raw = m[0];
      const normalized = normalize(raw);
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

  const seen = new Set<string>();
  const unique: FactClaim[] = [];
  for (const c of claims) {
    const k = `${c.kind}:${c.raw}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(c);
  }

  return unique;
}

export function countUnverified(claims: FactClaim[]): number {
  return claims.filter((c) => !c.verified).length;
}

export function formatFactCheckSummary(claims: FactClaim[]): string {
  const total = claims.length;
  const unverified = countUnverified(claims);
  if (total === 0) return "facts: none";
  return `facts: ${total} total · ${total - unverified} verified · ${unverified} unverified`;
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. Hallucination Guard (formerly lib/ai/hallucination-guard.ts)
// ═════════════════════════════════════════════════════════════════════════════

interface ClaimPattern {
  pattern: RegExp;
  type: "revenue_today" | "lead_count" | "customer_count" | "task_count" | "score" | "customer_story";
  label: string;
}

const CLAIM_PATTERNS: ClaimPattern[] = [
  { pattern: /\btoday'?s\s+revenue\s+(?:is|=|at)\s+\$?([\d,]+)/i, type: "revenue_today", label: "today's revenue" },
  { pattern: /\bwe(?:'ve)?\s+(?:made|earned|booked)\s+\$?([\d,]+)\s+today\b/i, type: "revenue_today", label: "today's revenue" },
  { pattern: /\brevenue\s+(?:today|so\s+far)\s+(?:is|=|:)\s*\$?([\d,]+)/i, type: "revenue_today", label: "today's revenue" },
  { pattern: /\byou\s+have\s+(\d+)\s+(?:open|active|stale)?\s*leads?\b/i, type: "lead_count", label: "open leads" },
  { pattern: /\b(\d+)\s+(?:open|active|stale)\s+leads?\b/i, type: "lead_count", label: "open leads" },
  { pattern: /\b(\d+)\s+customers?\s+in\s+(?:the\s+)?(?:db|database|crm|system)/i, type: "customer_count", label: "customers in DB" },
  { pattern: /\byou\s+have\s+(\d+)\s+customers?\b/i, type: "customer_count", label: "customer count" },
  { pattern: /\byou\s+have\s+(\d+)\s+(?:open|active)?\s*tasks?\b/i, type: "task_count", label: "open tasks" },
  { pattern: /\b(\d+)\s+(?:open|active)\s+tasks?\b/i, type: "task_count", label: "open tasks" },
  { pattern: /\b(?:your|today'?s)\s+score\s+(?:is|=)\s*(\d+)\s*\/\s*100/i, type: "score", label: "daily score" },
];

export interface ExtractedClaim {
  type: ClaimPattern["type"];
  label: string;
  rawMatch: string;
  claimedValue: number;
  index: number;
}

export interface FactCheckResult {
  claim: ExtractedClaim;
  actualValue: number | null;
  verdict: "match" | "off" | "way_off" | "unverifiable";
  errorPct: number | null;
}

export function extractClaims(text: string): ExtractedClaim[] {
  if (!text) return [];
  const claims: ExtractedClaim[] = [];
  for (const cp of CLAIM_PATTERNS) {
    const re = new RegExp(cp.pattern.source, cp.pattern.flags);
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

async function getActual(type: ClaimPattern["type"]): Promise<number | null> {
  try {
    switch (type) {
      case "revenue_today": {
        try {
          const { queryNickBatch } = await import("@/lib/nickstire/query");
          const data = await queryNickBatch([{ query: "revenue_today" }]);
          const rev = (data.revenue_today as { data?: { totalDollars?: number } })?.data;
          if (typeof rev?.totalDollars === "number") return rev.totalDollars;
        } catch {}
        return null;
      }
      case "lead_count": {
        try {
          const { queryNickBatch } = await import("@/lib/nickstire/query");
          const data = await queryNickBatch([{ query: "leads_urgent" }]);
          const leads = (data.leads_urgent as { data?: { count?: number } })?.data;
          if (typeof leads?.count === "number") return leads.count;
        } catch {}
        return null;
      }
      case "customer_count":
        return null;
      case "task_count": {
        const count = await prisma.task.count({
          where: { status: { in: ["INBOX", "READY", "DOING", "WAITING"] } },
        });
        return count;
      }
      case "score": {
        const row = await prisma.brainMemory.findFirst({
          where: { category: "daily_score", deletedAt: null },
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
    console.warn(`[hallucination-guard] verify ${type} failed:`, err);
    return null;
  }
}

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

export function formatClaimWarnings(results: FactCheckResult[]): string {
  const flagged = results.filter((r) => r.verdict === "off" || r.verdict === "way_off");
  if (flagged.length === 0) return "";
  const lines = flagged.map((r) => {
    const errPct = r.errorPct !== null ? `${(r.errorPct * 100).toFixed(0)}% off` : "off";
    return `  · ${r.claim.label}: claim **${r.claim.claimedValue}** vs actual **${r.actualValue}** (${errPct})`;
  });
  return `\n\n⚠️ **Fact-check flag${flagged.length === 1 ? "" : "s"}** (auto-verified against DB):\n${lines.join("\n")}\n_If this is wrong, the model hallucinated. Regenerate or verify directly._`;
}

// ═════════════════════════════════════════════════════════════════════════════
// Unified Consolidated Entrance
// ═════════════════════════════════════════════════════════════════════════════

export interface GuardianResult {
  cleanedText: string;
  trimmedChars: number;
  criticScore: CriticScore;
  factClaims: FactClaim[];
  hallucinations: FactCheckResult[];
}

export async function verifyAndCleanOutput(
  rawText: string,
  options: {
    shape?: OutputShape;
    brainContext?: string;
    checkDbClaims?: boolean;
  } = {}
): Promise<GuardianResult> {
  const { cleaned, trimmed } = sanitizeResponse(rawText);
  const criticScore = critiqueOutput(cleaned, options.shape || "prose");
  const factClaims = options.brainContext ? factCheck(cleaned, options.brainContext) : [];
  const hallucinations = options.checkDbClaims ? await checkClaims(cleaned) : [];

  return {
    cleanedText: cleaned,
    trimmedChars: trimmed,
    criticScore,
    factClaims,
    hallucinations,
  };
}

export function formatCriticSummary(score: CriticScore): string {
  const bits = [
    `overall=${score.overall}`,
    `spec=${score.specificity}`,
    `cliche=${score.cliche}`,
    `antiNour=${score.antiNour}`,
    `len=${score.length}`,
    `words=${score.wordCount}`,
  ];
  if (score.reasons.length > 0) {
    bits.push(`reasons=[${score.reasons.join(" · ")}]`);
  }
  if (score.shouldRegen) bits.push("REGEN_CANDIDATE");
  return bits.join(" ");
}

export { ANTI_NOUR };

const CTA_KEYWORDS = [
  "call ", "book", "stop in", "tap ", "schedule",
  "dm us", "message", "swing by", "drop by", "today",
  "this week", "right now", "before sunday", "before friday",
  "limited spots", "first come first served", "fcfs", "first-come",
];

const CLEVELAND_HASHTAGS = new Set([
  "#cleveland", "#cle", "#clevelandohio", "#thelandcle",
  "#216", "#cleproud", "#downtowncle", "#westside", "#eastside",
]);

const SERVICE_HASHTAGS = new Set([
  "#tires", "#tireshop", "#mechanic", "#autorepair", "#brakes",
  "#oilchange", "#alignment", "#diagnostics", "#carcare", "#fleet",
  "#truckrepair", "#carmaintenance", "#nickstire", "#nickstireandauto",
]);

export interface ContentCriticScore extends CriticScore {
  brandElement: number;       // 0-100 · Nick's Tire / Cleveland mention
  cta: number;                // 0-100 · CTA present in last 25%
  hashtagQuality: number;     // 0-100 · ≥3 real hashtags
  /** Final 7-axis weighted average — replaces .overall when content scoring */
  contentOverall: number;
}

export function critiqueContent(
  text: string,
  shape: OutputShape = "prose",
): ContentCriticScore {
  const base = critiqueOutput(text, shape);
  const t = text.toLowerCase();
  const reasons = [...base.reasons];

  const hasNickName = /\bnick'?s\s+tire/i.test(text);
  const hasCleveland = /\bcleveland\b|\bcle\b|\b216\b/i.test(text);
  let brandScore = 100;
  if (!hasNickName && !hasCleveland) {
    brandScore = 25;
    reasons.push("brand-element missing — no Nick's Tire / Cleveland mention");
  } else if (!hasNickName) {
    brandScore = 65;
    reasons.push("brand-element partial — Cleveland but no Nick's Tire");
  } else if (!hasCleveland) {
    brandScore = 80;
  }

  const lastQuarterStart = Math.floor(text.length * 0.75);
  const lastQuarter = text.slice(lastQuarterStart).toLowerCase();
  const hasCTA = CTA_KEYWORDS.some((kw) => lastQuarter.includes(kw));
  const ctaAnywhere = CTA_KEYWORDS.some((kw) => t.includes(kw));
  let ctaScore = 100;
  if (!ctaAnywhere) {
    ctaScore = 20;
    reasons.push("CTA missing — no call-to-action verb anywhere");
  } else if (!hasCTA) {
    ctaScore = 60;
    reasons.push("CTA buried — call-to-action exists but not in last 25%");
  }

  const hashtags = text.match(/#[A-Za-z][\w]+/g) ?? [];
  const realTags = hashtags.filter(
    (h) => CLEVELAND_HASHTAGS.has(h.toLowerCase()) || SERVICE_HASHTAGS.has(h.toLowerCase()),
  );
  let hashtagScore = 100;
  if (hashtags.length === 0) {
    if (shape === "prose" && hasNickName) {
      hashtagScore = 70;
    }
  } else if (realTags.length === 0) {
    hashtagScore = 30;
    reasons.push(`hashtag-quality low — ${hashtags.length} tags, none Cleveland/service`);
  } else if (realTags.length < 3) {
    hashtagScore = 60;
    reasons.push(`hashtag-quality warn — only ${realTags.length} of ${hashtags.length} are real`);
  }

  const contentOverall = Math.round(
    base.specificity * 0.25 +
    base.cliche * 0.15 +
    base.antiNour * 0.12 +
    base.length * 0.10 +
    brandScore * 0.15 +
    ctaScore * 0.13 +
    hashtagScore * 0.10,
  );

  return {
    ...base,
    reasons,
    contentOverall,
    brandElement: brandScore,
    cta: ctaScore,
    hashtagQuality: hashtagScore,
    shouldRegen: contentOverall < 60,
  };
}
