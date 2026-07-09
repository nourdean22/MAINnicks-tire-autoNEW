/**
 * lib/ai/board/types.ts · multi-advisor board pattern (2026-05-23 · task #23).
 *
 * Companion to lib/ai/strategic-frameworks/ — but a DIFFERENT pattern.
 *
 *   strategic-frameworks · fuses ≤3 lenses into ONE Nick answer · the
 *   detector picks the best matches, the prompt block blends them.
 *   Loss · distinct perspectives disappear into a single voice.
 *
 *   board (this) · fans out to N advisors in PARALLEL · each keeps its
 *   lens distinct · a synthesizer pass surfaces consensus + divergence
 *   + tension WITHOUT collapsing the takes into mush.
 *   Win · the operator sees WHERE the lenses split, which is the
 *   highest-signal information.
 *
 * For tactical / daily decisions · Nick (strategic-frameworks) is the
 * right tool.
 * For major / multi-faceted strategic decisions · the board is the
 * right tool. Operator picks the surface.
 */

/** Stable pre-configured board identifiers. */
export type BoardId =
  | "strategic"
  | "invest"
  | "product"
  | "operator"
  | "full"
  | "team";

export interface Board {
  id: BoardId;
  /** Display name for the UI selector. */
  name: string;
  /** One-line description of when to use this board. */
  oneLiner: string;
  /**
   * Framework ids resolved against the strategic-frameworks REGISTRY
   * at consult time. Unknown ids are silently dropped (the board
   * still consults the resolvable members) — this lets boards stay
   * stable when individual frameworks evolve.
   */
  memberIds: string[];
}

/**
 * One advisor's structured take on the question. Distinct per
 * advisor — never blended with another's.
 */
export interface AdvisorTake {
  /** Framework id of the advisor that spoke. */
  advisorId: string;
  /** Display name (the framework's `name` field). */
  advisorName: string;
  /** One-sentence summary of what THIS lens sees here. */
  lensOneLine: string;
  /** 2-3 sentences of depth · what this lens reveals others might miss. */
  keyInsight: string;
  /** Concrete recommendation · "do X · don't do Y" with reasoning. */
  recommendation: string;
  /** Advisor's own confidence · 0-1 · drives synthesis weighting. */
  confidence: number;
  /**
   * If this advisor flagged that another typical board lens would
   * disagree, the name of that lens + brief reason. Helps the
   * synthesizer surface divergence the model already perceived.
   */
  divergenceFlag?: string;
  /** Provider that answered (venice / ollama / openai / anthropic / etc). */
  provider: string;
  /** Set when this advisor's aiChat errored — caller treats as degraded but not fatal. */
  error?: string;
}

/**
 * The synthesizer's pass over all advisor takes. Surfaces shape of
 * the board's collective view without flattening distinct perspectives.
 */
export interface BoardSynthesis {
  /** Bullets where most/all advisors converge. */
  consensus: string[];
  /**
   * Bullets where advisors diverge · each bullet names WHO disagreed
   * with WHO and WHY. e.g. "elon-musk says push +$50; warren-buffett
   * says hold for moat reasons."
   */
  divergences: string[];
  /**
   * If there's an axis that cleanly splits the board (short-term vs
   * long-term, simplicity vs completeness, risk vs reward), the
   * synthesizer names it here. Optional — many consultations have no
   * clean axis.
   */
  tension?: string;
  /**
   * Leaning recommendation · explicitly acknowledges which lenses get
   * overridden. Not a vote count — a judgment about which lens has
   * the most decision-quality grip on THIS specific question.
   */
  recommendation: string;
  /** 0-1 overall confidence · lower when the board is split, higher when convergent. */
  confidence: number;
}

/**
 * The complete consultation record · everything an operator needs to
 * understand the board's collective view, drill into a specific
 * advisor's take, or replay the consultation later.
 */
export interface BoardConsultation {
  boardId: BoardId;
  boardName: string;
  /** Verbatim operator question · what the board reasoned about. */
  question: string;
  /** One take per resolved board member · order matches Board.memberIds. */
  takes: AdvisorTake[];
  synthesis: BoardSynthesis;
  /** End-to-end ms (fan-out + synthesize). */
  durationMs: number;
  /** ISO timestamp the consultation completed · used as the brain-memory key suffix. */
  ranAt: string;
  /**
   * 2026-05-23 · Wave L · operator-state snapshot at consult time.
   * Null when state read failed OR confidence was 0 (cold-start ·
   * no signal yet · mood-blind fall-back). Lets the dashboard show
   * "this consult ran while mood=depleted · these advisors got gated."
   */
  operatorState: {
    mood: string;
    focus: number;
    capacity: number;
    drift: number;
    momentum: number;
    confidence: number;
  } | null;
  /**
   * 2026-05-23 · Wave L · advisor ids that the mood-gate dropped from
   * the consultation. Empty array when no gating ran (mood-blind OR
   * mood=energized/neutral OR gating would have emptied the board).
   * Persisted so the operator can replay consultations + see WHY a
   * particular advisor didn't show up.
   */
  droppedAdvisorIds: string[];
}
