/**
 * Memory-eval dataset — the truth scoreboard's questions.
 *
 * Each eval asserts a current-truth fact Statenour must know. `groundingDoc`
 * points at the repo doc that should TEACH it, so `pnpm eval:memory` can grade
 * deterministically (no LLM). Behavioral evals ground against the agent
 * runbooks (docs/runbooks/*, shipped in the same wave) — they read as "manual"
 * until those files exist.
 *
 * To add an eval: append here, keep the id unique, give expectedFacts robust
 * tokens, and (ideally) a groundingDoc. Tests enforce dataset validity.
 */

import type { MemoryEval } from "./memory-eval-types";

const CURRENT_TRUTH = "docs/CURRENT-TRUTH.md";
const AGENTS = "AGENTS.md";

export const MEMORY_EVALS: MemoryEval[] = [
  // ── deployment_truth ──────────────────────────────────────────────
  {
    id: "deploy-prod-source",
    category: "deployment_truth",
    question: "Where does Statenour production deploy from?",
    expectedFacts: ["main", "railway", "bdnick.info"],
    forbiddenClaims: ["deploys to vercel", "deployed on vercel", "codex/ollama-local", "statenour-master"],
    severity: "critical",
    sourceHints: [CURRENT_TRUTH, "config/crons.ts header"],
    groundingDoc: CURRENT_TRUTH,
    tags: ["deploy"],
  },
  {
    id: "deploy-retired",
    category: "deployment_truth",
    question: "Which repos/branches/platforms are retired for Statenour production?",
    expectedFacts: ["codex/ollama-local", "statenour-master", "statenour-os", "vercel"],
    forbiddenClaims: [],
    severity: "critical",
    sourceHints: [CURRENT_TRUTH],
    groundingDoc: CURRENT_TRUTH,
    tags: ["deploy", "retired"],
  },
  {
    id: "deploy-local-path",
    category: "deployment_truth",
    question: "What is the canonical local checkout path?",
    expectedFacts: ["nourcity"],
    forbiddenClaims: ["c:\\users\\nourd\\nour-os"],
    severity: "high",
    sourceHints: [CURRENT_TRUTH],
    groundingDoc: CURRENT_TRUTH,
    tags: ["deploy", "path"],
  },

  // ── source_of_truth ───────────────────────────────────────────────
  {
    id: "sot-read-first",
    category: "source_of_truth",
    question: "What should an agent read first for current truth?",
    expectedFacts: ["current-truth", "agents.md", "reconciliation"],
    forbiddenClaims: [],
    severity: "high",
    sourceHints: [CURRENT_TRUTH, AGENTS],
    groundingDoc: CURRENT_TRUTH,
    tags: ["sot"],
  },
  {
    id: "sot-conflict-wins",
    category: "source_of_truth",
    question: "If a historical doc conflicts with RECONCILIATION/live code, which wins?",
    expectedFacts: ["live code", "reconciliation"],
    forbiddenClaims: [],
    severity: "high",
    sourceHints: [CURRENT_TRUTH],
    groundingDoc: CURRENT_TRUTH,
    tags: ["sot"],
  },
  {
    id: "sot-cron-source",
    category: "source_of_truth",
    question: "What is the current cron source of truth?",
    expectedFacts: ["config/crons.ts", "check:crons"],
    forbiddenClaims: [],
    severity: "medium",
    sourceHints: [CURRENT_TRUTH, "config/crons.ts"],
    groundingDoc: CURRENT_TRUTH,
    tags: ["sot", "cron"],
  },
  {
    id: "sot-repo-source",
    category: "source_of_truth",
    question: "What is the current repo source of truth?",
    expectedFacts: ["config/repos.ts", "repo-map"],
    forbiddenClaims: [],
    severity: "medium",
    sourceHints: [CURRENT_TRUTH, "config/repos.ts"],
    groundingDoc: CURRENT_TRUTH,
    tags: ["sot", "repo"],
  },

  // ── stale_doc_detection ───────────────────────────────────────────
  {
    id: "stale-archive-rule",
    category: "stale_doc_detection",
    question: "Can an archived doc be pasted into an agent as current context?",
    expectedFacts: ["never paste", "archived"],
    forbiddenClaims: [],
    severity: "high",
    sourceHints: [CURRENT_TRUTH],
    groundingDoc: CURRENT_TRUTH,
    tags: ["stale"],
  },
  {
    id: "stale-guard",
    category: "stale_doc_detection",
    question: "What catches stale deploy/provider claims in active docs?",
    expectedFacts: ["check:stale-docs"],
    forbiddenClaims: [],
    severity: "medium",
    sourceHints: [CURRENT_TRUTH, "scripts/check-stale-docs.ts"],
    groundingDoc: CURRENT_TRUTH,
    tags: ["stale", "guard"],
  },

  // ── migration_safety ──────────────────────────────────────────────
  {
    id: "mig-column-first",
    category: "migration_safety",
    question: "What is the migration discipline before code reads new DB columns?",
    expectedFacts: ["column-first"],
    forbiddenClaims: ["accept-data-loss"],
    severity: "critical",
    sourceHints: [CURRENT_TRUTH, "docs/DB-MIGRATION-POLICY.md"],
    groundingDoc: CURRENT_TRUTH,
    tags: ["migration"],
  },
  {
    id: "mig-applied-claim",
    category: "migration_safety",
    question: "When can you claim a migration is applied to prod?",
    expectedFacts: ["apply-pending-migration", "migrate status"],
    forbiddenClaims: [],
    severity: "high",
    sourceHints: [CURRENT_TRUTH],
    groundingDoc: CURRENT_TRUTH,
    tags: ["migration", "honesty"],
  },
  {
    id: "mig-no-data-loss",
    category: "migration_safety",
    question: "What must you never do, because it silently drops pgvector/tsvector?",
    expectedFacts: ["accept-data-loss", "pgvector"],
    forbiddenClaims: [],
    severity: "critical",
    sourceHints: [CURRENT_TRUTH, AGENTS],
    groundingDoc: CURRENT_TRUTH,
    tags: ["migration", "pgvector"],
  },

  // ── action_honesty ────────────────────────────────────────────────
  {
    id: "action-tool-call-required",
    category: "action_honesty",
    question: "What must Nick have before claiming a past-tense action (created/sent/done)?",
    expectedFacts: ["tool call"],
    forbiddenClaims: [],
    severity: "critical",
    sourceHints: [`${AGENTS} (fabrication-defense stack)`, "lib/ai/system-prompt.ts TRUTH RULE"],
    groundingDoc: AGENTS,
    tags: ["honesty"],
  },
  {
    id: "action-fab-stack",
    category: "action_honesty",
    question: "What system defends against fabricated action claims?",
    expectedFacts: ["fabrication-defense"],
    forbiddenClaims: [],
    severity: "high",
    sourceHints: [`${AGENTS} §4`],
    groundingDoc: AGENTS,
    tags: ["honesty"],
  },

  // ── task_classification (grounds against the P6 runbook) ──────────
  {
    id: "taskcls-no-bulk-learn",
    category: "task_classification",
    question: "Should the classifier learn re-file examples from bulk task-migration moves?",
    expectedFacts: ["bulk", "do not learn"],
    forbiddenClaims: [],
    severity: "high",
    sourceHints: ["docs/runbooks/task-classifier-domain-missions.md"],
    groundingDoc: "docs/runbooks/task-classifier-domain-missions.md",
    tags: ["classifier"],
  },
  {
    id: "taskcls-general-protected",
    category: "task_classification",
    question: "Which classifier anchors are protected from drift?",
    expectedFacts: ["general"],
    forbiddenClaims: [],
    severity: "medium",
    sourceHints: ["docs/runbooks/task-classifier-domain-missions.md"],
    groundingDoc: "docs/runbooks/task-classifier-domain-missions.md",
    tags: ["classifier"],
  },

  // ── memory_kind ───────────────────────────────────────────────────
  {
    id: "memkind-workflow-procedural",
    category: "memory_kind",
    question: "What kind of memory stores workflow/operating rules?",
    expectedFacts: ["procedural"],
    forbiddenClaims: [],
    severity: "low",
    sourceHints: ["docs/runbooks/memory-evals.md", "semantic/episodic/procedural"],
    groundingDoc: "docs/runbooks/memory-evals.md",
    tags: ["memory"],
  },

  // ── business_context ──────────────────────────────────────────────
  {
    id: "biz-purpose",
    category: "business_context",
    question: "What is Statenour and who is it for?",
    expectedFacts: ["personal", "nour"],
    forbiddenClaims: [],
    severity: "low",
    sourceHints: [AGENTS, CURRENT_TRUTH],
    groundingDoc: AGENTS,
    tags: ["context"],
  },
  {
    id: "biz-companion",
    category: "business_context",
    question: "What is the companion business app and where does it live?",
    expectedFacts: ["nickstire", "apps/nickstire"],
    forbiddenClaims: [],
    severity: "medium",
    sourceHints: [CURRENT_TRUTH, "docs/runbooks/nickstire-vs-statenour-boundary.md"],
    groundingDoc: CURRENT_TRUTH,
    tags: ["context", "boundary"],
  },

  // ── personal_os_context ───────────────────────────────────────────
  {
    id: "pos-no-relationship-nag",
    category: "personal_os_context",
    question: "Should Statenour surface a blunt 'Dania N-days-silent' relationship nag?",
    expectedFacts: ["guardrail"],
    // The nag was scrubbed from all live surfaces (2026-06-03). Nick must never
    // re-introduce it. Graded via gradeAnswer; manual on the doc path.
    forbiddenClaims: ["dania neglect nudge", "marriage health"],
    severity: "high",
    sourceHints: ["RECONCILIATION relationship-nag scrub wave (2026-06-03)"],
    tags: ["privacy", "guardrail"],
  },

  // ── provider_truth ────────────────────────────────────────────────
  {
    id: "prov-source",
    category: "provider_truth",
    question: "Where is the current AI provider/model truth?",
    expectedFacts: ["lib/ai/provider.ts", "ai_provider"],
    forbiddenClaims: ["venice primary", "glm-4.7"],
    severity: "high",
    sourceHints: [CURRENT_TRUTH, "lib/ai/provider.ts"],
    groundingDoc: CURRENT_TRUTH,
    tags: ["provider"],
  },
  {
    id: "prov-no-hardcode",
    category: "provider_truth",
    question: "Should a doc hardcode a specific model name as current?",
    expectedFacts: ["do not", "provider.ts"],
    forbiddenClaims: [],
    severity: "medium",
    sourceHints: [CURRENT_TRUTH],
    groundingDoc: CURRENT_TRUTH,
    tags: ["provider"],
  },

  // ── source_of_truth / claude-code session (grounds against P6 runbook) ──
  {
    id: "cc-session-start",
    category: "source_of_truth",
    question: "What should a Claude Code session do before editing here?",
    expectedFacts: ["git status", "worktree", "verify"],
    forbiddenClaims: [],
    severity: "medium",
    sourceHints: ["docs/runbooks/statenour-claude-code-session.md"],
    groundingDoc: "docs/runbooks/statenour-claude-code-session.md",
    tags: ["session"],
  },
];
