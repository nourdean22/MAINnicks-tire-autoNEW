/**
 * TURN RISK + REGISTER -- 2026-09-10.
 *
 * One pre-generation classification pass that answers two questions the
 * 2026-09-10 audit raised separately but which share all their inputs:
 *
 *   1. Must this turn be BUFFERED so the evidence gate can actually
 *      block it? (Audit finding #1.)
 *   2. What REGISTER should it be written in? (Audit finding #5.)
 *
 * WHY BUFFERING IS SELECTIVE. Every post-generation pass runs inside
 * streamText's `onFinish`, which cannot fire until the last token is
 * already on the wire (build-stream-config.ts:340). So the gate can only
 * block where a complete reply exists un-flushed -- which means
 * generating without streaming. Doing that to EVERY turn would trade
 * NICK's best property (fast, live, conversational) for a guarantee most
 * turns do not need: a turn with no proper nouns, no numbers and no
 * commitment has nothing for the gate to catch.
 *
 * So: buffer the turns that can actually ship a falsifiable claim, and
 * leave the rest streaming exactly as today.
 *
 * WHY THIS IS DETERMINISTIC. Classifying with a model call would add a
 * round trip to EVERY turn -- including the ~70% that then stream
 * anyway -- to decide something regexes decide well. An LLM in the
 * latency-critical path, to route away from latency, is a bad trade.
 *
 * WHY NOT `posture`/`depth`. Those exist in the UI store and are
 * structurally unreachable: setPosture/setDepth have zero callers since
 * the composer chips were removed, and use-chat-stream.ts:59 ships only
 * non-"auto" values, so the server's "spar"/"execute"/"counsel" branches
 * (finalize-system-prompt.ts:369) are dead code. Register is therefore
 * derived server-side from the turn, not read from a control that
 * cannot be set.
 */

export type Register = "coaching" | "technical" | "health" | "meta";
export type RiskTier = "low" | "high";

export interface TurnRiskAssessment {
  risk: RiskTier;
  register: Register;
  /** Generate fully before flushing, so the evidence gate can block. */
  buffer: boolean;
  /**
   * The turn involves a commitment or a consequential disclosure, so
   * agreement must be earned. Deliberately SEPARATE from `register`:
   * "cutting back on stims starting tomorrow" is health-registered AND
   * needs adversarial handling, and forcing one bucket would drop one.
   */
  adversarialRequired: boolean;
  reasons: string[];
  signals: {
    expectsNamedResources: boolean;
    healthDomain: boolean;
    factualWithoutTool: boolean;
    statesCommitment: boolean;
    asksForNumbers: boolean;
    metaSystem: boolean;
    technical: boolean;
  };
}

export interface TurnRiskInput {
  /**
   * Whether a tool is expected to fire this turn. A factual ask that
   * WILL hit a tool is low-risk: the receipt will exist. The same ask
   * with no tool is exactly the "Stoic Strategy" shape.
   */
  toolsExpected: boolean;
  /** From turn-intelligence.classifyTurn(), when available. */
  intent?: string;
}

/** "give me channels/books/podcasts/resources" -- names WILL be emitted. */
const RESOURCE_ASK_RE =
  /\b(recommend|suggest|give me|show me|find me|what are|any good|best|top\s*\d*|worth (reading|watching|following))\b[\s\S]{0,60}\b(channels?|podcasts?|books?|newsletters?|substacks?|videos?|documentaries|papers?|studies|articles?|blogs?|courses?|apps?|tools?|resources?|reads?|listens?|accounts?|creators?|people|sources?)\b/i;

/** The reverse order: "channels worth following", "books on stoicism". */
const RESOURCE_ASK_REVERSE_RE =
  /\b(channels?|podcasts?|books?|newsletters?|videos?|papers?|studies|articles?|courses?|resources?|creators?)\b[\s\S]{0,40}\b(recommend|suggest|worth|good|best|exclusive|underrated|obscure|clever)\b/i;

/** Dosing, stacking, timing -- being wrong here has cardiovascular stakes. */
const HEALTH_RE =
  // `xr` / `bead` / `extended-release` are here because the audit's own
  // quoted failure was "second bead release peaks around hour 5-7" --
  // stated flat, no hedge, no source, in the same confident register as
  // the coaching lines. A health lexicon that misses the exact sentence
  // that prompted it is a lexicon that has not been tested.
  /\b(adderall|vyvanse|ritalin|modafinil|armodafinil|caffeine|pre-?workout|creatine|melatonin|ssri|snri|benzo|stimulants?|stims?|dosage|dosing|dose|mg\b|milligrams?|half-?life|xr|bead|(extended|immediate|delayed)[- ]release|onset|comedown|stack(ing|ed)?|taper(ing)?|titrat|withdrawal|blood pressure|heart rate|resting hr|interaction|contraindicat)\b/i;

/** "why does the app...", "the build fails", "this endpoint 500s". */
const TECHNICAL_RE =
  /\b(bug|error|stack ?trace|exception|crash(es|ed|ing)?|fails?|failing|broken|regression|endpoint|api|websocket|socket|cache|cachin|deploy(ed|ment)?|build|compile|typecheck|migration|schema|query|index|latency|timeout|502|500|404|cors|env var|environment variable|backgrounded?|background(ing)?|service worker|pwa)\b/i;

/** Auditing NICK itself, or asking for prompt/system changes. */
const META_RE =
  /\b(your (prompt|system prompt|memory|gate|persona|register)|this system|the system prompt|audit (yourself|nick|this)|how do you (work|decide|remember)|why did you (say|do|claim)|your (own )?(architecture|pipeline|reasoning)|nick'?s (prompt|memory|gate))\b/i;

/** A stated intention with a future start -- the "starting tomorrow" shape. */
const COMMITMENT_RE =
  /\b(i'?m (going to|gonna|about to)|i'?ll (start|begin|stop|quit|cut)|starting (tomorrow|monday|next week|today)|from (tomorrow|monday|next week)|i'?m (cutting|quitting|stopping|starting)|no more\b|i (promise|swear|commit)|this time i)\b/i;

/** Asks that invite a specific figure -- fabrication-prone. */
const NUMBER_ASK_RE =
  /\b(how (much|many|long|often)|what'?s the (number|figure|rate|dose|amount)|peak|half-?life|percent|percentage|\bhours?\b|\bmg\b|ratio|average)\b/i;

/** Factual/lookup shapes where a name or figure is the expected answer. */
const LOOKUP_RE =
  /\b(who (is|was|are)|what (is|was|are) the|when (did|was|is)|where (is|can i)|which\b|cite|source|link me|show me the)\b/i;

function any(re: RegExp, s: string): boolean {
  return re.test(s);
}

/**
 * Pure. Same input, same assessment -- so it can be replayed over stored
 * transcripts to measure the buffered share BEFORE the buffer is built
 * (experiment E3).
 */
export function assessTurnRisk(
  userText: string,
  input: TurnRiskInput = { toolsExpected: false },
): TurnRiskAssessment {
  const text = (userText ?? "").trim();
  const reasons: string[] = [];

  const expectsNamedResources =
    any(RESOURCE_ASK_RE, text) || any(RESOURCE_ASK_REVERSE_RE, text);
  const healthDomain = any(HEALTH_RE, text);
  const technical = any(TECHNICAL_RE, text);
  const metaSystem = any(META_RE, text);
  const statesCommitment = any(COMMITMENT_RE, text);
  const asksForNumbers = any(NUMBER_ASK_RE, text);

  // A lookup-shaped ask with no tool behind it is the fabrication case.
  // The same ask WITH a tool is fine -- the receipt will exist.
  const factualWithoutTool =
    !input.toolsExpected &&
    (any(LOOKUP_RE, text) || input.intent === "factual") &&
    text.length > 12;

  if (expectsNamedResources) reasons.push("asks for named resources -- proper nouns will be emitted");
  if (healthDomain) reasons.push("health/pharmacology domain -- figures must be hedged and sourced");
  if (factualWithoutTool) reasons.push("factual lookup with no tool expected to fire");
  if (asksForNumbers && !input.toolsExpected) reasons.push("invites a specific figure with no tool behind it");
  if (statesCommitment) reasons.push("states a commitment -- prior instances must be checked first");

  // BUFFER: only where the gate has something to catch.
  const buffer =
    expectsNamedResources || healthDomain || factualWithoutTool || (asksForNumbers && !input.toolsExpected);

  // REGISTER precedence: highest-stakes wins. Health outranks everything
  // because being wrong there is the only case with a physical downside;
  // meta outranks technical because "audit your own prompt" is
  // technical-shaped but wants cold analysis, not a fix-it answer.
  const register: Register = healthDomain
    ? "health"
    : metaSystem
      ? "meta"
      : technical
        ? "technical"
        : "coaching";

  if (register !== "coaching") reasons.push(`register=${register}`);

  return {
    risk: buffer ? "high" : "low",
    register,
    buffer,
    // A commitment needs pushback whatever register it arrives in.
    adversarialRequired: statesCommitment,
    reasons,
    signals: {
      expectsNamedResources,
      healthDomain,
      factualWithoutTool,
      statesCommitment,
      asksForNumbers,
      metaSystem,
      technical,
    },
  };
}

/**
 * The register instruction injected into the system prompt.
 *
 * `finalize-system-prompt.ts:159` hard-codes "Always end with ONE next
 * move" into the default persona block, and four of the five persona
 * blocks repeat it -- which IS the audit's one-shape finding, sitting in
 * a string. This block is appended AFTER the persona block so it can
 * countermand that instruction for the registers where it is wrong.
 */
export function buildRegisterBlock(a: TurnRiskAssessment): string {
  const lines: string[] = [];

  switch (a.register) {
    case "technical":
      lines.push(
        "REGISTER: TECHNICAL. Answer like a senior engineer: diagnosis, then fix, then stop.",
        "Drop the opening hook and drop the imperative close -- no \"go run\", no \"now go\". Overrides any instruction above to end with one next move.",
      );
      break;
    case "health":
      lines.push(
        "REGISTER: HEALTH/PHARMACOLOGY. Never state a pharmacokinetic figure (peak time, half-life, mg equivalence) as fact.",
        "Hedge explicitly -- \"roughly\", \"an estimate, not a lab value\" -- or omit the number. Name the real risk (cardiovascular load) ONCE, not every turn.",
        "No imperative close. This is not a coaching turn.",
      );
      break;
    case "meta":
      lines.push(
        "REGISTER: META/SYSTEM. The subject is this system itself. Be cold and analytical, third-person about the system.",
        "No warrior register, no \"go\", no motivational close. Overrides any instruction above to end with one next move.",
      );
      break;
    case "coaching":
      // The existing shape is correct here -- say nothing and let the
      // persona block do its job.
      break;
  }

  if (a.adversarialRequired) {
    lines.push(
      "ADVERSARIAL: the operator stated an intention or commitment. Before agreeing, check whether this has been stated before without starting.",
      "If it has, say so plainly and ask what is different this time. Agreement here must be earned, not reflexive. Brutal honesty that only applies to cheap topics is not honesty.",
    );
  }

  return lines.length > 0 ? lines.join("\n") : "";
}
