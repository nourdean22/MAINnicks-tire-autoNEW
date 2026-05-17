/**
 * SITUATION SYNTHESIZER — turns the 7 separate signal streams into
 * ONE coherent narrative.
 *
 * Before: the HQ rendered RuminationCard + TomorrowNoteCard +
 * ReflectNudge + MemoryCalibrationCard + BrainCarousel + BetDesk +
 * NarratorStrip as a stack of 7 cards all shouting "you're slipping"
 * in different voices. Nour called it out: stale, redundant, manual
 * STARTs, no synthesis.
 *
 * After: one <SituationCard> reads a single /api/ultron/situation
 * payload composed by this synthesizer. Inputs are the SAME streams
 * (signal, narrator, calibration pool, stale pins) but the output
 * is a ranked, deduplicated narrative with:
 *   • ONE headline (the top priority right now)
 *   • ONE primary action (tap to execute — or already ran automatically)
 *   • ambient monitors (5 dots — blind spot count, bet win rate, etc)
 *   • auto-resolved notes (what cron took care of overnight)
 *   • expanded breakdown (everything else, collapsed by default)
 *
 * No AI needed — the ranking + synthesis is deterministic. Venice
 * is only invoked (optionally) to generate the ONE-SENTENCE headline
 * and is skipped if the rule-based pick is already unique.
 */

export type SituationSource =
  | "blind_spot"
  | "bet"
  | "rumination"
  | "narrator"
  | "calibration"
  | "pin_hygiene"
  | "reflection"
  | "wisdom"
  | "ghost"
  | "momentum"
  // May 02 · v10.0.147 · two new ambient sources for the SignalZone:
  //   · forecast      — weekly digest of predictions made/resolved/hit-rate
  //                     (Nick's calibration over time, distinct from a
  //                      single "bet resolves soon" candidate)
  //   · brain_growth  — pulse of memories added 24h/7d so Nour sees the
  //                     learning loop is alive (silence = signal too)
  | "forecast"
  | "brain_growth"
  // v10.0.529.31 · Arc B Phase 4 · contradiction surface as a ranked
  // source in the unified narrative. The contradiction-surfacer
  // (lib/brain/contradiction-surfacer · apr 19) is essentially a
  // sub-type of blind_spot — Nour saying X today after saying NOT X
  // 3 weeks ago is a known-unknown about his own self-model. Lives
  // in the same urgency tier as rumination so it doesn't dethrone
  // the blind_spot detector but DOES rank above bets, calibration,
  // pin hygiene, narrator. Deduped via the "self_model" domain so
  // a contradiction + a narrator observation about the same shift
  // collapses into the higher-ranked one.
  | "contradiction"
  // v10.0.529.32 · Arc B Feature 4 · Ghost Nick persona-drift events.
  // Detected by lib/brain/persona-drift-detector · cosine drift > 0.4
  // between an assistant reply embedding and the 8-axis identity
  // snapshot. Same urgency tier as contradiction (rank 1) since both
  // signal self-model misalignment · contradiction is operator vs
  // operator-past, persona_drift is assistant-reply vs operator-stated.
  | "persona_drift";

export type SituationSeverity = "critical" | "high" | "medium" | "low" | "win";

/**
 * A candidate situation. Every input source produces one or more of
 * these; the synthesizer ranks + dedupes + picks the top.
 */
export interface SituationCandidate {
  source: SituationSource;
  severity: SituationSeverity;
  /** Headline — ≤ 80 chars, the single line Nour reads first */
  headline: string;
  /** Body — ≤ 200 chars, why this matters right now */
  body?: string;
  /** Primary action copy. Undefined if there's nothing to do. */
  actionLabel?: string;
  /** Action kind — tells the UI whether to deep-link or post a mutation */
  action?:
    | { kind: "navigate"; href: string }
    | { kind: "api"; method: "POST" | "PATCH"; path: string; payload?: Record<string, unknown>; successCopy?: string };
  /** Domain tag for deduping */
  domain?: string;
  /** Raw age in days used for freshness weighting */
  ageDays?: number;
  /**
   * Auto-resolved flag. If true, the synthesizer was able to take
   * care of this without Nour's input (e.g. cron re-verified a
   * belief). It still surfaces as a FYI but doesn't require action.
   */
  autoResolved?: boolean;
  /** Tokens that let us dedupe cross-source redundancy */
  dedupeTokens?: string[];
}

export interface AmbientMonitor {
  id: string;
  label: string;
  value: string | number;
  /** Green = healthy, gold = watchful, amber = warning, red = alert */
  tone: "win" | "neutral" | "watch" | "warn" | "alert";
  href?: string;
}

export interface SituationPayload {
  /** The ONE thing Nour should read first */
  primary: SituationCandidate | null;
  /** Up to 2 other items that didn't win but matter — shown only on expand */
  secondaries: SituationCandidate[];
  /** Stuff cron handled overnight — shown as one FYI line */
  autoResolved: SituationCandidate[];
  /** 3-5 ambient monitors rendered as tiny colored dots + label */
  monitors: AmbientMonitor[];
  /** Rolled-up counts for the expand drawer */
  counts: {
    blindSpots: number;
    activeBets: number;
    agingBeliefs: number;
    stalePins: number;
    openRuminations: number;
    reflectionsToday: number;
  };
  /** How many cards got collapsed vs what would have rendered before */
  noiseReduced: number;
  generatedAt: string;
}

const SEVERITY_RANK: Record<SituationSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  win: 4,
};

const SOURCE_RANK: Record<SituationSource, number> = {
  blind_spot: 0,
  bet: 2,
  rumination: 1,
  narrator: 3,
  calibration: 4,
  pin_hygiene: 4,
  reflection: 5,
  wisdom: 5,
  ghost: 2,
  momentum: 6,
  // Forecasting digest sits next to calibration — both are about
  // Nick's prediction quality. Brain-growth is a soft positive signal
  // (or silence-as-warning) so it ranks alongside wisdom/reflection.
  forecast: 4,
  brain_growth: 5,
  // Contradictions ranked 1 · tied with rumination as the
  // second-most-urgent source after blind_spot. A live self-model
  // drift (you flipped on a position) is at least as actionable as
  // an unresolved decision past its review date · arguably more so
  // because it indicates the operator's stated reality is not the
  // operator's current reality.
  contradiction: 1,
  // Ghost Nick persona drift · same tier as contradiction. Both
  // describe the gap between stated identity and current behavior ·
  // contradiction is the operator drifting from themselves,
  // persona_drift is Nick drifting from the operator's spec.
  persona_drift: 1,
};

/**
 * Rank: lower is more urgent. Severity is the primary driver; source
 * breaks ties. Age decays medium/low priority items so a month-old
 * "low-severity" blind-spot doesn't fight a fresh medium one.
 */
export function rankCandidate(c: SituationCandidate): number {
  const sev = SEVERITY_RANK[c.severity];
  const src = SOURCE_RANK[c.source];
  const ageDecay = c.ageDays && c.severity !== "critical" ? Math.min(c.ageDays / 30, 1) : 0;
  return sev * 10 + src + ageDecay;
}

/**
 * Dedup: two candidates are the same story if they share any dedupe
 * token AND the same domain. E.g., "blind_spot: stale leads" and
 * "narrator: you skipped customer outreach" both tag ["leads",
 * "outreach", "pipeline"] in the same domain. We keep the
 * higher-ranked one + stash the dropped into secondaries.
 */
export function dedupeCandidates(
  candidates: SituationCandidate[]
): { kept: SituationCandidate[]; dropped: SituationCandidate[] } {
  const kept: SituationCandidate[] = [];
  const dropped: SituationCandidate[] = [];
  const usedTokens = new Set<string>();

  const sorted = [...candidates].sort((a, b) => rankCandidate(a) - rankCandidate(b));

  for (const c of sorted) {
    const tokens = c.dedupeTokens || [];
    const overlap = tokens.some((t) => usedTokens.has(`${c.domain || "_"}::${t}`));
    if (overlap) {
      dropped.push(c);
      continue;
    }
    kept.push(c);
    for (const t of tokens) {
      usedTokens.add(`${c.domain || "_"}::${t}`);
    }
  }
  return { kept, dropped };
}

/**
 * Main synthesizer. Takes all inputs, returns the unified payload.
 *
 * Ambient monitors are computed from raw counts + pre-computed
 * rates. The synthesizer does NOT fetch data — callers (the API
 * route) pass in pre-fetched streams so this stays pure + testable.
 */
export function synthesizeSituation(inputs: {
  candidates: SituationCandidate[];
  autoResolved: SituationCandidate[];
  counts: SituationPayload["counts"];
  ambientRates?: {
    betHitRatePct?: number | null;
    predictionsPendingResolve?: number;
    pinInjectedOfCap?: { injected: number; cap: number };
    todayScore?: number | null;
    focusScore?: number | null;
  };
}): SituationPayload {
  const { kept, dropped } = dedupeCandidates(inputs.candidates);

  const primary = kept[0] || null;
  const secondaries = kept.slice(1, 3);

  const monitors: AmbientMonitor[] = [];

  monitors.push({
    id: "blind-spots",
    label: "watch",
    value: inputs.counts.blindSpots,
    tone:
      inputs.counts.blindSpots === 0
        ? "win"
        : inputs.counts.blindSpots >= 5
          ? "alert"
          : inputs.counts.blindSpots >= 3
            ? "warn"
            : "watch",
    href: "/brain",
  });

  if (inputs.ambientRates?.betHitRatePct !== undefined && inputs.ambientRates.betHitRatePct !== null) {
    const rate = inputs.ambientRates.betHitRatePct;
    monitors.push({
      id: "bet-hit",
      label: "bets",
      value: `${rate}%`,
      tone: rate >= 60 ? "win" : rate >= 40 ? "neutral" : rate >= 20 ? "watch" : "warn",
      href: "/brain",
    });
  }

  monitors.push({
    id: "aging-beliefs",
    label: "re-rule",
    value: inputs.counts.agingBeliefs,
    tone:
      inputs.counts.agingBeliefs === 0
        ? "win"
        : inputs.counts.agingBeliefs >= 5
          ? "warn"
          : "watch",
    href: "/brain#pinned-context",
  });

  monitors.push({
    id: "pins",
    label: "pinned",
    value: inputs.ambientRates?.pinInjectedOfCap
      ? `${inputs.ambientRates.pinInjectedOfCap.injected}/${inputs.ambientRates.pinInjectedOfCap.cap}`
      : inputs.counts.stalePins,
    tone: inputs.counts.stalePins === 0 ? "neutral" : inputs.counts.stalePins >= 3 ? "warn" : "watch",
    href: "/brain#pinned-context",
  });

  monitors.push({
    id: "reflections",
    label: "today",
    value: inputs.counts.reflectionsToday,
    tone: inputs.counts.reflectionsToday === 0 ? "watch" : "win",
    href: "/journal",
  });

  // Noise reduction = how many candidates got deduped away + the
  // old-stack always-rendered 7 surfaces. Gives Nour a number to
  // read the improvement: "12 → 1".
  const OLD_CARDS = 7;
  const noiseReduced = OLD_CARDS - (primary ? 1 : 0);

  return {
    primary,
    secondaries,
    autoResolved: inputs.autoResolved,
    monitors,
    counts: inputs.counts,
    noiseReduced: Math.max(0, noiseReduced + dropped.length),
    generatedAt: new Date().toISOString(),
  };
}
