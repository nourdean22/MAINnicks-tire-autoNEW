/**
 * v9.2 · Behavioral pattern hypotheses · Layer 1.5.
 *
 * The "5 causation chains" from v1 lived in the same flat block as
 * live data and carried specific numbers ("3+ missed workouts →
 * revenue dip in 5d", "each hour unanswered = -15% conversion") that
 * weren't sourced from any actual measurement. Nick read those as
 * facts and cited them as facts.
 *
 * v9.2 keeps the patterns (they're real observations Nour has
 * surfaced over time) but reframes them as **hypotheses to test**:
 *
 *   · No specific numbers. The pattern is the lesson; the magnitude
 *     is whatever the data shows on a given day.
 *   · Explicit "hypothesis not measurement" framing.
 *   · Prompt instructs Nick to ground claims in queryable data
 *     before quoting magnitudes.
 *
 * If a pattern gets validated by a real correlation_finder run, the
 * actual measured magnitude shows up in the live data section
 * (renderer.ts) keyed off `BrainMemory category="correlation"` rows.
 * Then Nick can cite real numbers because they came from a real
 * query — not from a hardcoded prior.
 */

export function buildInferredPatternsBlock(): string {
  return [
    "## Behavioral patterns · hypotheses, not measurements",
    "",
    "These are observations Nour has surfaced over time — directional, not quantified. Treat them as **hypotheses to test against live data**, not as facts to cite.",
    "",
    "When a question touches one of these, ground the answer in actual queries: pull recent identity-snapshot scores, today's revenue, callback timing, etc. **Never** quote magnitudes (no \"X-percent drop\" claims, no \"X-day lag\" claims) unless those numbers came from a query you just ran in this turn. If you don't have a measurement, say \"directionally\" or \"the pattern suggests\" — don't manufacture precision.",
    "",
    "The patterns:",
    "",
    "- **Body → Business**: stretches without workouts seem to precede revenue softness. If both signals are present, surface the connection — don't pretend they're independent. Pull recent body-tracking and revenue numbers before quantifying.",
    "- **Sleep → Decisions**: tired decisions feel worse in retrospect. High-stakes calls after poor sleep deserve a flag. Check the most recent body-tracking sleep entries before claiming the lag is X days.",
    "- **Callbacks → Revenue**: response time to leads matters; the longer the gap, the lower the close rate. The actual slope is shop-specific — query the bridge before quoting any conversion-per-hour number.",
    "- **Adderall → Deep work**: peak focus window after a dose, then tail-off. The MIT belongs in the peak window. Don't claim specific minutes-after-dose numbers as if measured for Nour — that's pharmacology generalized.",
    "- **Boredom → Drift**: \"I want to try something new\" often signals phase-1 drift. The counter is \"run what you have first.\" Surface this when the language pattern shows up.",
    "",
    "Other patterns may emerge in the live `correlation_alert` brain memories. If a measured correlation is available in this turn's context, prefer it over the hypothesis text above.",
  ].join("\n");
}
