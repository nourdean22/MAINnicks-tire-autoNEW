/**
 * Live receptionist baseline + replay-lane parity (2026-10-09).
 *
 * THE DEFECT THIS CLOSES. runPromptEvolution (promptEvolution.ts) replays the
 * code constant ASSISTANT_SYSTEM_PROMPT as the baseline every candidate must
 * beat. Callers never hear that constant. They hear what updateAssistant last
 * pushed: the code prompt with the getPromptLessons() block appended at push
 * time and the dashboard-managed transfer settings carried across, served by
 * openai/gpt-4o at temperature 0.4 and 250 max tokens, with tools. The ghost
 * replay lane is a different model (GHOST_AGENT_MODEL), temperature 0, 700 max
 * tokens, and no tools. A candidate that "beats the baseline" may only beat a
 * prompt no caller hears, on a lane no caller rides.
 *
 * WHAT THIS MODULE DOES, and deliberately no more:
 *  1. resolveLiveReceptionistBaseline() proves which assistant ANSWERS the
 *     shop line (getAssistantRoutingTruth, provider evidence), reads the prompt
 *     and model block that assistant serves (GET /assistant/:id), and labels
 *     the live prompt against the code: identical, code_plus_lessons, diverged.
 *  2. describeLaneParity() names every way the replay lane differs from the
 *     live lane, so a run RECORDS the mismatch instead of hiding it.
 *
 * It does NOT change the replay model. Moving replay onto gpt-4o with tools is
 * an operator cost decision; this module only makes the gap explicit.
 *
 * FAIL CLOSED. A routing mismatch, an unknown routing, a failed or non-OK
 * provider read, a body that is not JSON, a missing system prompt, or a model
 * block carrying MORE than one message (the replay takes exactly one system
 * prompt, so the rest would be text callers hear and the replay never sees)
 * all THROW with a sentence naming the cause. A weekly run must fail loudly
 * rather than measure the wrong baseline: the same stance as updateAssistant's
 * pre-read (vapi.ts, "FAIL CLOSED (2026-09-23)"). Exactly one read is
 * best-effort, on purpose: the current lessons block only refines the parity
 * LABEL, never the baseline prompt itself, so a memory-read failure degrades
 * the label's detail and not the run.
 *
 * WHY NOT pickReceptionistAssistantId. Its rungs 2-4 resolve by name match and
 * provider list order, and its own log line calls that order "not guaranteed".
 * A baseline must come from the line binding, so only a routing reading of
 * "match" (the line answers with the pinned edit target) is accepted here.
 *
 * NO SECOND HASH SCHEME. providerBehaviorHash is metadata.nickBehaviorHash as
 * the provider returns it: the value updateAssistant stamped with
 * computeVapiBehaviorHash and the webhook persists per call. It cannot be
 * recomputed from a GET body, because the provider adds ids, timestamps and
 * defaults that were never pushed. promptHash is only a content id of the
 * prompt TEXT (sha256 hex, first 24) so a receipt can say which prompt ran.
 *
 * Read-only: one routing read and one assistant GET per resolution, plus the
 * lessons read. Never writes, never pushes.
 */

import { createHash } from "node:crypto";
import { createLogger } from "../lib/logger";
import { GHOST_AGENT_MODEL } from "./ghostReplay";
import {
  ASSISTANT_SYSTEM_PROMPT,
  buildAssistantConfig,
  fetchAssistantById,
  getAssistantRoutingTruth,
  isRetiredAssistant,
} from "./vapi";

const log = createLogger("receptionist-baseline");

export type PromptParity = "identical" | "code_plus_lessons" | "diverged";

/** A serving lane: who answers, how hot, how long, with which tools. */
export interface ReceptionistLane {
  provider: string | null;
  model: string | null;
  temperature: number | null;
  maxTokens: number | null;
  /**
   * function.name for function and voicemail tools; `type` for tools that have
   * no function block (transferCall); `toolId:<id>` for tools the assistant
   * references by id instead of carrying inline.
   */
  toolNames: string[];
}

/** The lane the ghost replay runs a prompt on. */
export interface ReplayLane {
  model: string;
  temperature: number;
  maxTokens: number;
  tools: readonly string[];
}

export interface ReceptionistBaseline {
  /** live_provider = read from the assistant that answers the line; repository = the code constant (offline only). */
  source: "live_provider" | "repository";
  /** The assistant that answers the shop line. Null for the repository baseline. */
  assistantId: string | null;
  /** The exact system prompt to replay as the baseline. */
  prompt: string;
  /** sha256 hex of `prompt` (UTF-8), first 24 chars. */
  promptHash: string;
  /** metadata.nickBehaviorHash as the provider returned it; null when absent (assistant not pushed since stamping began). */
  providerBehaviorHash: string | null;
  /** metadata.nickBehaviorSchema as the provider returned it; null when absent. */
  providerBehaviorSchema: string | null;
  parity: PromptParity;
  /** One sentence explaining the parity label. Never blank. */
  parityDetail: string;
  /**
   * The live text AFTER the code prompt: "" (or trailing whitespace only) when
   * identical, the learned-lessons block when code_plus_lessons, null when
   * diverged (no clean split exists).
   *
   * Why it is exposed: updateAssistant APPENDS lessons at push time. An
   * optimizer handed `prompt` would edit text that already carries them, and
   * the next push would append them a second time. The like-for-like use is:
   * optimize ASSISTANT_SYSTEM_PROMPT, replay `candidate + lessonsSuffix`
   * against `prompt`, so both arms carry the same lessons callers hear.
   *
   * Byte-exact contract: whenever the served text starts with
   * ASSISTANT_SYSTEM_PROMPT byte for byte (the normal case: updateAssistant
   * pushes code + lessons verbatim), ASSISTANT_SYSTEM_PROMPT + lessonsSuffix
   * === prompt, trailing whitespace included, so a no-op candidate replays the
   * same string as the baseline. When the served text differs from the code
   * only in line endings or trailing whitespace, no suffix can rebuild it
   * byte for byte; the suffix is then the remainder after normalization and
   * parityDetail says so ("line endings or trailing whitespace").
   */
  lessonsSuffix: string | null;
  /**
   * For live_provider: the model block the provider says it serves.
   * For repository: the model block the code WOULD push (buildAssistantConfig).
   */
  liveLane: ReceptionistLane;
  /** ISO timestamp of the resolution. */
  fetchedAt: string;
}

/** The fields of getAssistantRoutingTruth() this module relies on. */
export type RoutingReading = Pick<
  Awaited<ReturnType<typeof getAssistantRoutingTruth>>,
  "state" | "detail" | "answeringAssistantId" | "editTargetAssistantId"
>;

/** Injection points, so tests need no network and no database. Each defaults to the production reader. */
export interface LiveBaselineDeps {
  /** Default: getAssistantRoutingTruth (vapi.ts). */
  routing?: () => Promise<RoutingReading>;
  /** Default: fetchAssistantById (vapi.ts), GET /assistant/:id. */
  fetchAssistant?: (assistantId: string) => Promise<Response>;
  /** Default: getPromptLessons() (nickMemory.ts), called exactly as updateAssistant calls it. */
  lessons?: () => Promise<string>;
}

/**
 * The lane ghostReplay() REQUESTS (ghostReplay.ts): GHOST_AGENT_MODEL,
 * temperature 0, maxTokens 700, no tools. ghostReplay writes those values
 * inline rather than exporting them, so this mirror is pinned by a test that
 * drives the REAL ghostReplay() against a mocked invokeLLM and compares what it
 * sent. An empty reply triggers ONE retry at 1400 tokens; that rescues a
 * token-budget artifact and is not the lane, so it is not part of parity.
 *
 * REQUESTED, NOT SERVED. invokeLLM (server/_core/llm.ts) may serve a different
 * model than this: resolveEffectiveModel() reroutes the request under
 * AI_FORCE_GEMINI (and under AI_FORCE_OLLAMA when the pin is not
 * Ollama-native), and an Ollama 403 "subscription" refusal falls back to
 * Gemini for that one call. ghostReplay discards InvokeResult.model, so this
 * module cannot see the served model. A run that wants the served lane must
 * record InvokeResult.model per replay and pass the observed lane to
 * describeLaneParity as `replayLane`; until then a lane-parity record names
 * the requested model only.
 */
export const REPLAY_LANE: Readonly<ReplayLane> = Object.freeze({
  model: GHOST_AGENT_MODEL,
  temperature: 0,
  maxTokens: 700,
  tools: Object.freeze([] as string[]),
});

/** Content id of a prompt: sha256 hex, first 24 chars. Module-private: an
 *  export used only by tests is an orphan to scripts/knip-orphan-gate.mjs. */
function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 24);
}

/**
 * The shape getPromptLessons() (nickMemory.ts) appends: a blank line, the
 * "## WHAT WE'VE LEARNED (...)" header, then one "- " line per lesson.
 * Strict on purpose: every line after the header must be a "- " bullet, so
 * free text appended AFTER a lessons header (a heading, a paragraph) cannot
 * hide inside the lessons label. A hand edit written AS bullets under that
 * header does match; a shape is not provenance, so a shape-only match never
 * vouches for where the block came from (see classifyPromptParity's detail).
 * The apostrophe is matched with "." so a typographic quote cannot break it.
 * A test runs the REAL getPromptLessons formatter through this pattern, so a
 * header change there fails here.
 */
const LESSONS_BLOCK_RX = /^\n+## WHAT WE.VE LEARNED\b[^\n]*\n- [^\n]*(?:\n- [^\n]*)*$/;

/** Line endings and trailing whitespace carry no behavior; nothing else is normalized. */
function normalizePrompt(text: string): string {
  return text.replace(/\r\n/g, "\n").trimEnd();
}

function firstDifference(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

/**
 * Pure: how does the live prompt relate to the code prompt?
 *
 *  identical          live == code
 *  code_plus_lessons  live == code + currentLessons (proven: today's block,
 *                     byte for byte after normalization), OR live starts with
 *                     code and the remainder is a lessons-SHAPED block. The
 *                     second rung proves a shape, not a source: it may be an
 *                     earlier push or a hand edit written as bullets, and its
 *                     detail says so instead of asserting either.
 *  diverged           anything else: a dashboard edit, an older code prompt,
 *                     or text appended that is not a lessons block
 *
 * `currentLessons` is today's getPromptLessons() output, or null when it could
 * not be read. "" is ambiguous in production: recall() (nickMemory.ts) returns
 * [] when a query throws, so "" means "no lesson qualifies OR the read failed
 * inside recall", and the detail says exactly that. Module-private for the
 * same orphan-gate reason as hashPrompt; tests reach it through
 * resolveLiveReceptionistBaseline.
 *
 * lessonsSuffix is the live text after the code prompt: "" (or trailing
 * whitespace) for identical, the lessons block for code_plus_lessons, null for
 * diverged (no clean split). It is sliced from the RAW served text whenever
 * that text starts with the raw code prompt, so codePrompt + lessonsSuffix
 * === livePrompt byte for byte; see ReceptionistBaseline.lessonsSuffix.
 */
function classifyPromptParity(
  livePrompt: string,
  codePrompt: string,
  currentLessons: string | null,
): { parity: PromptParity; detail: string; lessonsSuffix: string | null } {
  const live = normalizePrompt(livePrompt);
  const code = normalizePrompt(codePrompt);
  // The served remainder byte for byte, when the served text starts with the
  // code prompt byte for byte. Null only when the two differ in line endings
  // or trailing whitespace; the normalized remainder is used then, and the
  // detail carries `rebuildNote` so the byte-exact contract is never implied.
  const rawRest = livePrompt.startsWith(codePrompt) ? livePrompt.slice(codePrompt.length) : null;
  const rebuildNote =
    rawRest === null
      ? " The served text differs from the repository text in line endings or trailing whitespace, so the repository prompt plus lessonsSuffix equals it only after normalization."
      : "";

  if (live === code) {
    return { parity: "identical", detail: `The live prompt equals the repository prompt.${rebuildNote}`, lessonsSuffix: rawRest ?? "" };
  }
  if (currentLessons && live === normalizePrompt(codePrompt + currentLessons)) {
    return {
      parity: "code_plus_lessons",
      detail: `The live prompt is the repository prompt plus today's learned-lessons block, exactly as Push Latest Config builds it.${rebuildNote}`,
      lessonsSuffix: rawRest ?? live.slice(code.length),
    };
  }
  if (live.startsWith(code)) {
    const rest = live.slice(code.length);
    if (LESSONS_BLOCK_RX.test(rest)) {
      const why =
        currentLessons === null
          ? "today's lessons could not be read"
          : currentLessons === ""
            ? "today's lessons read empty (no lesson qualifies, or the memory store query failed)"
            : "it does not equal today's lessons";
      return {
        parity: "code_plus_lessons",
        detail:
          `The live prompt is the repository prompt plus a block shaped like learned lessons; ${why}, so it was matched by shape only: ` +
          `an earlier push or a hand edit written as bullets, provenance not verified.${rebuildNote}`,
        lessonsSuffix: rawRest ?? rest,
      };
    }
    return {
      parity: "diverged",
      detail: `The live prompt starts with the repository prompt but carries ${rest.length} more characters that are not a learned-lessons block.`,
      lessonsSuffix: null,
    };
  }
  return {
    parity: "diverged",
    detail: `The live prompt differs from the repository prompt (live ${live.length} chars, repository ${code.length} chars, first difference at char ${firstDifference(live, code)}).`,
    lessonsSuffix: null,
  };
}

function toolNamesOf(model: Record<string, unknown>): string[] {
  const names: string[] = [];
  const tools = Array.isArray(model.tools) ? model.tools : [];
  for (const raw of tools) {
    if (!raw || typeof raw !== "object") continue;
    const tool = raw as Record<string, unknown>;
    const fn = tool.function && typeof tool.function === "object" ? (tool.function as Record<string, unknown>) : null;
    if (fn && typeof fn.name === "string" && fn.name) names.push(fn.name);
    else if (typeof tool.type === "string" && tool.type) names.push(tool.type);
  }
  const ids = Array.isArray(model.toolIds) ? model.toolIds : [];
  for (const id of ids) if (typeof id === "string" && id) names.push(`toolId:${id}`);
  return names;
}

function laneOf(model: Record<string, unknown>): ReceptionistLane {
  return {
    provider: typeof model.provider === "string" ? model.provider : null,
    model: typeof model.model === "string" ? model.model : null,
    temperature: typeof model.temperature === "number" ? model.temperature : null,
    maxTokens: typeof model.maxTokens === "number" ? model.maxTokens : null,
    toolNames: toolNamesOf(model),
  };
}

function reasonOf(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 200);
}

function refuse(reason: string): Error {
  log.warn("live receptionist baseline refused", { reason });
  return new Error(`Live receptionist baseline refused: ${reason}`);
}

/**
 * getPromptLessons() exactly as updateAssistant calls it, with one guard in
 * front. recall() (nickMemory.ts) returns [] when db() is null, so an
 * UNCONFIGURED memory store would arrive as a confident "" and read as "no
 * lesson qualifies". Probing the same db() handle recall() uses, and throwing
 * on null, routes that case to the "could not be read" branch instead.
 *
 * What the guard does NOT catch: db() is null only when DATABASE_URL is unset
 * or createPool throws synchronously (server/db.ts getDb). With DATABASE_URL
 * set it returns a drizzle instance over a lazy pool, so an UNREACHABLE store
 * passes the guard, the query fails inside recall(), recall() logs and returns
 * [], and the read arrives as "". The "" wording in classifyPromptParity
 * ("no lesson qualifies, or the memory store query failed") covers that case
 * without claiming either reading.
 */
async function defaultLessons(): Promise<string> {
  const { db } = await import("../lib/db-helper");
  if (!(await db())) throw new Error("the memory store is unavailable (db() returned null)");
  const { getPromptLessons } = await import("./nickMemory");
  return getPromptLessons();
}

/**
 * Resolve the prompt callers actually hear, from the assistant that actually
 * answers the line. Throws (never returns a guess) when routing is not a
 * proven match, the provider read fails or is non-OK, or the system prompt is
 * missing. See the header for the full contract.
 */
export async function resolveLiveReceptionistBaseline(deps: LiveBaselineDeps = {}): Promise<ReceptionistBaseline> {
  const readRouting = deps.routing ?? getAssistantRoutingTruth;
  const readAssistant = deps.fetchAssistant ?? fetchAssistantById;
  const readLessons = deps.lessons ?? defaultLessons;

  let routing: RoutingReading;
  try {
    routing = await readRouting();
  } catch (err) {
    throw refuse(`the routing read threw (${reasonOf(err)}), so which assistant answers the line is unknown.`);
  }
  if (routing.state === "mismatch") {
    throw refuse(`routing mismatch. ${routing.detail} Replaying it would measure an assistant that Push Latest Config does not write to.`);
  }
  if (routing.state !== "match") {
    throw refuse(`routing is ${routing.state}. ${routing.detail} Which assistant answers the line must be proven, not guessed.`);
  }
  const assistantId = routing.answeringAssistantId;
  if (!assistantId) {
    throw refuse("routing reported a match but named no answering assistant.");
  }
  if (routing.editTargetAssistantId !== assistantId) {
    throw refuse(`routing reported a match, but the line answers with ${assistantId} and the edit target is ${routing.editTargetAssistantId ?? "unset"}.`);
  }
  if (isRetiredAssistant(assistantId)) {
    throw refuse(`the line answers with ${assistantId}, which is a RETIRED assistant.`);
  }

  let res: Response;
  try {
    res = await readAssistant(assistantId);
  } catch (err) {
    throw refuse(`could not read assistant ${assistantId} from the provider (${reasonOf(err)}).`);
  }
  if (!res.ok) {
    throw refuse(`the provider returned HTTP ${res.status} for assistant ${assistantId}.`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw refuse(`the provider's response for assistant ${assistantId} is not JSON.`);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw refuse(`the provider's response for assistant ${assistantId} is not an assistant object.`);
  }
  const assistant = body as Record<string, unknown>;
  if (typeof assistant.id === "string" && assistant.id !== assistantId) {
    throw refuse(`asked the provider for assistant ${assistantId} and it returned ${assistant.id}.`);
  }
  if (!assistant.model || typeof assistant.model !== "object" || Array.isArray(assistant.model)) {
    throw refuse(`assistant ${assistantId} has no model block, so there is no system prompt to replay.`);
  }
  const model = assistant.model as Record<string, unknown>;
  const messages = Array.isArray(model.messages) ? model.messages : [];
  // updateAssistant pushes exactly one message (buildAssistantConfig). The
  // replay takes exactly one system prompt, so a second message would be text
  // callers hear that the baseline silently drops: refuse rather than label it.
  if (messages.length > 1) {
    throw refuse(
      `assistant ${assistantId} serves ${messages.length} model messages; the replay carries exactly one system prompt, so a baseline from messages[0] alone would omit text callers hear.`,
    );
  }
  const first = messages[0] && typeof messages[0] === "object" ? (messages[0] as Record<string, unknown>) : null;
  if (first && first.role !== "system") {
    const role = typeof first.role === "string" ? `role "${first.role}"` : "no role";
    throw refuse(`assistant ${assistantId}'s first model message has ${role}, not "system".`);
  }
  const prompt = first && typeof first.content === "string" ? first.content : "";
  if (!prompt.trim()) {
    throw refuse(`assistant ${assistantId} has no system prompt at model.messages[0].content.`);
  }

  let currentLessons: string | null;
  try {
    currentLessons = await readLessons();
  } catch (err) {
    currentLessons = null;
    log.warn("current lessons unreadable; parity label falls back to the shape check", { error: reasonOf(err) });
  }
  const { parity, detail, lessonsSuffix } = classifyPromptParity(prompt, ASSISTANT_SYSTEM_PROMPT, currentLessons);

  const meta =
    assistant.metadata && typeof assistant.metadata === "object" && !Array.isArray(assistant.metadata)
      ? (assistant.metadata as Record<string, unknown>)
      : {};
  const providerBehaviorHash = typeof meta.nickBehaviorHash === "string" && meta.nickBehaviorHash ? meta.nickBehaviorHash : null;
  const providerBehaviorSchema =
    typeof meta.nickBehaviorSchema === "string" && meta.nickBehaviorSchema ? meta.nickBehaviorSchema : null;

  const baseline: ReceptionistBaseline = {
    source: "live_provider",
    assistantId,
    prompt,
    promptHash: hashPrompt(prompt),
    providerBehaviorHash,
    providerBehaviorSchema,
    parity,
    parityDetail: detail,
    lessonsSuffix,
    liveLane: laneOf(model),
    fetchedAt: new Date().toISOString(),
  };
  log.info("live receptionist baseline resolved", {
    assistantId,
    promptHash: baseline.promptHash,
    parity,
    providerBehaviorHash,
    model: baseline.liveLane.model,
  });
  return baseline;
}

/**
 * The code constant in the baseline shape, for EXPLICIT offline CLI use only
 * (no provider credentials, or a deliberate "what would the code do" run). It
 * is not what callers hear: it omits the lessons block and dashboard settings.
 * liveLane here is the lane the code WOULD push (buildAssistantConfig), not an
 * observation.
 */
export function repositoryBaseline(): ReceptionistBaseline {
  const model = buildAssistantConfig().model as unknown as Record<string, unknown>;
  return {
    source: "repository",
    assistantId: null,
    prompt: ASSISTANT_SYSTEM_PROMPT,
    promptHash: hashPrompt(ASSISTANT_SYSTEM_PROMPT),
    providerBehaviorHash: null,
    providerBehaviorSchema: null,
    parity: "identical",
    parityDetail:
      "Repository constant ASSISTANT_SYSTEM_PROMPT, not read from the provider: it omits the learned-lessons block and dashboard settings callers hear.",
    lessonsSuffix: "",
    liveLane: laneOf(model),
    fetchedAt: new Date().toISOString(),
  };
}

function shown(value: string | number | null): string {
  return value === null ? "unset" : String(value);
}

/**
 * Pure: every way the replay lane differs from the live lane, one sentence
 * each (model, temperature, maxTokens, tools; tools compared as a set).
 * parity is true only when there are no differences. The replay lane
 * defaults to REPLAY_LANE.
 */
export function describeLaneParity(
  liveLane: ReceptionistLane,
  replayLane: Readonly<ReplayLane> = REPLAY_LANE,
): { parity: boolean; differences: string[] } {
  const differences: string[] = [];
  if (liveLane.model !== replayLane.model) {
    const live = liveLane.provider ? `${liveLane.provider}/${shown(liveLane.model)}` : shown(liveLane.model);
    differences.push(`model: live ${live} vs replay ${replayLane.model}`);
  }
  if (liveLane.temperature !== replayLane.temperature) {
    differences.push(`temperature: live ${shown(liveLane.temperature)} vs replay ${replayLane.temperature}`);
  }
  if (liveLane.maxTokens !== replayLane.maxTokens) {
    differences.push(`maxTokens: live ${shown(liveLane.maxTokens)} vs replay ${replayLane.maxTokens}`);
  }
  const liveTools = new Set(liveLane.toolNames);
  const replayTools = new Set(replayLane.tools);
  const sameTools = liveTools.size === replayTools.size && [...liveTools].every((t) => replayTools.has(t));
  if (!sameTools) {
    const list = (s: Set<string>) => (s.size ? [...s].join(", ") : "none");
    differences.push(`tools: live ${liveTools.size} (${list(liveTools)}) vs replay ${replayTools.size} (${list(replayTools)})`);
  }
  return { parity: differences.length === 0, differences };
}
