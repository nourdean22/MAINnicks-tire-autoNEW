/**
 * Turn a counter-conversation transcript into FACTS THAT CARRY THEIR EVIDENCE.
 *
 * The whole value of this layer is being able to ask "where did it get that?" — especially
 * when an extracted fact contradicts a repair order, which is the case the operator actually
 * wants surfaced ("customer asked about an alignment; the RO has tires only"). A summary
 * nobody can trace back to what was said is a rumour with a timestamp, so every fact here
 * carries the transcript segment index it came from and a confidence.
 *
 * THE ASYMMETRY THAT GOVERNS EVERY THRESHOLD. Inventing a fact is far worse than missing one.
 * A missed upsell opportunity costs a maybe; a FABRICATED quote read back to a customer costs
 * trust, and a fabricated promise ("you said 30 minutes") is worse still. So the extractor is
 * told to ABSTAIN rather than guess, low-confidence facts are dropped at the boundary, and a
 * fact whose evidence index does not exist is discarded rather than repaired.
 *
 * WHY THE AUDIO QUALITY MATTERS HERE, NOT JUST UPSTREAM. The office camera runs automatic
 * gain control (measured 2026-09-22: mean -25.0 dB but max 0.0 dB with 360 clipped samples).
 * AGC ducks for a second or two after a loud transient, so in a tire shop an impact wrench can
 * swallow the words right after it. A transcript with those gaps reads as fluent — the model
 * will happily extract from it — which is why `transcriptQuality` travels with the result and
 * why a low-level capture downgrades every confidence rather than being ignored.
 */
import { invokeLLM } from "../_core/llm";

/** One timed segment as `transcribeAudio()` returns them. */
export type TranscriptSegment = {
  index: number;
  start: number;
  end: number;
  text: string;
};

/** Not exported: nothing outside this module names a kind; `FactKind` below is the API. */
const FACT_KINDS = [
  "CUSTOMER_CONCERN",
  "REQUESTED_WORK",
  "QUOTE",
  "PROMISE",
  "APPROVAL",
  "DECLINE",
  "FOLLOW_UP",
  "VEHICLE_DETAIL",
] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export type ConversationFact = {
  kind: FactKind;
  /** What was said, in the extractor's words — short, specific, no interpretation. */
  value: string;
  /** Index into the transcript segments. THE PROVENANCE. A fact without it is discarded. */
  evidenceSegment: number;
  /** The segment's verbatim text, copied at validation time so a reader never has to
   *  re-join the fact to the transcript to see what it rests on. */
  evidenceText: string;
  confidence: number;
};

export type ExtractionResult = {
  facts: ConversationFact[];
  summary: string | null;
  /** Why facts were dropped, and how many. Reported, never silent — a run that extracted
   *  nothing because the model failed and one that extracted nothing because nobody said
   *  anything actionable are different findings. */
  dropped: { reason: string; count: number }[];
  engine: string | null;
  latencyMs: number | null;
  /** NULL when extraction did not run at all. Distinct from an empty fact list. */
  ok: boolean;
  error: string | null;
};

/**
 * Below this a fact is dropped at the boundary rather than stored.
 *
 * 0.7 is deliberately high. The cost of a wrong quote or a wrong promise reaching the
 * operator is a conversation with a customer about something that was never said.
 */
const MIN_FACT_CONFIDENCE = 0.7;

/**
 * LEVEL DOES NOT PREDICT INTELLIGIBILITY. Kept only to cap the genuinely inaudible.
 *
 * This started at -45 dBFS on the theory that a quiet capture yields a poor transcript. The
 * FIRST real measurement refuted it. A 90-second office sample, transcribed locally on
 * 2026-09-22, produced text for 37.4s and NOTHING for 50.0s — and the unrecovered stretches
 * were not quiet:
 *
 *   transcribed windows   -21 to -36 dB
 *   unrecovered windows   -16.7 to -31.2 dB   <- overlapping, and the LOUDEST 4.4s in the
 *                                                entire clip produced zero words
 *
 * The ranges overlap completely, so mean level has no discriminative power for this source.
 * A cap keyed on it would have waved that recording straight through.
 */
const LOW_LEVEL_DB = -55;

/**
 * THE SIGNAL THAT ACTUALLY PREDICTS A BAD TRANSCRIPT: how much audio produced no text.
 *
 * On the sample above, 56% of the clip was unrecovered while carrying normal conversational
 * energy, and the 44% that did return was semantically incoherent — "they talk about a way",
 * "sitting next to the car go". That is a model GUESSING, not transcribing.
 *
 * Which is the dangerous shape: a summariser fed that does not produce thin summaries, it
 * produces fluent, confident, WRONG ones. At a tire shop, where the job is getting
 * "205/55 R16" exactly right, a confident wrong number is worse than no number at all.
 *
 * So coverage gates confidence, regardless of how fluent the text reads.
 */
const MIN_TRANSCRIPT_COVERAGE = 0.65;

const SYSTEM = `You extract structured facts from a transcript of a conversation at an auto
repair shop's service counter.

RULES, in order of importance:

1. NEVER invent. If something is unclear, omit it. A missing fact costs nothing here; an
   invented quote or promise gets read back to a customer and is worse than useless.
2. Every fact MUST cite the segment index it came from. If you cannot point at a segment,
   do not emit the fact.
3. Quote numbers EXACTLY as spoken. Tire sizes, prices, phone numbers and years are the
   whole point. If a number is garbled or partial, omit the fact rather than repairing it —
   "205/55R16" and "25/5 R1 6" are not the same claim, and guessing between them is the
   single most damaging thing you can do.
4. Confidence is about the TRANSCRIPT, not your writing. If the words are ambiguous or the
   segment looks garbled, score low. Do not round up.
5. A summary is optional. Omit it rather than padding.

Fact kinds: CUSTOMER_CONCERN (what is wrong), REQUESTED_WORK (what they asked for), QUOTE (a
price discussed), PROMISE (a commitment about time or outcome), APPROVAL (customer agreed),
DECLINE (customer said no), FOLLOW_UP (something to do later), VEHICLE_DETAIL (make, model,
year, mileage, tire size).`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...FACT_KINDS] },
          value: { type: "string" },
          evidenceSegment: { type: "integer" },
          confidence: { type: "number" },
        },
        required: ["kind", "value", "evidenceSegment", "confidence"],
      },
    },
    summary: { type: "string" },
  },
  required: ["facts"],
} as const;

/**
 * Extract facts from a transcript.
 *
 * `meanVolumeDb` is the capture level measured at record time. Passing it is how a distant or
 * AGC-mangled recording gets its confidences capped instead of silently producing
 * authoritative-looking quotes.
 */
export async function extractConversationFacts(
  segments: TranscriptSegment[],
  opts: {
    meanVolumeDb?: number | null;
    timeoutMs?: number;
    /** Seconds the transcript actually covers, and the clip's full length. BOTH are needed
     *  for the coverage gate; omitting either leaves it OFF rather than assuming a value —
     *  an unmeasured clip must not be punished as though it had been measured and failed. */
    coveredSeconds?: number | null;
    totalSeconds?: number | null;
  } = {},
): Promise<ExtractionResult> {
  const dropped: { reason: string; count: number }[] = [];
  const bump = (reason: string) => {
    const row = dropped.find((d) => d.reason === reason);
    if (row) row.count += 1;
    else dropped.push({ reason, count: 1 });
  };

  if (!segments.length) {
    // Not an error: a genuinely silent capture. `ok: true` with no facts says "we looked and
    // there was nothing", which is a different claim from "we could not look".
    return { facts: [], summary: null, dropped, engine: null, latencyMs: null, ok: true, error: null };
  }

  const numbered = segments
    .map((s) => `[${s.index}] ${s.text}`)
    .join("\n");

  const started = Date.now();
  let raw: unknown;
  let engine: string | null = null;
  try {
    const res = await invokeLLM({
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Transcript segments:\n\n${numbered}` },
      ],
      outputSchema: OUTPUT_SCHEMA as never,
      temperature: 0,
      timeoutMs: opts.timeoutMs ?? 60_000,
    });
    engine = (res as { model?: string }).model ?? null;
    const text = (res as { text?: string }).text ?? "";
    raw = typeof text === "string" && text.trim() ? JSON.parse(text) : null;
  } catch (err) {
    // A failed extraction must NOT read as "no facts found". That is the empty-vs-error
    // confusion this whole file is arranged against.
    return {
      facts: [], summary: null, dropped, engine, latencyMs: Date.now() - started,
      ok: false, error: err instanceof Error ? err.message.slice(0, 400) : String(err).slice(0, 400),
    };
  }

  const latencyMs = Date.now() - started;
  const parsed = (raw ?? {}) as { facts?: unknown[]; summary?: unknown };
  const byIndex = new Map(segments.map((s) => [s.index, s]));
  const quiet = typeof opts.meanVolumeDb === "number" && opts.meanVolumeDb < LOW_LEVEL_DB;

  // Computed only when BOTH numbers are present. A missing measurement is not evidence of
  // bad audio, and treating it as such would gut a good transcript from a source that simply
  // did not report its timings.
  const coverage =
    typeof opts.coveredSeconds === "number" && typeof opts.totalSeconds === "number" &&
    opts.totalSeconds > 0
      ? opts.coveredSeconds / opts.totalSeconds
      : null;
  const gappy = coverage !== null && coverage < MIN_TRANSCRIPT_COVERAGE;

  const facts: ConversationFact[] = [];
  for (const item of Array.isArray(parsed.facts) ? parsed.facts : []) {
    const f = item as Partial<ConversationFact>;
    if (!f || typeof f !== "object") { bump("malformed"); continue; }
    if (!FACT_KINDS.includes(f.kind as FactKind)) { bump("unknown kind"); continue; }
    if (typeof f.value !== "string" || !f.value.trim()) { bump("empty value"); continue; }

    const seg = byIndex.get(Number(f.evidenceSegment));
    if (!seg) {
      // A cited segment that does not exist means the model invented its provenance. Discard
      // rather than repair: a fact whose evidence is fabricated is exactly the thing this
      // layer exists to prevent, and "close enough" segment matching would hide it.
      bump("evidence segment does not exist");
      continue;
    }

    // A quiet capture caps confidence. The transcript may read fluently while AGC has eaten
    // the words after a loud noise, so fluency is not evidence of fidelity.
    const base = typeof f.confidence === "number" ? Math.max(0, Math.min(1, f.confidence)) : 0;
    // Either gate caps at 0.6, which sits below MIN_FACT_CONFIDENCE — so a gappy or
    // inaudible capture yields NO facts rather than plausible-looking ones.
    const conf = (quiet || gappy) ? Math.min(base, 0.6) : base;
    if (conf < MIN_FACT_CONFIDENCE) {
      bump(gappy ? "below threshold (transcript coverage too low)"
         : quiet ? "below threshold (inaudible capture)"
         : "below threshold");
      continue;
    }

    facts.push({
      kind: f.kind as FactKind,
      value: f.value.trim(),
      evidenceSegment: seg.index,
      evidenceText: seg.text,
      confidence: conf,
    });
  }

  const summary = typeof parsed.summary === "string" && parsed.summary.trim()
    ? parsed.summary.trim()
    : null;

  return { facts, summary, dropped, engine, latencyMs, ok: true, error: null };
}
