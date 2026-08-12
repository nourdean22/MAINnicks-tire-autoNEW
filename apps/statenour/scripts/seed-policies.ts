/**
 * Seed the AutomationPolicy registry from real source files.
 *
 * v10.0.148 · May 03 · Slice #1 of the post-audit consolidation wave.
 *
 * Sources:
 *   1. config/crons.ts          → cron.<name>     (one policy per active/folded cron)
 *   2. CURATED_NON_CRON below   → tool.<name>, slash.<name>, webhook.<name>,
 *                                  autonomous-action.<name>
 *
 * Idempotent — safe to re-run. Each upsert refreshes the declarative
 * fields (objective/trigger/inputs/rollback/successMetric/tags) but
 * preserves operator-edited approvalClass/enabled/notes.
 *
 * Usage:
 *   set -a && . ./.env.local && set +a
 *   pnpm tsx scripts/seed-policies.ts
 *   pnpm tsx scripts/seed-policies.ts --dry-run   # preview only
 */

import { CRONS, type CronDef } from "@/config/crons";
import {
  upsertPolicy,
  type PolicyUpsertInput,
  type ApprovalClass,
} from "@/lib/automation/policy";

const DRY_RUN = process.argv.includes("--dry-run");

// ─── Heuristic derivation for crons ──────────────────────────────────

/**
 * Map cron category → success metric template. Each cron's actual
 * success criterion is described in operator-readable terms — the
 * thing you'd want to see on a status dashboard, not the raw
 * "exit code 0."
 */
const CATEGORY_SUCCESS: Record<string, string> = {
  ingest:
    "Source rows pulled into the brain in the last 24h (>0 unless source is silent).",
  brain:
    "Memory layer mutated meaningfully in the last 24h — new memories added, beliefs refreshed, or patterns surfaced.",
  hygiene:
    "Cleanup pass touched expected counts — stale rows reaped, soft-deletes archived, expired tokens rotated.",
  signals:
    "Detector ran without timeout AND any blind-spots/anomalies surfaced were either acted on or auto-resolved.",
  review:
    "Operator-facing artifact (brief, digest, weekly review) generated AND delivered AND read within 24h.",
  compose:
    "Composite slot completed with no slot-internal failures; downstream surfaces all updated.",
  device:
    "Device bridge round-tripped a heartbeat in the last 5min for every active device.",
  alert:
    "Alert pipeline matched against the right severity rules and either fired OR suppressed by an explicit rule.",
};

/**
 * Map cron category → typical approval class. Default is "auto" because
 * crons are operator-owned reads. The `pending` overrides flag jobs that
 * mutate external services (sends emails, posts to FB/IG, hits Stripe);
 * for now those are tagged not gated, since the v10 wave hasn't shipped
 * the approval queue UI yet (W11 work). Once the queue UI lands, flip
 * tagged ones to `pending` from /system/policies.
 */
function approvalClassFor(cron: CronDef): ApprovalClass {
  if (cron.mode === "retired") return "forbidden";
  return "auto";
}

/**
 * Tags drive surface filters + the "high-risk" group on the operator
 * UI. Inferred from category + cron name keywords. Conservative —
 * better to under-tag than to mark a benign read job as "cost-bearing."
 */
function tagsFor(cron: CronDef): string[] {
  const tags: string[] = [cron.category, cron.mode];
  const n = cron.name.toLowerCase();
  if (n.includes("ai") || n.includes("brain") || n.includes("predict") || n.includes("intelligence")) {
    tags.push("cost-bearing");
  }
  if (n.includes("notification") || n.includes("alert") || n.includes("send") || n.includes("digest") || n.includes("brief")) {
    tags.push("external-write");
  }
  if (n.includes("device") || n.includes("sync")) {
    tags.push("cross-ring");
  }
  if (cron.mode === "folded") {
    tags.push("nested");
  }
  return [...new Set(tags)];
}

function rollbackFor(cron: CronDef): string | null {
  // Most crons are read/derive jobs — nothing to roll back. Notification
  // and digest jobs send messages that can't be unsent. Sync-pull jobs
  // can be re-run idempotently. Be honest: null means non-reversible.
  const n = cron.name.toLowerCase();
  if (n.includes("notification") || n.includes("send")) {
    return "manual-only · sent messages cannot be retracted";
  }
  if (cron.category === "ingest") {
    return "POST /api/system/crons/run with the same name (idempotent re-pull)";
  }
  if (cron.category === "hygiene") {
    return "soft-delete restore via /api/system/soft-delete?model=<table>&id=<id>";
  }
  return null;
}

function inputsFor(cron: CronDef): Record<string, unknown> {
  return {
    schedule: cron.schedule,
    memoryMb: cron.memory ?? 512,
    maxDurationSec: cron.maxDuration ?? 60,
    path: cron.path ?? `/api/cron/${cron.name}`,
    addedAt: cron.addedAt ?? null,
    foldedInto: cron.foldedInto ?? null,
  };
}

function cronToPolicy(cron: CronDef): PolicyUpsertInput {
  const successMetric =
    CATEGORY_SUCCESS[cron.category] ??
    "Job completes within maxDuration with exit-success status, logged to CronJobLog.";
  return {
    id: `cron.${cron.name}`,
    surface: "cron",
    name: cron.name,
    objective: cron.description,
    trigger:
      cron.mode === "folded"
        ? `nested · runs inside ${cron.foldedInto ?? "parent slot"}`
        : cron.mode === "retired"
          ? `retired · scheduled deletion after ${cron.retireAfter ?? "TBD"}`
          : `cron · ${cron.schedule}`,
    inputs: inputsFor(cron),
    approvalClass: approvalClassFor(cron),
    rollback: rollbackFor(cron),
    successMetric,
    tags: tagsFor(cron),
    enabled: cron.mode !== "retired",
  };
}

// ─── Curated non-cron policies ───────────────────────────────────────
// Hand-written because tools/slashes/webhooks don't have a single
// source-of-truth file the way config/crons.ts gives crons. Adding more
// here is an explicit declaration that an automation exists; the
// pre-push gate (slot 10/10) will eventually require these.

const CURATED_NON_CRON: PolicyUpsertInput[] = [
  // ── Slash commands (chat interceptors) ─────────────────────────────
  {
    id: "slash.save",
    surface: "slash",
    name: "save",
    objective:
      "Lightweight ingest path — operator types `/save <thought>` in chat to push a single durable memory into the brain layer without going through journal-ingest's AI parsing.",
    trigger: "chat message starting with `/save`, `/save:`, `/remember`, or `/ingest` (lib/ai/chat/interceptors.ts EARLY_SLASH_SAVE)",
    inputs: { categories: ["decision", "belief", "strategy", "brand_marketing", "pattern", "user_save"], maxLength: 4000 },
    approvalClass: "auto",
    rollback: "soft-delete the BrainMemory row from /system/cold-memory",
    successMetric: "BrainMemory row created with non-empty content and a categorizer-derived category.",
    tags: ["chat", "ingest", "single-row-write"],
  },
  {
    id: "slash.image",
    surface: "slash",
    name: "image",
    objective:
      "Explicit image-generation request via `/image <prompt>` — bypasses the natural-language image-intent classifier so even ambiguous prompts force the gen pipeline.",
    trigger: "chat message starting with `/image` (lib/ai/chat/interceptors.ts)",
    inputs: { providers: ["venice", "fal"], costPerImage: "approximately 0.005 USD" },
    approvalClass: "auto",
    rollback: null,
    successMetric: "Image generated AND served via /api/ai/image-pulse without provider error in <30s.",
    tags: ["chat", "cost-bearing", "external-write"],
  },

  // ── Tools (Nick's high-leverage tools) ─────────────────────────────
  {
    id: "tool.send-email-via-resend",
    surface: "tool",
    name: "send-email-via-resend",
    objective:
      "Send an email from Nick on the operator's behalf — used for outreach, customer follow-up, calendar invites.",
    trigger: "Nick chooses the tool during a chat turn (lib/ai/tools.ts)",
    inputs: { providerEnv: "RESEND_API_KEY", maxRecipients: 10, dailyCapEnv: "EMAIL_DAILY_CAP" },
    approvalClass: "pending",
    rollback: "manual-only · sent emails cannot be retracted",
    successMetric: "Email accepted by Resend (200) AND recipient bounced=false in /api/system/email-events within 24h.",
    tags: ["external-write", "cost-bearing", "high-risk"],
  },
  {
    id: "tool.create-task",
    surface: "tool",
    name: "create-task",
    objective:
      "Nick creates a task on the operator's to-do list during a chat turn when an action item is detected.",
    trigger: "Nick chooses the tool during a chat turn (lib/ai/tools.ts createTask)",
    inputs: { schema: "lib/validators/tasks.taskCreateSchema" },
    approvalClass: "auto",
    rollback: "DELETE /api/tasks/:id (soft-deletes the task)",
    successMetric: "Task row created with non-empty title AND surfaces in /tasks within 1 page-load.",
    tags: ["task-write", "single-row-write"],
  },
  {
    id: "tool.update-pinned-memory",
    surface: "tool",
    name: "update-pinned-memory",
    objective:
      "Nick edits or replaces a pinned-context memory based on operator correction during a chat turn.",
    trigger: "Nick chooses the tool when the operator says 'no, I prefer X' or 'update that to Y' (lib/ai/tools.ts)",
    inputs: { category: "pinned_user", maxPinned: 5 },
    approvalClass: "pending",
    rollback: "BrainMemory.update with the pre-edit content from /system/agent-traces (last edit's `before` payload)",
    successMetric: "Pinned memory updated AND injected on the next chat turn AND operator does not re-correct.",
    tags: ["brain-write", "high-leverage"],
  },

  // ── Autonomous actions (rules in lib/brain/autonomous-engine) ──────
  {
    id: "autonomous-action.auto_followup_expired_quote",
    surface: "autonomous-action",
    name: "auto_followup_expired_quote",
    objective:
      "When a quote expires without conversion, fire a follow-up message to the lead — re-engage before the lead goes fully cold.",
    trigger: "cron.lead-followup-engine detects quote expiry past N days (lib/brain/autonomous-engine.ts)",
    inputs: { lookback_days: 14, minLeadScore: 30 },
    approvalClass: "pending",
    rollback: "manual-only · the message has already been sent",
    successMetric: "Lead opens the message AND replies OR books an appointment within 7 days.",
    tags: ["cross-ring", "external-write", "high-risk", "lead-pipeline"],
  },
  {
    // 2026-08-12 · operator-authorized ("do the best recommended fixes")
    // after the deferred-action deadlock finding (GATE-2026-08-12
    // producer addendum, #1538): with NO policy row the fail-closed
    // engine parked every nightly match as approval="pending" — 431 rows
    // from 221 targets — while the rule's OWN controls (wisdom dupe-guard
    // + wisdom-quality-gate + confidence-drop on skip) sat inside the
    // never-executed action. `auto` puts the designed self-limiting
    // mechanism back in charge; the engine caps it at 3 candidates/night.
    id: "autonomous-action.memory_promotion",
    surface: "autonomous-action",
    name: "memory_promotion",
    objective:
      "Promote heavily-reinforced memories (seenCount≥5, confidence≥0.6) to wisdom — THROUGH the dupe-guard and wisdom-quality-gate, which also demote near-misses so the candidate pool converges instead of re-proposing forever.",
    trigger: "Nightly autonomous-engine pass (mega-evening fan-out → /api/cron/autonomous-engine), top-3 candidates by seenCount (lib/brain/autonomous-engine.ts)",
    inputs: { seenCountMin: 5, confidenceMin: 0.6, batchPerNight: 3 },
    approvalClass: "auto",
    rollback:
      "Promotion is a category flip + content prefix — set category back and strip '[PROMOTED TO WISDOM] '; gate/dupe skips only lower confidence (reversible update).",
    successMetric:
      "The 501-candidate pool (2026-08-12 probe) shrinks night over night — promotions AND gate-rejections both count — and the approval queue stops accumulating memory_promotion pending rows.",
    tags: ["brain-write", "single-row-write", "self-limiting"],
  },
  {
    // 2026-08-12 · operator-authorized, same finding: with no policy row
    // this rule's nightly Telegram reminder was parked as a pending queue
    // row instead — 228 rows from the SAME 3 unreviewed decisions (76
    // nights each). `auto` restores the rule's designed behavior: a
    // reminder to the operator, ≤3/night, 24h per-target cooldown.
    id: "autonomous-action.decision_replay_due",
    surface: "autonomous-action",
    name: "decision_replay_due",
    objective:
      "Remind the operator (Telegram) when a decision replay's reviewAt has passed — the review loop is the point; the reminder is how due replays stop rotting unreviewed (oldest due since 2026-04-25 at seeding time).",
    trigger: "Nightly autonomous-engine pass, oldest 3 rows where reviewed=false AND reviewAt<=now (lib/brain/autonomous-engine.ts)",
    inputs: { batchPerNight: 3, perTargetCooldownHours: 24 },
    approvalClass: "auto",
    rollback: "Notification-only — nothing to undo; marking the replay reviewed stops its reminders.",
    successMetric:
      "Unreviewed+due decisionReplay count trends to 0 (was 9 at seeding); no decision_replay_due rows accumulate in the approval queue.",
    tags: ["notification", "operator-facing"],
  },
  {
    id: "autonomous-action.auto_score_applicant",
    surface: "autonomous-action",
    name: "auto_score_applicant",
    objective:
      "Score an inbound applicant against Nick's hiring rubric so the operator only sees ranked candidates.",
    trigger: "Webhook `/api/webhooks/applicant` posts a new application (lib/brain/autonomous-engine.ts)",
    inputs: { rubric: "BrainMemory key=hiring_rubric", aiModel: "venice-large" },
    approvalClass: "auto",
    rollback: "AutonomousAction.payload contains the score; can re-score with a fresh rubric",
    successMetric: "Applicant assigned a score in [0,100] AND ranked relative to last 30d cohort.",
    tags: ["cost-bearing", "single-row-write", "lead-pipeline"],
  },

  // ── Webhooks (inbound integrations) ────────────────────────────────
  {
    id: "webhook.nickstire-bridge",
    surface: "webhook",
    name: "nickstire-bridge",
    objective:
      "Cross-ring data feed — nickstire (business ring) posts revenue events, lead events, and shop-state updates into NOUR OS for the personal-ring command center.",
    trigger: "POST /api/webhooks/nickstire (HMAC-authenticated by STATENOUR_SYNC_KEY)",
    inputs: { authEnv: "STATENOUR_SYNC_KEY", events: ["revenue.invoice", "lead.created", "shop.health"] },
    approvalClass: "auto",
    rollback: "delete the resulting BrainBusEvent + any derived BrainMemory",
    successMetric: "Webhook returns 2xx within 3s AND event lands in BrainBusEvent within 5s.",
    tags: ["cross-ring", "auth-gated", "high-volume"],
  },
];

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n📋 seed-policies · ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log("=".repeat(60));

  const allInputs: PolicyUpsertInput[] = [
    ...CRONS.filter((c) => c.mode !== "retired").map(cronToPolicy),
    ...CURATED_NON_CRON,
  ];

  const bySurface = new Map<string, number>();
  for (const p of allInputs) {
    bySurface.set(p.surface, (bySurface.get(p.surface) ?? 0) + 1);
  }

  console.log("\nInputs to upsert:");
  for (const [s, n] of [...bySurface.entries()].sort()) {
    console.log(`  · ${s.padEnd(20)} ${n}`);
  }
  console.log(`  · ${"TOTAL".padEnd(20)} ${allInputs.length}`);

  if (DRY_RUN) {
    console.log("\n(dry-run · no DB writes)\n");
    for (const p of allInputs.slice(0, 5)) {
      console.log(`\n${p.id}`);
      console.log(`  objective: ${p.objective.slice(0, 100)}…`);
      console.log(`  trigger:   ${p.trigger}`);
      console.log(`  approval:  ${p.approvalClass}`);
      console.log(`  tags:      ${(p.tags ?? []).join(", ")}`);
    }
    console.log(`\n…and ${allInputs.length - 5} more.\n`);
    return;
  }

  console.log("\nUpserting…");
  let ok = 0;
  let failed = 0;
  for (const input of allInputs) {
    try {
      await upsertPolicy(input);
      ok += 1;
      process.stdout.write(".");
    } catch (e) {
      failed += 1;
      console.error(`\n  ✗ ${input.id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`\n\n✅  upserted ${ok} / ${allInputs.length} policies`);
  if (failed > 0) {
    console.error(`❌  ${failed} failures`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("seed crashed:", e);
  process.exit(1);
});
