/**
 * KNOWN-TRUTH GUARD — 2026-06-09.
 *
 * Guards Nick's REPLIES (not docs — the build-time stale-doc guard covers
 * those) against two fake-confidence failure modes:
 *
 *   1. STALE ACTIVE CLAIM — asserting a RETIRED fact as current
 *      ("statenour deploys to Vercel", "statenour-master is the prod
 *      branch", "push codex/ollama-local for prod"). Truth: statenour
 *      deploys via Railway from `main`; Vercel + codex/ollama-local are
 *      retired; `bdnick.info` is the prod surface.
 *
 *   2. EVIDENCE-FREE STATUS — claiming engineering work is DONE
 *      ("deployed", "tests passed", "build is green", "I verified")
 *      with no evidence in the sentence and not attributed to a report.
 *
 * Sentence-scoped + negation/reported/hedge aware so the SAFE forms pass:
 *   • "Vercel is retired"                       → safe (retired framing)
 *   • "the other session reports it deployed"   → safe (reported speech)
 *   • "I'll deploy once the build passes"        → safe (future/hedge)
 *   • "deployed — railway status SUCCESS, 220/220 tests" → safe (evidence)
 *
 * Pure · no DB · no repo reads · small static registry. Same input →
 * same flags. Caller decides what to do (surface a chip, fold into the
 * reply gate, log).
 */

export type TruthFlagKind = "stale_active_claim" | "evidence_free_status";

export interface TruthFlag {
  kind: TruthFlagKind;
  rule: string;
  snippet: string;
  severity: number; // 0-100
}

// ── Stale ACTIVE-claim rules (retired facts asserted as current) ──────
const STALE_RULES: Array<{ id: string; claim: RegExp }> = [
  { id: "vercel-deploy", claim: /\b(deploys?|deployed|deploying|hosted|hosts?|runs?|lives?|serving|served)\b[^.!?]{0,40}\bvercel\b/i },
  { id: "vercel-target", claim: /\bvercel\b[^.!?]{0,30}\b(deploy|deploys|host|hosts|production|prod|live)\b/i },
  { id: "statenour-master-prod", claim: /\bstatenour-master\b[^.!?]{0,40}\b(prod|production|main|current|deploy|branch)\b/i },
  { id: "standalone-os-prod", claim: /\b(standalone\s+)?statenour-os\b[^.!?]{0,40}\b(current |is the |the )?(prod|production|live|current)\b[^.!?]{0,20}\b(repo|app|build|branch|deploy)?\b/i },
  { id: "codex-ollama-prod", claim: /\b(codex|ollama-local)\b[^.!?]{0,30}\b(prod|production|deploy|for prod)\b|\bpush\b[^.!?]{0,20}\b(codex|ollama-local)\b/i },
];

// Framing that makes a STALE-rule hit SAFE (it's retired/historical/asking).
const SAFE_FRAMING =
  /\b(retired|deprecated|legacy|no longer|not\s+(?:anymore|any more|on)|used to|formerly|previously|was (the|our|on)|old (deploy|host|setup|stack)|migrated (away |off )?from|moved (away |off )?from|replaced|instead of|don'?t (deploy|use)|isn'?t|aren'?t|never)\b/i;

// ── Evidence-free engineering-status rules ───────────────────────────
// WP-18 (2026-07-29, audit-#10 keeper) added the ARTIFACT and BROWSER
// clauses: "the video has been created" and "I submitted the form" are
// the same fake-confidence failure as "tests passed" — a completion
// claim with no receipt in the sentence. The runtime pairs these flags
// with actual receipts (canClaimDone) before acting on them, so a claim
// WITH its artifact id in-sentence passes via EVIDENCE below.
const STATUS_CLAIM =
  /\b(deployed|re-?deployed|shipped|pushed to (prod|main)|merged (to|into) main|landed on (main|origin)|tests? (passed|are green|pass(?:ing)?)|build (is )?green|build (passed|succeeded)|migration (is )?(applied|live|done)|i verified|i confirmed|it'?s (deployed|live|shipped|done)|is now live|(video|image|reel|clip|report|pdf|file) (has been |was |is )?(created|generated|rendered|saved|exported)|i('ve| have)? (created|generated|rendered|exported) (the |a |your )?(video|image|reel|clip|report|pdf)|i (navigated to|clicked|filled (in|out)|logged in)|(i )?submitted the form)\b/i;

// Evidence markers — concrete proof in the same sentence.
const EVIDENCE =
  /\b(exit (code )?0|\d+\s*\/\s*\d+\s*(tests?|passing|green)|\d+ tests? (pass|passing|green)|commit\s+`?[0-9a-f]{7}|deployment\s+[0-9a-f-]{6}|status:?\s*SUCCESS|per the (log|output|build)|verified (via|live|on)|https?:\/\/|railway (status|build|deploy)|build log|i (saw|observed|ran|checked)|screenshot|information_schema|artifact (id|path)\b|receipt (id)?\s*[:#]|\.(mp4|png|jpg|webm|pdf)\b)\b/i;

// Reported speech — not Nick's own assertion.
const REPORTED =
  /\b(you (said|reported|told me|mentioned|wrote)|(the )?(other )?session (says|said|reports?|reported|claims?)|reportedly|according to|per (the|your|nour)|the (update|report|status) (says|said|states|claims)|claims to have|is said to|i'?m told|supposedly)\b/i;

// Hedge / future / conditional — not a done claim.
const HEDGE_FUTURE =
  /\b(should (be|deploy|pass)|will (be |deploy|pass|ship)|i'?ll|i will|going to|about to|once (it|the|that)|after (the|it|that)|if .{0,25}(passes|works|green|succeeds)|needs? to be|let'?s|we (should|can|need to|could)|plan to|ready to|hasn'?t (yet )?(deployed|shipped)|not (yet )?(deployed|shipped|live))\b/i;

function splitSentences(text: string): string[] {
  return text
    .split(/(?:(?<!\bi\.e\.)(?<!\be\.g\.)(?<=[.!?])\s+)|\n+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Scan an assistant reply for stale or evidence-free claims. Returns a
 * flag per offending sentence. Empty array = clean.
 */
export function checkKnownTruth(reply: string): TruthFlag[] {
  if (!reply || typeof reply !== "string") return [];
  const flags: TruthFlag[] = [];

  for (const sentence of splitSentences(reply)) {
    const safeFramed = SAFE_FRAMING.test(sentence);
    const reported = REPORTED.test(sentence);
    const hedged = HEDGE_FUTURE.test(sentence);

    // 1. Stale active claim — fire unless framed as retired/historical.
    if (!safeFramed && !reported) {
      for (const { id, claim } of STALE_RULES) {
        claim.lastIndex = 0;
        if (claim.test(sentence)) {
          flags.push({
            kind: "stale_active_claim",
            rule: id,
            snippet: sentence.slice(0, 160),
            severity: 80,
          });
          break; // one stale flag per sentence
        }
      }
    }

    // 2. Evidence-free status — fire unless evidenced, reported, or hedged.
    STATUS_CLAIM.lastIndex = 0;
    if (STATUS_CLAIM.test(sentence) && !EVIDENCE.test(sentence) && !reported && !hedged) {
      flags.push({
        kind: "evidence_free_status",
        rule: "status-without-evidence",
        snippet: sentence.slice(0, 160),
        severity: 55,
      });
    }
  }

  return flags;
}

/** One-line log summary. */
export function formatTruthSummary(flags: TruthFlag[]): string {
  if (flags.length === 0) return "truth: clean";
  const byKind = flags.reduce<Record<string, number>>((a, f) => {
    a[f.kind] = (a[f.kind] ?? 0) + 1;
    return a;
  }, {});
  return `truth: ${flags.length} flag(s) · ${Object.entries(byKind).map(([k, n]) => `${k}=${n}`).join(" ")}`;
}
