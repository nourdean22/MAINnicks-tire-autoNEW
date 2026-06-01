/**
 * Task → linkage classifier · 2026-06-01 (supersedes classify-task-mission).
 *
 * Given a quick-add/created task and the operator's active missions, goals,
 * and the mastery stat catalog, returns the best-fit mission + goal + the
 * stat(s) the task should feed. This is the fix for "tasks don't correlate
 * to a goal or feed stats" — the old classifier only knew about missions.
 *
 * Used by `enrichTaskLinkage` (server-side, on every creation path) as a
 * GAP-FILL: it only proposes links for fields still null/Inbox/empty, and
 * the caller compare-and-sets so it never overrides a deliberate choice.
 *
 *   ≥ CONFIDENCE.silentAttach → silent attach
 *   < CONFIDENCE.silentAttach → caller surfaces an "attach to X?" chip
 *
 * Failure mode → a deterministic keyword fallback (never throws), so a
 * classifier outage degrades to "best-effort heuristic", not "no linkage".
 */

import "server-only";

import { tracedAiChat } from "@/lib/ai/traced-aichat";

export interface ClassifyLinkageInput {
  taskTitle: string;
  nextPhysicalAction?: string | null;
  missions: Array<{ id: string; title: string; domain?: string | null }>;
  goals: Array<{ id: string; title: string; domain?: string | null }>;
  /** The mastery stat catalog (key + human label) to choose statHints from. */
  stats: Array<{ key: string; label: string }>;
}

export interface ClassifyLinkageResult {
  /** Best-fit mission id · null when none even weakly relates. */
  missionId: string | null;
  /** Best-fit goal id · null when none relates (most tasks have no goal). */
  goalId: string | null;
  /** 1-2 stat keys this task builds (validated against the catalog). */
  statHints: string[];
  /** 0..1 confidence in the mission/goal picks (drives the chip threshold). */
  confidence: number;
  /** ≤120-char operator-readable "why". */
  rationale: string;
}

const EMPTY: ClassifyLinkageResult = {
  missionId: null,
  goalId: null,
  statHints: [],
  confidence: 0,
  rationale: "",
};

const SYSTEM_PROMPT = `You are an attention-routing classifier for an operator's
personal-OS. Given a task + the operator's active MISSIONS, active GOALS, and a
catalog of mastery STATS, return ONE JSON object linking the task:

{
  "missionId": "<one of the provided mission ids> | null",
  "goalId": "<one of the provided goal ids> | null",
  "statHints": ["<0-2 stat keys from the catalog>"],
  "confidence": 0.0-1.0,
  "rationale": "one short sentence on the fit (or why none)"
}

RULES:
- missionId: pick the best-fit mission; null ONLY if zero missions even weakly relate.
- goalId: pick a goal ONLY if the task genuinely advances it; null is common and fine.
- statHints: 0-2 stat KEYS (exact, from the catalog) the task builds. [] if unclear.
- confidence reflects the mission/goal fit: >0.85 obvious · 0.6-0.85 clear · <0.6 weak.
- rationale < 100 chars · plain language · no preamble.
- Return ONLY the JSON object · no markdown fences.`;

export async function classifyTaskLinkage(
  input: ClassifyLinkageInput,
): Promise<ClassifyLinkageResult> {
  const title = input.taskTitle.trim().slice(0, 200);
  if (!title) return EMPTY;
  const validStatKeys = new Set(input.stats.map((s) => s.key));

  // No missions AND no goals → nothing to link to; skip the AI call.
  if (input.missions.length === 0 && input.goals.length === 0) return EMPTY;

  try {
    const missionsBlock = input.missions
      .slice(0, 30)
      .map((m, i) => `${i + 1}. id="${m.id}" title="${m.title}"${m.domain ? ` domain="${m.domain}"` : ""}`)
      .join("\n");
    const goalsBlock = input.goals
      .slice(0, 30)
      .map((g, i) => `${i + 1}. id="${g.id}" title="${g.title}"${g.domain ? ` domain="${g.domain}"` : ""}`)
      .join("\n");
    const statsBlock = input.stats
      .map((s) => `${s.key} (${s.label})`)
      .join(", ");

    const userContent = [
      `TASK: ${title}`,
      input.nextPhysicalAction ? `FIRST STEP: ${input.nextPhysicalAction.slice(0, 160)}` : "",
      `\nACTIVE MISSIONS:\n${missionsBlock || "(none)"}`,
      `\nACTIVE GOALS:\n${goalsBlock || "(none)"}`,
      `\nSTAT CATALOG: ${statsBlock}`,
    ]
      .filter(Boolean)
      .join("\n");

    const result = await tracedAiChat(
      { label: "classify-task-linkage", source: "tool" },
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      "reason",
    );

    const text = result.content?.trim();
    if (!text) return fallbackLinkage(input);

    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const parsed = JSON.parse(cleaned) as Partial<ClassifyLinkageResult>;

    // Validate ids against the provided lists (drop hallucinations).
    const missionId =
      typeof parsed.missionId === "string" &&
      input.missions.some((m) => m.id === parsed.missionId)
        ? parsed.missionId
        : null;
    const goalId =
      typeof parsed.goalId === "string" &&
      input.goals.some((g) => g.id === parsed.goalId)
        ? parsed.goalId
        : null;
    const statHints = Array.isArray(parsed.statHints)
      ? parsed.statHints
          .filter((k): k is string => typeof k === "string" && validStatKeys.has(k))
          .slice(0, 2)
      : [];

    return {
      missionId,
      goalId,
      statHints,
      confidence: clamp01(Number(parsed.confidence ?? 0)),
      rationale: String(parsed.rationale ?? "").slice(0, 200),
    };
  } catch {
    return fallbackLinkage(input);
  }
}

/**
 * Deterministic keyword-overlap fallback — used when the AI call fails or
 * returns nothing. Picks the mission/goal whose title+domain shares the most
 * salient words with the task. Pure; statHints stay [] (completion-time
 * domain inference covers the stat). Exported for unit testing.
 */
export function fallbackLinkage(input: ClassifyLinkageInput): ClassifyLinkageResult {
  const taskWords = salientWords(`${input.taskTitle} ${input.nextPhysicalAction ?? ""}`);
  if (taskWords.size === 0) return EMPTY;

  const mission = bestMatch(taskWords, input.missions);
  const goal = bestMatch(taskWords, input.goals);
  // Confidence from the mission overlap (the primary link).
  const confidence = mission ? Math.min(0.55, 0.2 + mission.score * 0.1) : 0;

  return {
    missionId: mission?.id ?? null,
    goalId: goal && goal.score >= 2 ? goal.id : null, // goals need a stronger signal
    statHints: [],
    confidence,
    rationale: mission ? `keyword match · ${mission.score} shared term(s)` : "",
  };
}

const STOPWORDS = new Set([
  "the", "a", "an", "to", "for", "of", "and", "or", "with", "on", "in", "at",
  "my", "me", "i", "is", "be", "do", "get", "go", "up", "out", "this", "that",
  "call", "email", "text", "send", "add", "make", "set", "new",
]);

function salientWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

function bestMatch(
  taskWords: Set<string>,
  candidates: Array<{ id: string; title: string; domain?: string | null }>,
): { id: string; score: number } | null {
  let best: { id: string; score: number } | null = null;
  for (const c of candidates) {
    const cWords = salientWords(`${c.title} ${c.domain ?? ""}`);
    let score = 0;
    for (const w of cWords) if (taskWords.has(w)) score++;
    if (score > 0 && (!best || score > best.score)) best = { id: c.id, score };
  }
  return best;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
