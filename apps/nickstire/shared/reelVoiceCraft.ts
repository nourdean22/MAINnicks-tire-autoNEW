/**
 * A narrator, not a text-to-speech call.
 *
 * TWO THINGS SEPARATE A NARRATOR FROM A WAV FILE.
 *
 * 1. CONSISTENT PRONUNCIATION. A voice that says "Cuyahoga" one way in episode
 *    3 and another way in episode 17 is not a person; it is a service. Every
 *    term below is either a local place name a Cleveland driver would notice
 *    instantly, or an automotive term a shop is supposed to know how to say.
 *    Getting "Euclid" wrong in a Euclid Ave shop's own reel is the single most
 *    expensive mispronunciation available to this account.
 *
 * 2. SELECTION. One generation is a roll of the dice. Several generations,
 *    scored and chosen, is a performance. The scoring dimensions here are the
 *    ones that actually ruin a take: wrong length, clipping, digital
 *    artifacts, a pause where no pause belongs, and a flat monotone read.
 *
 * PURE ON PURPOSE. Nothing here calls a TTS provider or touches audio. It takes
 * measurements someone else produced and decides what to ask for and what to
 * keep, so the judgement is testable without spending a generation.
 */

export interface LexiconEntry {
  /** The term as it appears in a script. */
  term: string;
  /** Plain-English direction a TTS model can follow. */
  say: string;
  why: string;
}

/**
 * Terms this account cannot afford to get wrong. Local names first, because a
 * customer notices those; the technical ones follow.
 */
export const PRONUNCIATION_LEXICON: readonly LexiconEntry[] = [
  { term: "Euclid", say: "YOO-klid", why: "the shop's own street and city; a wrong read discredits everything after it" },
  { term: "Cuyahoga", say: "kye-uh-HOG-uh", why: "the county name; locals hear an outsider immediately" },
  { term: "E-Check", say: "EE check", why: "Ohio's emissions program, said as a letter then a word — never 'echeck'" },
  { term: "TPMS", say: "T-P-M-S, spelled out", why: "an initialism; reading it as a word sounds like a machine" },
  { term: "OBD-II", say: "O-B-D two", why: "letters then the numeral, never 'obd eye eye'" },
  { term: "camber", say: "KAM-ber", why: "alignment term; a shop that fumbles it sounds unqualified" },
  { term: "caster", say: "KAS-ter", why: "alignment term, often confused with castor" },
  { term: "CV axle", say: "C-V axle", why: "letters, not 'civ'" },
  { term: "Lorain", say: "luh-RAYN", why: "county and road name; commonly mispronounced by non-locals" },
  { term: "Bedford", say: "BED-ferd", why: "local city in the service area" },
];

/** Lexicon entries whose term actually appears in this script. */
export function relevantLexicon(script: string): LexiconEntry[] {
  const hay = String(script ?? "").toLowerCase();
  return PRONUNCIATION_LEXICON.filter((e) => hay.includes(e.term.toLowerCase()));
}

/**
 * Pronunciation direction for the terms in THIS script.
 *
 * Scoped rather than global: handing a model ten pronunciations it will never
 * use invites it to reach for them, and a narrator who says "Cuyahoga" in a
 * reel about brake pads is worse than one who never mentions it.
 */
export function pronunciationDirective(script: string): string {
  const rel = relevantLexicon(script);
  if (!rel.length) return "";
  return (
    "Pronounce these exactly as written: " +
    rel.map((e) => `${e.term} = "${e.say}"`).join("; ") +
    "."
  );
}

/* ── take selection ──────────────────────────────────────────────────────── */

/** Measurements taken from a rendered take. Produced elsewhere; judged here. */
export interface TakeMetrics {
  takeId: string;
  durationSec: number;
  /** What the edit needs this line to be. */
  targetSec: number;
  /** Peak level in dBFS. Above -1 is effectively clipped. */
  peakDbfs: number;
  /** Count of samples at or beyond full scale. */
  clippedSamples: number;
  /** Longest internal silence. A long one mid-sentence is a glitch, not a beat. */
  longestPauseSec: number;
  /**
   * Spread of fundamental frequency across the take. Near zero is a monotone
   * read - technically clean and lifeless.
   */
  pitchStdDevHz: number;
}

export interface TakeScore {
  takeId: string;
  /** 0..1, higher is better. */
  score: number;
  /** Every deduction, so a rejection can be explained rather than asserted. */
  penalties: Array<{ reason: string; cost: number }>;
  /** Set when the take is unusable regardless of score. */
  fatal: string | null;
}

/** A pause longer than this inside one line is a generation glitch. */
export const MAX_INTERNAL_PAUSE_SEC = 0.9;
/** Below this the read is flat enough that listeners disengage. */
export const MIN_PITCH_STDDEV_HZ = 12;

/**
 * Score one take. Fatal conditions are separated from penalties because a
 * clipped take is not "a bit worse" - it is unusable at any score.
 */
export function scoreTake(m: TakeMetrics): TakeScore {
  const penalties: Array<{ reason: string; cost: number }> = [];
  let fatal: string | null = null;

  if (m.clippedSamples > 0 || m.peakDbfs > -1) {
    fatal = `clipped (${m.clippedSamples} samples, peak ${m.peakDbfs.toFixed(1)} dBFS) — distortion cannot be mixed out`;
  } else if (m.longestPauseSec > MAX_INTERNAL_PAUSE_SEC) {
    fatal = `${m.longestPauseSec.toFixed(2)}s dead air inside the line — a generation glitch, not a beat`;
  }

  // Duration: how far off the edit's need, as a fraction of the target.
  const drift = m.targetSec > 0 ? Math.abs(m.durationSec - m.targetSec) / m.targetSec : 0;
  if (drift > 0.05) penalties.push({ reason: `duration off target by ${(drift * 100).toFixed(0)}%`, cost: Math.min(0.5, drift) });

  // Headroom: quiet is fixable, but a take near the ceiling has none to give.
  if (m.peakDbfs > -3) penalties.push({ reason: `only ${(-m.peakDbfs).toFixed(1)} dB of headroom`, cost: 0.15 });

  if (m.pitchStdDevHz < MIN_PITCH_STDDEV_HZ) {
    penalties.push({
      reason: `monotone read (pitch spread ${m.pitchStdDevHz.toFixed(1)} Hz)`,
      cost: 0.3 * (1 - m.pitchStdDevHz / MIN_PITCH_STDDEV_HZ),
    });
  }

  const score = Math.max(0, 1 - penalties.reduce((s, p) => s + p.cost, 0));
  return { takeId: m.takeId, score: Number(score.toFixed(3)), penalties, fatal };
}

export interface TakeSelection {
  chosen: TakeScore | null;
  rejected: TakeScore[];
  /** Why the chosen take won, or why nothing did. */
  reason: string;
}

/**
 * Pick a take, and be able to say why.
 *
 * Returns `chosen: null` when every take is fatal rather than shipping the
 * least-bad clipped audio: a distorted narrator is worse than a delayed reel.
 */
export function selectTake(metrics: readonly TakeMetrics[]): TakeSelection {
  if (!metrics.length) return { chosen: null, rejected: [], reason: "no takes were generated" };
  const scored = metrics.map(scoreTake);
  const usable = scored.filter((s) => !s.fatal).sort((a, b) => b.score - a.score);
  if (!usable.length) {
    return {
      chosen: null,
      rejected: scored,
      reason: `all ${scored.length} take(s) are unusable: ${scored.map((s) => s.fatal).join("; ")}`,
    };
  }
  const chosen = usable[0];
  const rejected = scored.filter((s) => s.takeId !== chosen.takeId);
  const worst = chosen.penalties.sort((a, b) => b.cost - a.cost)[0];
  return {
    chosen,
    rejected,
    reason:
      `take ${chosen.takeId} scored ${chosen.score} of ${scored.length} candidate(s)` +
      (worst ? `; best remaining flaw: ${worst.reason}` : "; clean"),
  };
}
