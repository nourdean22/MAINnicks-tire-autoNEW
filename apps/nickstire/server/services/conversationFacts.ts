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
import { invokeLLM, type JsonSchema } from "../_core/llm";
import { CONVERSATION_FLAG_KINDS, isConversationFlagKind, type ConversationFlagKind } from "../../shared/conversationFlags";
import { isNonSpeechText } from "../lib/conversationQuality";

/** One timed segment as `transcribeAudio()` returns them. */
export type TranscriptSegment = {
  index: number;
  start: number;
  end: number;
  text: string;
  /**
   * Diarization grouping label only (for example SPEAKER_00).
   * It is NOT a person's identity and must never be promoted to one downstream.
   */
  speaker?: string;
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


const SUMMARY_LABELS: Record<FactKind, string> = {
  CUSTOMER_CONCERN: "Concern",
  REQUESTED_WORK: "Requested",
  QUOTE: "Quote",
  PROMISE: "Promised",
  APPROVAL: "Approved",
  DECLINE: "Declined",
  FOLLOW_UP: "Follow-up",
  VEHICLE_DETAIL: "Vehicle",
};

const SUMMARY_ORDER: readonly FactKind[] = [
  "CUSTOMER_CONCERN",
  "REQUESTED_WORK",
  "VEHICLE_DETAIL",
  "QUOTE",
  "PROMISE",
  "APPROVAL",
  "DECLINE",
  "FOLLOW_UP",
];

/**
 * Build the operator summary ONLY from facts that already survived provenance/confidence gates.
 *
 * This deliberately refuses free-form model prose. A model can cite valid evidence for one
 * fact and then smuggle an uncited guess into prose. Synthesizing from accepted facts means
 * every statement inherits evidence the server has already verified.
 */
function evidenceBackedSummary(facts: ConversationFact[]): string | null {
  // Business facts only: a flag (ears-v2) is about people, not the job, and is the owner's alone.
  const business = facts.filter((f) => FACT_KINDS.includes(f.kind as FactKind));
  if (!business.length) return null;

  const grouped = new Map<FactKind, string[]>();
  for (const fact of [...business].sort((a, b) => a.evidenceSegment - b.evidenceSegment)) {
    const kind = fact.kind as FactKind;
    const values = grouped.get(kind) ?? [];
    const normalized = fact.value.trim();
    if (normalized && !values.includes(normalized)) values.push(normalized);
    grouped.set(kind, values);
  }

  const parts = SUMMARY_ORDER.flatMap((kind) => {
    const values = grouped.get(kind) ?? [];
    return values.length ? [SUMMARY_LABELS[kind] + ": " + values.join("; ")] : [];
  });
  return parts.length ? parts.join(". ") + "." : null;
}

export type ConversationFact = {
  /** A business fact kind, or (ears-v2) a "worth knowing" flag kind whose value is the exact quote. */
  kind: FactKind | ConversationFlagKind;
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
  /**
   * ears-v2: the ACCOUNT of what happened, 1-4 sentences with guesses wrapped "(inferred: ...)" and
   * unheard stretches named "[inaudible: ...]", stored in the `gist` column. It must cite a speech
   * segment that exists, or be the fixed noise line for a clip with no speech. Coverage and level no
   * longer withhold it: it labels its own guesses. Absent = extraction did not produce one (failed).
   */
  gist?: string | null;
  /** True when the clip held no intelligible speech; gist is then exactly NOISE_ONLY_ACCOUNT. */
  noiseOnly?: boolean;
  /** Flags kept (stored in `facts` with a flag kind). */
  flagCount?: number;
  /** EXTRACTION_PROMPT_VERSION of the rules that produced this result. */
  promptVersion?: string;
};

const EXTRACTION_PROMPT_VERSION = "ears-v2-2026-10-21";
const NOISE_ONLY_ACCOUNT = "Only shop noise, no speech.";
const MAX_ACCOUNT_CHARS = 1200;
/** A silence between segments this long gets its own unnumbered line in the transcript the model reads. */
const GAP_LINE_SECONDS = 2;

/** Case, whitespace and punctuation removed, so a quote is compared on its words. */
function normalizeWords(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * The transcript as the model reads it: numbered speech segments, plus UNNUMBERED lines for
 * silences of 2 s or more and for whisper non-speech tokens. Unnumbered lines can never be cited.
 */
function renderTranscript(segments: TranscriptSegment[], totalSeconds: number | null | undefined): string {
  const out: string[] = [];
  const gapLine = (s: number) => `[gap ${s.toFixed(1)} s: no words transcribed]`;
  let prevEnd = 0;
  for (const s of [...segments].sort((a, b) => a.start - b.start)) {
    if (s.start - prevEnd >= GAP_LINE_SECONDS) out.push(gapLine(s.start - prevEnd));
    out.push(isNonSpeechText(s.text) ? `(noise: ${s.text.trim() || "silence"})` : `[${s.index}] ${s.text}`);
    prevEnd = Math.max(prevEnd, s.end);
  }
  if (typeof totalSeconds === "number" && totalSeconds - prevEnd >= GAP_LINE_SECONDS) out.push(gapLine(totalSeconds - prevEnd));
  return out.join("\n");
}

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

/**
 * A TRANSCRIBER LOOP IS NOT SPEECH. whisper.cpp's small models fall into repetition loops on
 * noise: the same line emitted segment after segment, timestamps marching on. Measured live
 * 2026-10-03 (office episode 345c5030): one short question, four times, 19s, 4 segments. Its
 * spans tile the clip, so coverage read 0.855 and the extractor PUBLISHED a gist from it — a
 * fluent sentence grounded on nothing anyone said. Coverage measures timing, not content, so
 * this is checked separately: if one normalized line fills at least half of 3+ segments, the
 * transcript is treated as a loop and nothing is extracted from it.
 */
const LOOP_MIN_SEGMENTS = 3;
const LOOP_DOMINANCE = 0.5;

/** True when the transcript is a repetition loop. */
function isTranscriberLoop(segments: TranscriptSegment[]): boolean {
  if (segments.length < LOOP_MIN_SEGMENTS) return false;
  const counts = new Map<string, number>();
  for (const s of segments) {
    const k = s.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const top = Math.max(0, ...counts.values());
  return top >= LOOP_MIN_SEGMENTS && top / segments.length >= LOOP_DOMINANCE;
}

/** Models wrap JSON in ```json fences often enough that not handling it is a self-inflicted
 *  extraction failure. Returns the body unchanged when there is no fence. */
export function stripFence(text: string): string {
  const m = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : text;
}

const SYSTEM = `You listen through a microphone on a camera at a working tire and auto repair shop: the
office counter, the shop floor or the outside lot (the message says which). Impact wrenches,
compressors, tire machines, a radio, traffic and wind are normal there, so expect gaps and
mis-heard words. Lines written [gap ...] are stretches where no words were transcribed, and lines
written (noise: ...) are sounds, not speech. Neither is a segment: only numbered lines [N] are
segments, and only they may be cited.

Return JSON with these fields.

account: 1 to 4 plain sentences on what actually happened, as specific as the words allow: what
was discussed, between which roles, any vehicle, job, part or money mentioned, and the tone. Use
roles only (a staff member, a customer, someone), never a name, not even one you hear. State what
was heard plainly. Wrap anything you infer or guess, from context or from the camera description,
exactly as (inferred: ...). Name a stretch you could not hear as [inaudible: what it sounded like,
for example banging]. A bare category is not an account: if people chatted, say what they chatted
about. If nothing intelligible was said, set noiseOnly to true and the account to exactly
"Only shop noise, no speech."
accountSegments: the segment numbers the account rests on.
noiseOnly: true only when there is no intelligible speech at all; then return no facts and no flags.
flags: things the owner would want to know, each { kind, evidenceSegment, quote, confidence }.
Kinds: NEGATIVE_TALK (negative talk about the shop, the owner, the work or the prices),
CUSTOMER_COMPLAINT, STAFF_CONFLICT, SAFETY, LEAVING_OR_COMPETITOR (going to another shop or
leaving), MONEY_OR_DISCOUNT (cash, discounts, side deals). quote is the exact words of that one
segment, copied, never paraphrased. Never flag anything you inferred: a flag rests only on words
heard. Confidence is about the transcript.
facts: actionable facts, under the rules below.

FACT RULES, in order of importance:

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
5. Do not add uncited prose to facts. The server builds the operator summary later from facts
   that survive provenance and confidence validation.

Fact kinds: CUSTOMER_CONCERN (what is wrong), REQUESTED_WORK (what they asked for), QUOTE (a
price discussed), PROMISE (a commitment about time or outcome), APPROVAL (customer agreed),
DECLINE (customer said no), FOLLOW_UP (something to do later), VEHICLE_DETAIL (make, model,
year, mileage, tire size).`;

/**
 * The gateway takes `{ name, schema }`, NOT a bare JSON Schema. Typed as JsonSchema on purpose:
 * the first version passed the inner object with an `as never` cast, the compiler said nothing,
 * and every live call threw at the provider while the mocked tests stayed green.
 */
const OUTPUT_SCHEMA: JsonSchema = {
  name: "conversation_facts",
  strict: false,
  schema: {
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
    account: { type: ["string", "null"] },
    accountSegments: { type: "array", items: { type: "integer" } },
    noiseOnly: { type: "boolean" },
    flags: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...CONVERSATION_FLAG_KINDS] },
          evidenceSegment: { type: "integer" },
          quote: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["kind", "evidenceSegment", "quote", "confidence"],
      },
    },
  },
  required: ["facts"],
  },
};

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
    /**
     * What the office camera SAW during this episode (services/officeVisual.ts summary +
     * activities). Context only: it can disambiguate the transcript ("keys handed over" next to
     * "here you go"), but it is never a segment, so no fact can cite it as evidence and the
     * provenance rule below is unchanged.
     */
    visualContext?: string | null;
    /** Where the microphone is, in words (conversationSourceLabel: "Office"); shown to the model. */
    location?: string | null;
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

  const v2 = { promptVersion: EXTRACTION_PROMPT_VERSION, flagCount: 0 };

  // Only non-speech tokens ([BLANK_AUDIO], (banging)...): the clip is noise, said as such, with no
  // model call. Checked before the loop detector, which would call repeated tokens a loop.
  if (segments.every((s) => isNonSpeechText(s.text))) {
    return { facts: [], summary: null, dropped, engine: null, latencyMs: null, ok: true, error: null, gist: NOISE_ONLY_ACCOUNT, noiseOnly: true, ...v2 };
  }

  if (isTranscriberLoop(segments)) {
    // Not an extraction failure (ok:true) and not silence: we looked, and what came back was
    // the transcriber repeating itself. No LLM call — there is nothing in it to spend on.
    bump("transcript is a transcriber repetition loop");
    return { facts: [], summary: null, dropped, engine: null, latencyMs: null, ok: true, error: null, gist: null, noiseOnly: false, ...v2 };
  }

  const numbered = renderTranscript(segments, opts.totalSeconds);
  const location = opts.location?.trim() ? `Microphone: ${opts.location.trim().slice(0, 60)}\n\n` : "";

  const started = Date.now();
  let raw: unknown;
  let engine: string | null = null;
  try {
    const res = await invokeLLM({
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: location + (opts.visualContext?.trim()
            ? `Camera context (what the office camera saw during this conversation; background only, it is NOT a transcript segment and must never be cited as evidence):\n${opts.visualContext.trim().slice(0, 800)}\n\nTranscript segments:\n\n${numbered}`
            : `Transcript segments:\n\n${numbered}`),
        },
      ],
      outputSchema: OUTPUT_SCHEMA,
      temperature: 0,
      timeoutMs: opts.timeoutMs ?? 60_000,
    });
    engine = res.model ?? null;
    // `choices[0].message.content` is where InvokeResult carries the text. There is NO `res.text`
    // -- reading one returned undefined on every real call, and the hand-written mock in the
    // test file invented that field, so the suite certified the misunderstanding.
    const content = res.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : "";
    if (!text.trim()) throw new Error("LLM returned no content for fact extraction");
    raw = JSON.parse(stripFence(text));
  } catch (err) {
    // A failed extraction must NOT read as "no facts found". That is the empty-vs-error
    // confusion this whole file is arranged against.
    return {
      facts: [], summary: null, dropped, engine, latencyMs: Date.now() - started,
      ok: false, error: err instanceof Error ? err.message.slice(0, 400) : String(err).slice(0, 400),
    };
  }

  const latencyMs = Date.now() - started;
  const parsed = (raw ?? {}) as { facts?: unknown[]; account?: unknown; accountSegments?: unknown; noiseOnly?: unknown; flags?: unknown[] };
  const byIndex = new Map(segments.map((s) => [s.index, s]));
  // Flags and the account may cite SPEECH only: a noise line was never shown numbered.
  const speechByIndex = new Map(segments.filter((s) => !isNonSpeechText(s.text)).map((s) => [s.index, s]));
  const noiseOnly = parsed.noiseOnly === true;
  const rawFacts = Array.isArray(parsed.facts) ? parsed.facts : [];
  const rawFlags = Array.isArray(parsed.flags) ? parsed.flags : [];
  if (noiseOnly && (rawFacts.length || rawFlags.length)) bump("noise-only clip: facts and flags ignored");
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
  for (const item of noiseOnly ? [] : rawFacts) {
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

  // FLAGS (ears-v2). The provenance rule lives HERE, never in the prompt: a flag survives only
  // when its quote, compared on words alone, is really in the speech segment it cites, carries no
  // guess or gap marker, and clears 0.7. The coverage cap does NOT apply (the flag shows its exact
  // heard words and the owner can open the transcript); the quiet cap does.
  let flagCount = 0;
  for (const item of noiseOnly ? [] : rawFlags) {
    const f = item as { kind?: unknown; evidenceSegment?: unknown; quote?: unknown; confidence?: unknown };
    if (!f || typeof f !== "object") { bump("flag malformed"); continue; }
    if (!isConversationFlagKind(f.kind)) { bump("flag unknown kind"); continue; }
    const seg = speechByIndex.get(Number(f.evidenceSegment));
    if (!seg) { bump("flag evidence segment does not exist"); continue; }
    const quote = typeof f.quote === "string" ? f.quote.trim() : "";
    if (!normalizeWords(quote)) { bump("flag quote empty"); continue; }
    if (/\(inferred|\[inaudible|\[gap/i.test(quote)) { bump("flag quote is inferred or a gap marker"); continue; }
    // Whole words: "char" is not heard in "charge".
    if (!` ${normalizeWords(seg.text)} `.includes(` ${normalizeWords(quote)} `)) { bump("flag quote not in cited segment"); continue; }
    const base = typeof f.confidence === "number" ? Math.max(0, Math.min(1, f.confidence)) : 0;
    const conf = quiet ? Math.min(base, 0.6) : base;
    if (conf < MIN_FACT_CONFIDENCE) { bump(quiet ? "flag below threshold (inaudible capture)" : "flag below threshold"); continue; }
    facts.push({ kind: f.kind, value: quote, evidenceSegment: seg.index, evidenceText: seg.text, confidence: conf });
    flagCount++;
  }

  const summary = evidenceBackedSummary(facts);

  // THE ACCOUNT (ears-v2). It labels its own guesses, so coverage and level no longer withhold it;
  // it still has to rest on a speech segment that exists. noiseOnly overrides whatever the model
  // wrote with the fixed line, so a clip with no speech can never read as a conversation.
  let gist: string | null = null;
  if (noiseOnly) {
    gist = NOISE_ONLY_ACCOUNT;
  } else {
    const rawAccount = typeof parsed.account === "string" ? parsed.account.trim() : "";
    if (rawAccount) {
      const cited = Array.isArray(parsed.accountSegments)
        ? parsed.accountSegments.filter((i) => speechByIndex.has(Number(i)))
        : [];
      if (!cited.length) bump("account withheld (no existing segment cited)");
      else gist = rawAccount.slice(0, MAX_ACCOUNT_CHARS);
    }
  }

  return { facts, summary, dropped, engine, latencyMs, ok: true, error: null, gist, noiseOnly, flagCount, promptVersion: EXTRACTION_PROMPT_VERSION };
}
