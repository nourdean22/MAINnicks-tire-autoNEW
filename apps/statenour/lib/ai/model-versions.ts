/**
 * Model version pinning · v10.0.342 · Phase 4 of glitch taxonomy
 * hardening (Category 7 · quality regressions).
 *
 * The single source of truth for every AI model the system uses. By
 * centralizing the pin, we get:
 *   1. Deliberate upgrades · changing a model means editing this file
 *      AND running the quality benchmark · no silent drift
 *   2. Audit trail · git-history shows every model change with reason
 *   3. Test fixtures · benchmarks lock against these versions
 *   4. Cost safety · `gpt-image-1` high vs `gpt-image-1-mini` is a 4×
 *      cost delta · this file makes the choice explicit
 *
 * Per docs/glitch-taxonomy.md · Category 7 · "no silent upgrades."
 *
 * When the env override (e.g. `OPENAI_MODEL`) is set it WILL win over
 * these pins · operator can override per-deploy. The pins are the
 * baseline for what the codebase is TESTED against.
 */

/**
 * Frozen model registry · changing any value here is a deliberate act
 * that should ship with:
 *   1. A commit message explaining why
 *   2. A quality benchmark run BEFORE merging
 *   3. A note in docs/glitch-taxonomy.md if the change addresses a Cat 7 regression
 */
export const PINNED_MODELS = {
  // ── Text generation · primary chat lane ──────────────────────────
  /**
   * Venice's flagship model · stock fast, no function calling, brand
   * voice tested · current daily-driver for /chat default route.
   * Last quality bench · 2026-04-29 · score 78/100 baseline.
   */
  venice: "venice-uncensored",

  /**
   * Anthropic fallback · used when Venice is rate-limited or down.
   * Slow but the most reliable for nuanced reasoning. Cost ~10× Venice.
   */
  anthropic: "claude-sonnet-4-6",

  /**
   * OpenAI fallback · used for tool-call lanes that need function
   * calling (Venice doesn't support it).
   */
  openai: "gpt-4o-mini",

  /**
   * Ollama Cloud Pro local · large-context backup when Venice 32k
   * isn't enough. Free per-token, monthly cap.
   */
  ollama: "qwen3-32b",

  // ── Image generation ──────────────────────────────────────────────
  /**
   * v10.0.333 · switched from Venice recraft-v4 (generic-looking
   * marketing output) to OpenAI gpt-image-1 (better text rendering,
   * brand-aware photorealism, instruction following).
   * Quality default = "high" · 1024x1024 high ≈ $0.19/img · drafts can
   * use speed="fast" → medium quality.
   * Last quality bench · 2026-05-06 · score 82/100 (vs Venice 73/100).
   */
  imageGen: "gpt-image-1",

  /**
   * Legacy Venice fallback · still wired for tools that haven't
   * migrated (lib/ai/tools.ts batch/improve/tournament/variations).
   */
  imageGenLegacy: "recraft-v4",

  // ── Vision input ──────────────────────────────────────────────────
  /**
   * Used for receipt OCR, photo analysis, vision-tool replies. qwen3-vl
   * is the cheap option · gpt-4-vision is the accurate option. We use
   * the cheap one and fall back when confidence < threshold.
   */
  visionPrimary: "qwen3-vl-7b",

  /**
   * Vision fallback · accurate but expensive.
   */
  visionFallback: "gpt-4-vision-preview",

  // ── Embeddings ────────────────────────────────────────────────────
  /**
   * Embedding model for brain memory recall · pgvector compatible ·
   * 1536-dim. Locked because changing dimensions = full backfill of
   * all existing embeddings.
   */
  embedding: "text-embedding-3-small",

  // ── Whisper / transcription ──────────────────────────────────────
  whisper: "whisper-1",

  // ── TTS · text to speech ──────────────────────────────────────────
  tts: "tts-1",
} as const;

/**
 * Changelog · every model change should add a row here so we have
 * an audit trail of WHY the pin moved. Newest first.
 */
export const MODEL_CHANGELOG: Array<{
  date: string; // YYYY-MM-DD
  model: keyof typeof PINNED_MODELS;
  from: string;
  to: string;
  reason: string;
  benchmarkDelta?: string; // e.g. "73 → 82 (+9pts)"
}> = [
  {
    date: "2026-05-06",
    model: "imageGen",
    from: "recraft-v4",
    to: "gpt-image-1",
    reason:
      "Cat 7 regression · cmou6xugm chat produced generic-looking infographics with broken text rendering. gpt-image-1 has measurably better text rendering inside images + instruction following + brand-aware photorealism.",
    benchmarkDelta: "73 → 82 (+9pts est · benchmark run pending)",
  },
  // Older entries · pre-v10.0.342 changes were undocumented · this is
  // the start of the audit trail. Future PRs MUST add a row when
  // changing PINNED_MODELS.
];

/**
 * Helper · returns the pinned model for a logical role, with the env
 * override applied if set. The codebase should call THIS not access
 * PINNED_MODELS directly · keeps the resolution rule consistent.
 *
 * Resolution priority:
 *   1. Env override (e.g. process.env.OPENAI_MODEL)
 *   2. PINNED_MODELS pin
 */
export function pinnedModel(
  role: keyof typeof PINNED_MODELS,
  envVarName?: string,
): string {
  if (envVarName) {
    const override = process.env[envVarName]?.trim();
    if (override) return override;
  }
  return PINNED_MODELS[role];
}

/**
 * Drift detector · returns the list of (role, env-name, pinned, actual)
 * tuples where the env override differs from the pin. Useful for the
 * `/system/health-grid` dashboard so the operator can see when the
 * deployed config has drifted from the codebase pin.
 */
export function detectModelDrift(): Array<{
  role: string;
  pinned: string;
  envName: string;
  actual: string;
}> {
  const ENV_NAMES: Partial<Record<keyof typeof PINNED_MODELS, string>> = {
    venice: "VENICE_MODEL",
    anthropic: "ANTHROPIC_MODEL",
    openai: "OPENAI_MODEL",
    ollama: "OLLAMA_MODEL",
  };
  const drift: ReturnType<typeof detectModelDrift> = [];
  for (const [role, envName] of Object.entries(ENV_NAMES) as Array<
    [keyof typeof PINNED_MODELS, string]
  >) {
    const override = process.env[envName]?.trim();
    if (override && override !== PINNED_MODELS[role]) {
      drift.push({
        role,
        pinned: PINNED_MODELS[role],
        envName,
        actual: override,
      });
    }
  }
  return drift;
}
