/**
 * Task → linkage classifier · 2026-06-01, upgraded 2026-06-09 (domain-anchored).
 *
 * Given a quick-add/created task + the operator's active missions, goals, and
 * the mastery stat catalog, returns the best-fit mission + goal + stat hints +
 * the canonical life DOMAIN. Domain is ALWAYS resolved (one of the 6), so even
 * when no specific mission fits, the caller can drop the task into that
 * domain's GENERAL anchor instead of nowhere.
 *
 * Smarter (2026-06-09):
 *   · domain-first  — always returns a domain → correct GENERAL fallback.
 *   · richer signal — sees each mission's description + recent task titles, not
 *                     just the title, so it recognizes real projects.
 *   · learns        — few-shot from the operator's recent re-files
 *                     (recentExamples) so it adapts to their filing patterns.
 *
 * Used by `enrichTaskLinkage` (server-side, every creation path) as a GAP-FILL:
 * it only proposes links for fields still null/Inbox/empty; the caller
 * compare-and-sets so it never overrides a deliberate choice.
 *
 *   ≥ CONFIDENCE.silentAttach → silent attach
 *   < CONFIDENCE.silentAttach → caller surfaces an "attach to X?" chip
 *
 * Failure mode → a deterministic keyword fallback (never throws).
 */

import "server-only";

import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { isCanonicalDomain, type CanonicalDomain } from "@/lib/missions/domains";

export interface ClassifyLinkageInput {
  taskTitle: string;
  nextPhysicalAction?: string | null;
  /** Active user missions. `description` + `recentTasks` sharpen specific-vs-general. */
  missions: Array<{
    id: string;
    title: string;
    domain?: string | null;
    description?: string | null;
    recentTasks?: string[];
  }>;
  goals: Array<{ id: string; title: string; domain?: string | null }>;
  /** The mastery stat catalog (key + human label) to choose statHints from. */
  stats: Array<{ key: string; label: string }>;
  /** Few-shot: the operator's most-recent re-files (taskTitle → chosen mission/domain). */
  recentExamples?: Array<{ taskTitle: string; missionTitle: string; domain?: string | null }>;
}

export interface ClassifyLinkageResult {
  /** Best-fit mission id · null when none relates (caller uses the domain anchor). */
  missionId: string | null;
  /** Best-fit goal id · null when none relates (most tasks have no goal). */
  goalId: string | null;
  /** 1-2 stat keys this task builds (validated against the catalog). */
  statHints: string[];
  /** Canonical life domain (always one of the 6) — drives the GENERAL anchor fallback. */
  domain: CanonicalDomain;
  /** 0..1 confidence in the mission/goal picks (drives the chip threshold). */
  confidence: number;
  /** ≤120-char operator-readable "why". */
  rationale: string;
}

const EMPTY: ClassifyLinkageResult = {
  missionId: null,
  goalId: null,
  statHints: [],
  domain: "personal",
  confidence: 0,
  rationale: "",
};

const SYSTEM_PROMPT = `You are an attention-routing classifier for an operator's
personal-OS. Given a task + the operator's active MISSIONS, active GOALS, a
catalog of mastery STATS, and recent FILING EXAMPLES, return ONE JSON object:

{
  "missionId": "<one of the provided mission ids> | null",
  "goalId": "<one of the provided goal ids> | null",
  "statHints": ["<0-2 stat keys from the catalog>"],
  "domain": "health | mind | business | social | personal",
  "confidence": 0.0-1.0,
  "rationale": "one short sentence on the fit (or why none)"
}

RULES:
- domain: ALWAYS pick the best of the 5 (health=body/fitness/sleep/food · mind=
  focus/learning/emotions/faith/prayer/purpose · business=work/shop/money/marketing · social=people/
  relationships/family · personal=errands/home/admin/misc). Never null — when unsure, "personal".
- missionId: pick the best-fit SPECIFIC mission; null if none genuinely relates
  (the caller routes null to the domain's GENERAL mission — so don't force it).
- goalId: only if the task genuinely advances it; null is common and fine.
- statHints: 0-2 stat KEYS (exact, from the catalog) the task builds. [] if unclear.
- confidence reflects the MISSION fit: >0.85 obvious · 0.6-0.85 clear · <0.6 weak.
- Use the FILING EXAMPLES as precedent — if a similar task was filed to a mission
  before, prefer that pattern.
- rationale < 100 chars · plain · no preamble. Return ONLY the JSON, no fences.`;

export async function classifyTaskLinkage(
  input: ClassifyLinkageInput,
): Promise<ClassifyLinkageResult> {
  const title = input.taskTitle.trim().slice(0, 200);
  if (!title) return EMPTY;
  const validStatKeys = new Set(input.stats.map((s) => s.key));

  // No missions AND no goals → still resolve a domain via the keyword fallback.
  if (input.missions.length === 0 && input.goals.length === 0) {
    return fallbackLinkage(input);
  }

  try {
    const missionsBlock = input.missions
      .slice(0, 30)
      .map((m, i) => {
        const desc = m.description ? ` · ${m.description.slice(0, 80)}` : "";
        const recent =
          m.recentTasks && m.recentTasks.length > 0
            ? ` · recent: ${m.recentTasks.slice(0, 3).map((t) => t.slice(0, 40)).join("; ")}`
            : "";
        return `${i + 1}. id="${m.id}" title="${m.title}"${m.domain ? ` domain="${m.domain}"` : ""}${desc}${recent}`;
      })
      .join("\n");
    const goalsBlock = input.goals
      .slice(0, 30)
      .map((g, i) => `${i + 1}. id="${g.id}" title="${g.title}"${g.domain ? ` domain="${g.domain}"` : ""}`)
      .join("\n");
    const statsBlock = input.stats.map((s) => `${s.key} (${s.label})`).join(", ");
    const examplesBlock = (input.recentExamples ?? [])
      .slice(0, 15)
      .map((e) => `- "${e.taskTitle.slice(0, 60)}" -> ${e.missionTitle}${e.domain ? ` [${e.domain}]` : ""}`)
      .join("\n");

    const userContent = [
      `TASK: ${title}`,
      input.nextPhysicalAction ? `FIRST STEP: ${input.nextPhysicalAction.slice(0, 160)}` : "",
      `\nACTIVE MISSIONS:\n${missionsBlock || "(none)"}`,
      `\nACTIVE GOALS:\n${goalsBlock || "(none)"}`,
      `\nSTAT CATALOG: ${statsBlock}`,
      examplesBlock ? `\nRECENT FILING EXAMPLES (operator's own corrections):\n${examplesBlock}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const result = await tracedAiChat(
      { label: "classify-task-linkage", source: "tool" },
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      "classify",
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
    // Validate the domain against the canonical 6 · default to the fallback's pick.
    const domain = isCanonicalDomain(parsed.domain)
      ? parsed.domain
      : inferDomain(salientWords(`${input.taskTitle} ${input.nextPhysicalAction ?? ""}`));

    return {
      missionId,
      goalId,
      statHints,
      domain,
      confidence: clamp01(Number(parsed.confidence ?? 0)),
      rationale: String(parsed.rationale ?? "").slice(0, 200),
    };
  } catch {
    return fallbackLinkage(input);
  }
}

/**
 * Deterministic keyword-overlap fallback — used when the AI call fails/empty.
 * Picks the mission/goal whose title+domain shares the most salient words with
 * the task, and infers a canonical domain from keyword cues (defaults to
 * "personal"). Pure; exported for unit testing.
 */
export function fallbackLinkage(input: ClassifyLinkageInput): ClassifyLinkageResult {
  const taskWords = salientWords(`${input.taskTitle} ${input.nextPhysicalAction ?? ""}`);
  const domain = inferDomain(taskWords);
  if (taskWords.size === 0) return { ...EMPTY, domain };

  const mission = bestMatch(taskWords, input.missions);
  const goal = bestMatch(taskWords, input.goals);
  const confidence = mission ? Math.min(0.55, 0.2 + mission.score * 0.1) : 0;

  return {
    missionId: mission?.id ?? null,
    goalId: goal && goal.score >= 2 ? goal.id : null, // goals need a stronger signal
    statHints: [],
    domain,
    confidence,
    rationale: mission ? `keyword match · ${mission.score} shared term(s)` : "",
  };
}

/** Keyword → canonical domain (deterministic fallback for the domain field). */
const DOMAIN_CUES: Array<[CanonicalDomain, string[]]> = [
  ["health", ["workout", "gym", "run", "sleep", "diet", "doctor", "health", "water", "fitness", "meal", "stretch", "physio", "dentist"]],
  ["business", ["shop", "tire", "customer", "invoice", "lead", "sale", "client", "revenue", "marketing", "post", "content", "finance", "money", "bill", "vendor", "order", "estimate", "payroll"]],
  ["social", ["meet", "dinner", "family", "friend", "dania", "mom", "dad", "party", "reach", "birthday", "wedding"]],
  ["mind", ["read", "learn", "study", "course", "journal", "reflect", "focus", "think", "book", "skill", "pray", "prayer", "quran", "mosque", "faith", "meditate", "gratitude", "purpose"]],
];

function inferDomain(words: Set<string>): CanonicalDomain {
  for (const [domain, cues] of DOMAIN_CUES) {
    for (const cue of cues) if (words.has(cue)) return domain;
  }
  return "personal";
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
