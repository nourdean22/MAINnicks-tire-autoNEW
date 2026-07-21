/**
 * Environment validator — single source of truth for what statenour-os
 * needs from the environment.
 *
 * Usage:
 *   import { env } from "@/lib/env";        // validated, typed access
 *   import { describeEnvHealth } from "@/lib/env"; // human-readable status
 *
 * Philosophy — three tiers:
 *   REQUIRED  — boot fails loudly if missing
 *   RUNTIME   — feature degrades gracefully; warned once at startup
 *   PLATFORM  — auto-provided by Vercel / Node; never hand-set
 *
 * This file intentionally avoids runtime-heavy parsing. No Zod, no
 * network. It runs exactly once per lambda cold-start and writes to
 * console if anything looks off — then exports a typed `env` object.
 */

type Tier = "required" | "runtime" | "platform";

interface Spec {
  key: string;
  tier: Tier;
  description: string;
  /** If present, the variable is only required when `when(prod)` returns true.
   *  `prod` is the EFFECTIVE production flag for this check (from an explicit
   *  `mode` option or, failing that, the live environment). */
  when?: (prod: boolean) => boolean;
  /** Fallback env keys (legacy names). First non-empty wins. */
  aliases?: string[];
}

/**
 * Lazily evaluate the production flag. truth-substrate audit P0 (2026-07-21) ·
 * audit finding #13. The previous module-level `const PROD` was captured at
 * IMPORT time — but `scripts/check-env.ts --prod` sets `NODE_ENV=production`
 * AFTER importing this module (ES imports are hoisted + run first). So `PROD`
 * was always `false` there and every prod-only `when` guard silently no-opped:
 * `pnpm check:env:prod` validated nothing. Reading the env on each call fixes it,
 * and `checkEnvHealth({ mode })` lets callers force the mode without mutating env.
 */
export function isProd(): boolean {
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}

export const ENV_SPEC: Spec[] = [
  // ── REQUIRED ────────────────────────────────────────────────────────
  { key: "DATABASE_URL", tier: "required", description: "Neon pooled Postgres connection" },
  { key: "DIRECT_URL",   tier: "required", description: "Neon direct (non-pooled) connection for migrations" },

  // Auth — only required in production or when AUTH_SECRET is set
  { key: "AUTH_SECRET",              tier: "required", when: (prod) => prod, description: "NextAuth JWT signing secret" },
  { key: "AUTH_GOOGLE_CLIENT_ID",    tier: "required", when: (prod) => prod, description: "Google OAuth client id",     aliases: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_CLIENT_ID"] },
  { key: "AUTH_GOOGLE_CLIENT_SECRET",tier: "required", when: (prod) => prod, description: "Google OAuth client secret", aliases: ["GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"] },
  { key: "AUTH_ALLOWED_EMAIL",       tier: "required", when: (prod) => prod, description: "Single allowed operator email" },

  { key: "CRON_SECRET",         tier: "required", when: (prod) => prod, description: "Cron auth header (Railway cron / Inngest)" },
  { key: "STATENOUR_SYNC_KEY",  tier: "required", when: (prod) => prod, description: "Shared secret for /api/sync" },

  // AI — at least one provider must be set. Validated as a group below.
  { key: "OPENAI_API_KEY",    tier: "runtime", description: "Fallback AI provider" },
  { key: "ANTHROPIC_API_KEY", tier: "runtime", description: "Fallback AI provider" },
  { key: "GEMINI_API_KEY",    tier: "runtime", description: "Fallback AI provider", aliases: ["GOOGLE_GENERATIVE_AI_API_KEY"] },
  { key: "XAI_API_KEY",       tier: "runtime", description: "Optional xAI provider" },

  // ── RUNTIME (feature-degrades if missing) ──────────────────────────
  { key: "RESEND_API_KEY",      tier: "runtime", description: "Email delivery" },
  { key: "TELEGRAM_BOT_TOKEN",  tier: "runtime", description: "Telegram bot — enables push + command surface" },
  { key: "TELEGRAM_CHAT_ID",    tier: "runtime", description: "Nour's Telegram chat id" },
  { key: "TWILIO_ACCOUNT_SID",  tier: "runtime", description: "SMS sender" },
  { key: "TWILIO_AUTH_TOKEN",   tier: "runtime", description: "SMS sender" },
  { key: "BRIDGE_API_KEY",      tier: "runtime", description: "nickstire admin bridge" },
  { key: "REDIS_URL",           tier: "runtime", description: "L2 cache — app degrades to in-memory L1 without it" },
  { key: "VAPID_PUBLIC_KEY",    tier: "runtime", description: "Web push — PWA" },
  { key: "VAPID_PRIVATE_KEY",   tier: "runtime", description: "Web push — PWA" },
  { key: "GOOGLE_PLACES_API_KEY", tier: "runtime", description: "GBP reviews feed" },
  { key: "OPENWEATHER_API_KEY", tier: "runtime", description: "Weather brain engine" },
  { key: "APOLLO_API_KEY",      tier: "runtime", description: "Contact enrichment" },
  { key: "STRIPE_SECRET_KEY",   tier: "runtime", description: "Payments" },
  { key: "STRIPE_WEBHOOK_SECRET", tier: "runtime", description: "Payments webhook" },

  // Public URL — critical for OAuth callback + email links
  { key: "NEXT_PUBLIC_APP_URL", tier: "runtime", description: "Public origin for absolute links" },

  // Optional override
  { key: "AI_PROVIDER", tier: "runtime", description: "Pin AI provider: ollama|gemini|openai|anthropic" },
  { key: "LOCAL_DEV_BYPASS_AUTH", tier: "runtime", description: "Dev-only — set to '1' to skip auth in preview" },

  // ── WAVE-200 substrate (2026-05-17) ────────────────────────────────
  // All runtime · substrate degrades gracefully when missing. See
  // docs/WAVE-200-PLAN.md + per-substrate ADRs for activation.
  { key: "BRAINTRUST_API_KEY",      tier: "runtime", description: "Wave-200 Phase 0 · enables Mastra agent traces in Braintrust dashboard" },
  { key: "BRAINTRUST_PROJECT_NAME", tier: "runtime", description: "Wave-200 Phase 0 · Braintrust project name (default: statenour-nick)" },
  { key: "INNGEST_EVENT_KEY",       tier: "runtime", description: "Wave-200 Phase 3 · Inngest event-send key (paste from app.inngest.com → app → keys)" },
  { key: "INNGEST_SIGNING_KEY",     tier: "runtime", description: "Wave-200 Phase 3 · Inngest signing key (paste from app.inngest.com → app → keys)" },
  { key: "LIVEKIT_URL",             tier: "runtime", description: "Wave-200 Phase 4 · LiveKit Cloud project URL (used by /api/voice/token + apps/voice worker)" },
  { key: "LIVEKIT_API_KEY",         tier: "runtime", description: "Wave-200 Phase 4 · LiveKit API key" },
  { key: "LIVEKIT_API_SECRET",      tier: "runtime", description: "Wave-200 Phase 4 · LiveKit API secret" },

  // ── Operational / Tooling (read by scripts + runtime surfaces) ───────
  { key: "APP_BASE_URL",              tier: "runtime", description: "Internal base URL for cron-generated links (falls back to NEXT_PUBLIC_APP_URL)" },
  { key: "BUILD_TIME",                tier: "runtime", description: "Deploy/build timestamp for health digest" },
  { key: "DAILY_AI_BUDGET_CENTS",     tier: "runtime", description: "Daily AI spend cap in cents — cost SLO gate" },
  { key: "DEBUG_SQL",                 tier: "runtime", description: "Set to '1' to log raw Prisma SQL queries" },
  { key: "NARRATOR_LLM_SYNTHESIS",    tier: "runtime", description: "Set to '1' to enable Ultron narrator LLM synthesis" },
  { key: "NICK_PRIME_PROMPT",         tier: "runtime", description: "Toggle Nick prime prompt variant ('1' / '0')" },
  { key: "OPERATOR_EMAIL",            tier: "runtime", description: "Fallback operator email for brain preference inference" },
  { key: "GEMINI_MODEL",              tier: "runtime", description: "Override Gemini model for Google Search integration" },
  { key: "ALLOW_PROD_WRITES",         tier: "runtime", description: "Dangerous script gate — set to '1' to permit prod mutations" },
  { key: "CONFIRM_PROD",              tier: "runtime", description: "Dangerous script gate — set to '1' to confirm prod operations" },
  { key: "POLICY_GATE_HARD",          tier: "runtime", description: "CI gate — set to '1' to enforce hard policy checks" },
  { key: "POLICY_GATE_SOFT",          tier: "runtime", description: "CI gate — set to '1' to enforce soft policy warnings" },
  { key: "PRE_PUSH_SKIP",             tier: "runtime", description: "Dev escape hatch — set to '1' to skip pre-push checks locally" },

  // ── PLATFORM (auto-set) ────────────────────────────────────────────
  { key: "NODE_ENV",              tier: "platform", description: "development | production | test" },
  { key: "VERCEL",                tier: "platform", description: "Vercel runtime indicator" },
  { key: "VERCEL_ENV",            tier: "platform", description: "production | preview | development" },
  { key: "VERCEL_URL",            tier: "platform", description: "Current deployment URL" },
  { key: "VERCEL_GIT_COMMIT_SHA", tier: "platform", description: "Deployed commit SHA" },
];

/** Read a spec's value considering aliases. First non-empty wins. */
function readValue(s: Spec): string | undefined {
  if (process.env[s.key]) return process.env[s.key];
  for (const alias of s.aliases ?? []) {
    if (process.env[alias]) return process.env[alias];
  }
  return undefined;
}

interface EnvHealth {
  missing: { key: string; description: string; aliases?: string[] }[];
  degraded: { key: string; description: string }[];
  atLeastOneAiProvider: boolean;
}

/** Options for env validation. `mode` forces the production flag so callers
 *  (scripts, tests) don't have to mutate NODE_ENV before the module loads. */
export interface EnvCheckOptions {
  mode?: "production" | "development";
}

/** Resolve the effective production flag: explicit `mode` wins, else the live env. */
function resolveProd(opts?: EnvCheckOptions): boolean {
  if (opts?.mode) return opts.mode === "production";
  return isProd();
}

export function checkEnvHealth(opts?: EnvCheckOptions): EnvHealth {
  const missing: EnvHealth["missing"] = [];
  const degraded: EnvHealth["degraded"] = [];
  const prod = resolveProd(opts);

  for (const spec of ENV_SPEC) {
    if (spec.tier === "platform") continue;
    const required = spec.tier === "required" && (spec.when ? spec.when(prod) : true);
    const value = readValue(spec);
    if (!value) {
      if (required) missing.push({ key: spec.key, description: spec.description, aliases: spec.aliases });
      else degraded.push({ key: spec.key, description: spec.description });
    }
  }

  const aiKeys = ["OLLAMA_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"];
  const atLeastOneAiProvider = aiKeys.some((k) => process.env[k] || process.env.GOOGLE_GENERATIVE_AI_API_KEY);

  return { missing, degraded, atLeastOneAiProvider };
}

export function describeEnvHealth(opts?: EnvCheckOptions): string {
  const h = checkEnvHealth(opts);
  const lines: string[] = [];
  lines.push(`env · ${resolveProd(opts) ? "production" : "development"}`);
  if (h.missing.length) {
    lines.push(`  ❌ ${h.missing.length} REQUIRED missing:`);
    for (const m of h.missing) lines.push(`     · ${m.key} — ${m.description}`);
  } else {
    lines.push(`  ✅ all required present`);
  }
  if (!h.atLeastOneAiProvider) {
    lines.push(`  ❌ no AI provider key set — Nick is dead`);
  }
  if (h.degraded.length) {
    lines.push(`  ⚠️  ${h.degraded.length} optional (feature degrades):`);
    for (const d of h.degraded.slice(0, 5)) lines.push(`     · ${d.key} — ${d.description}`);
    if (h.degraded.length > 5) lines.push(`     · (+${h.degraded.length - 5} more)`);
  }
  return lines.join("\n");
}

/** Throws at boot if any required env var is missing. */
export function assertEnvOrDie(opts?: EnvCheckOptions): void {
  const h = checkEnvHealth(opts);
  const fatal = h.missing.length > 0 || !h.atLeastOneAiProvider;
  if (fatal) {
    const lines: string[] = ["FATAL: environment check failed"];
    for (const m of h.missing) lines.push(`  missing ${m.key} (${m.description})`);
    if (!h.atLeastOneAiProvider) lines.push(`  no AI provider key set`);
    throw new Error(lines.join("\n"));
  }
}

/** Typed accessor for the keys the app actually reads. */
export const env = {
  get DATABASE_URL() { return process.env.DATABASE_URL ?? ""; },
  get DIRECT_URL()   { return process.env.DIRECT_URL ?? ""; },
  get NEXT_PUBLIC_APP_URL() {
    return process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://bdnick.info";
  },
  get NICKS_ADMIN_URL() { return process.env.NICKS_ADMIN_URL || "https://nickstire.org/admin"; },
  get IS_PROD() { return isProd(); },
  // truth-substrate audit #11/#14: removed the dead IS_VERCEL getter (zero
  // consumers; always false on Railway — it only perpetuated the wrong platform
  // model). Deploy identity comes from lib/services/deploy-identity.ts.
};
