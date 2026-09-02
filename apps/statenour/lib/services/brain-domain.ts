/**
 * lib/services/brain-domain.ts · Phase B.6d (2026-05-22 ·
 * legacy-modernizer REST→tRPC brain-domain slice).
 *
 * Shared brain-domain assembly · the route handlers under
 * `app/api/brain/*` (+ `/api/audit/entity`) carried this logic inline.
 * It is lifted here verbatim so the legacy REST endpoints AND the new
 * `trpc.brain.*` procedures call the SAME functions · drift between the
 * two transports is structurally impossible. Same shared-service
 * pattern as `brain-wisdom` / `pins` / `link-review` / `contradictions`.
 *
 * Every read function returns an explicit, shallow interface — the
 * BrainMemory / AuditEvent Json columns (`metadata` · `payload`) are
 * projected to scalar / `unknown` fields inside the function so the
 * recursive Prisma `JsonValue` type never leaks into the AppRouter.
 * That is the TS2589-prevention discipline documented in
 * docs/trpc-migration-roadmap.md · mirrors `TaskEventRow` in
 * `lib/trpc/routers/task.ts` and `TaskSessionView` in
 * `lib/services/task-session.ts`.
 */

import { prisma } from "@/lib/prisma";
import { hourET } from "@/lib/utils/datetime";
import { logger } from "@/lib/logger";
import {
  KNOWN_BRAIN_CATEGORIES,
  DEPRECATED_CATEGORY_MAP,
  CATEGORY_DOMAINS,
} from "@/lib/brain/categories";
import {
  loadActiveSkills,
  loadPendingSkills,
} from "@/lib/brain/skill-extractor";
import {
  loadIdentitySnapshot,
  loadIdentityHistory,
  invalidateIdentitySnapshotCache,
  type AxisKey,
} from "@/lib/brain/identity-snapshot";
import {
  loadQualitativeIdentity,
  invalidateQualitativeIdentityCache,
} from "@/lib/brain/qualitative-identity";
import {
  loadActiveBeliefs,
  loadBeliefCandidates,
} from "@/lib/brain/belief-harvester";
// `countUnresolved` is deliberately NOT imported any more — see the
// ONE-POPULATION note inside `buildBrainMaturity`. It counted a 14-day
// window while the resolve-rate denominator counted 90 days, so the two
// numbers on the same card described different populations.
// `loadAllContradictions` is still imported for the EXPORT path below, which
// genuinely wants the rows. The maturity path takes counts instead — see the
// note at its derivation for why a capped list cannot produce an honest rate.
import {
  countContradictionsByStatus,
  loadAllContradictions,
} from "@/lib/brain/contradiction-surfacer";
import {
  getGhostPredictions,
  loadGhostAccuracy,
} from "@/lib/brain/ghost-nick";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import {
  getEntityHistory,
  getActorActivity,
  getGlobalActivity,
} from "@/lib/db/entity-audit";
import {
  readSuggestionMetrics,
  readHistoricalSuggestionMetrics,
} from "@/lib/ai/suggestion-cache";

// ──────────────── active-alerts ────────────────

/**
 * The 7 BrainMemory alert categories the active-alerts surface
 * aggregates. Lifted verbatim from
 * `app/api/brain/active-alerts/route.ts`.
 */
const ALERT_CATEGORIES = [
  "correlation_alert",
  "decision_quality_drift",
  "schema_drift_alert",
  "storage_quota_alert",
  "creation_spike_alert",
  "update_spike_alert",
  "brain_bus_alert",
] as const;

/** One alert row · `metadata` projected to `unknown` (TS2589 firewall). */
export interface BrainAlertRow {
  id: string;
  category: string;
  key: string;
  content: string;
  createdAt: string;
  metadata: unknown;
}

/** Shallow, explicit shape for the active-alerts feed. */
export interface ActiveAlertsView {
  sinceDays: number;
  counts: Record<string, number>;
  alerts: Record<string, BrainAlertRow[]>;
}

/**
 * Recent BrainMemory alert rows grouped by category, each capped at
 * `limit`. Lifted verbatim from GET /api/brain/active-alerts.
 */
export async function buildActiveAlerts(args: {
  limit: number;
  sinceDays: number;
}): Promise<ActiveAlertsView> {
  const since = new Date(Date.now() - args.sinceDays * 86_400_000);
  // W3 alert lifecycle: category mutes are expiring brainMemory rows
  // (category alert_mute, key = muted category, expiresAt = mute end).
  // Server-side so mutes hold across devices; expiry is natural TTL.
  const muteRows = await prisma.brainMemory.findMany({
    where: {
      category: "alert_mute",
      deletedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { key: true },
  });
  const muted = new Set(muteRows.map((m) => m.key));
  const activeCategories = ALERT_CATEGORIES.filter((c) => !muted.has(c));
  const rows = await prisma.brainMemory.findMany({
    where: {
      category: { in: [...activeCategories] },
      createdAt: { gte: since },
      deletedAt: null,
    },
    orderBy: { createdAt: "desc" },
    take: args.limit * ALERT_CATEGORIES.length,
    select: {
      id: true,
      category: true,
      key: true,
      content: true,
      createdAt: true,
      metadata: true,
    },
  });

  const grouped: Record<string, BrainAlertRow[]> = {};
  for (const cat of ALERT_CATEGORIES) grouped[cat] = [];
  for (const r of rows) {
    if (grouped[r.category] && grouped[r.category].length < args.limit) {
      grouped[r.category].push({
        id: r.id,
        category: r.category,
        key: r.key,
        content: r.content,
        createdAt: r.createdAt.toISOString(),
        metadata: r.metadata ?? null,
      });
    }
  }

  return {
    sinceDays: args.sinceDays,
    counts: Object.fromEntries(
      ALERT_CATEGORIES.map((c) => [c, grouped[c].length]),
    ),
    alerts: grouped,
  };
}

// ──────────────── brain maturity ────────────────

/**
 * `loadRecentContradictions` (lib/brain/contradiction-surfacer.ts:322)
 * applies `take: 40` to the row query BEFORE the status filter at :329.
 * Mirrored here — the same documentation-as-code convention
 * tests/brain/qualitative-identity-cache.test.ts uses for CACHE_KEY —
 * so this rollup can at least SAY the contradiction sample was capped
 * instead of presenting a truncated, newest-biased resolve rate as a
 * measurement.
 *
 * This is a MIRROR, so it drifts if the take changes: raise the take there
 * and a genuine 40-row list is falsely called truncated; lower it and the
 * flag never fires at all. Neither is silent — the flag is rendered — but
 * the two files have to move together. There is no way to ask the surfacer
 * how many rows it was willing to return without editing it.
 */
const CONTRADICTION_ROW_CAP = 40;

/**
 * The eleven subsystem reads `buildBrainMaturity` fans out. Named,
 * because a failed read has to be REPORTABLE — see the function header.
 */
export type BrainMaturityRead =
  | "skills_active"
  | "skills_pending"
  | "identity_snapshot"
  | "identity_history"
  | "qualitative_identity"
  | "beliefs_active"
  | "belief_candidates"
  | "contradictions"
  | "ghost_accuracy"
  | "chat_importance_rows"
  | "chat_summary_rows";

/**
 * Shallow, explicit shape for the brain-maturity rollup.
 *
 * EVERY counter is `number | null`, and `null` means exactly one thing:
 * the read that would have produced it FAILED. It never means zero. The
 * consumer (components/brain/brain-maturity-header.tsx) renders "?" for
 * a null and must not colour it as health — the same ERROR / UNMEASURED
 * / ZERO discipline as
 * components/brain/contradiction-resolution-panel.tsx:296-305.
 */
export interface BrainMaturityView {
  /**
   * 0-100 · `null` whenever `failedReads` is non-empty. A score summed
   * over subsystems that could not be read is a fabricated number, and
   * this one fabricated a specific, plausible value — see the function
   * header.
   */
  score: number | null;
  /** Denominator for `score` — shrinks when a dimension cannot be measured. */
  scoreMax: number;
  components: {
    skills: {
      active: number | null;
      graduated: number | null;
      pending: number | null;
    };
    identity: { axes_filled: number | null; history_days: number | null };
    qualitative: { entries: number | null };
    beliefs: { active: number | null; candidates: number | null };
    contradictions: {
      open: number | null;
      resolved: number | null;
      /**
       * The 90-day contradiction read hit `CONTRADICTION_ROW_CAP`, so
       * `open` / `resolved` / the resolve rate describe only the newest
       * N rows — and the newest are the least likely to be resolved.
       */
      truncated: boolean;
    };
    ghost: {
      hits: number | null;
      surprises: number | null;
      /**
       * The one AMBIGUOUS null on this payload, because it pre-dates the
       * convention: it means either "no ghost predictions scored yet" or
       * "the read failed". Check `failedReads.includes("ghost_accuracy")`
       * to tell them apart — `hits` / `surprises` beside it are not
       * ambiguous, and are null only on a failed read.
       */
      accuracy: number | null;
    };
    chat_memory: {
      importance_rows: number | null;
      distilled_sessions: number | null;
    };
  };
  /** Subsystem reads that threw. Empty array on a clean read. */
  failedReads: BrainMaturityRead[];
  computed_at: string;
}

/**
 * Aggregate brain-maturity score (0-100) + per-subsystem counters.
 * Lifted verbatim from GET /api/brain/maturity — same heuristic weights.
 *
 * ── A FAILED READ IS NOT A ZERO (2026-09-02) ──
 * The ten loaders below each carried a bare `.catch(() => [])` /
 * `.catch(() => null)` / `.catch(() => 0)` and logged NOTHING. Walk the
 * scoring block with every one of them failed: 0+0+0+0+0+7+0+0 = 7, and
 * the 7 came from the `allContradictions.length === 0 → return 7` branch
 * — an empty list because the read failed scored identically to an empty
 * list because the ledger is clean. `buildBrainMaturity` then returned a
 * fully-formed, non-error payload, so the header's `if (!data)` guard
 * never fired: it rendered "7", every counter 0, ghost acc "—", and —
 * worst — "contradictions 0" in EMERALD, because
 * brain-maturity-header.tsx:203 paints `open > 0 ? red : emerald`. The
 * operator read "almost no signal, but at least it's internally
 * consistent" when the truth was "the brain could not be read".
 *
 * Same defect shape, same fix, as
 * components/brain/contradiction-resolution-panel.tsx:63-69 (a failed
 * query fell into `[]` and rendered a green "Clean ledger") and
 * components/brain/judgment-quality-panel.tsx:35-43 ("state unknown, not
 * empty"). Every read is now named, every failure is logged AND carried
 * out in `failedReads`, every derived counter is `null` rather than 0,
 * and the score is suppressed entirely.
 *
 * ── ONE POPULATION, ONE WINDOW ──
 * `components.contradictions.open` used to come from `countUnresolved(14)`
 * — a 14-day, unresolved-only read — while `resolved` AND the resolve-rate
 * denominator came from `loadAllContradictions(90)`. Two windows, two
 * status sets, presented as one pair. An unresolved contradiction raised
 * 20 days ago was therefore INVISIBLE to `open` (header: "0", emerald)
 * while still dragging the resolve rate down — the card showed green for
 * a penalty it refused to display. Both numbers are now partitioned out
 * of the SAME list, so `open + resolved === list.length` by construction.
 * Consequence to expect: `openPenalty` now sees 90 days of unresolved
 * rows, so a brain with old, unresolved contradictions scores lower than
 * it did — that is the penalty finally being applied, not a regression.
 */
export async function buildBrainMaturity(): Promise<BrainMaturityView> {
  const failedReads: BrainMaturityRead[] = [];
  /**
   * Swallow a subsystem read the way the old `.catch()`es did — but
   * loudly, and leaving a trace in the payload. `null` out means "this
   * read failed", never "this read returned nothing".
   */
  const read = <T>(name: BrainMaturityRead, p: Promise<T>): Promise<T | null> =>
    p.catch((err: unknown) => {
      failedReads.push(name);
      logger.warn("brain_maturity_read_failed", {
        read: name,
        error: err instanceof Error ? err.message.slice(0, 120) : String(err),
      });
      return null;
    });
  /** For loaders that can legitimately resolve to `null` on success. */
  const failed = (name: BrainMaturityRead): boolean =>
    failedReads.includes(name);

  const [
    skillsActive,
    skillsPending,
    snap,
    history,
    qualitative,
    beliefsActive,
    beliefsPending,
    allContradictions,
    ghostAcc,
    importanceCount,
    distilledCount,
  ] = await Promise.all([
    read("skills_active", loadActiveSkills()),
    read("skills_pending", loadPendingSkills()),
    read("identity_snapshot", loadIdentitySnapshot()),
    read("identity_history", loadIdentityHistory(30)),
    read("qualitative_identity", loadQualitativeIdentity()),
    read("beliefs_active", loadActiveBeliefs()),
    read("belief_candidates", loadBeliefCandidates()),
    read("contradictions", countContradictionsByStatus(90)),
    read("ghost_accuracy", loadGhostAccuracy()),
    // These two already logged before this change — they are routed
    // through the same helper so a failed count also suppresses the
    // score instead of quietly contributing a 0.
    read(
      "chat_importance_rows",
      prisma.brainMemory.count({
        where: { category: BRAIN_CATEGORIES.CHAT_IMPORTANCE, deletedAt: null },
      }),
    ),
    read(
      "chat_summary_rows",
      prisma.brainMemory.count({
        where: { category: BRAIN_CATEGORIES.CHAT_SUMMARY, deletedAt: null },
      }),
    ),
  ]);

  const graduatedCount = skillsActive
    ? skillsActive.filter((s) => s.graduated).length
    : null;
  const axesFilled = snap
    ? (Object.keys(snap.axes) as AxisKey[]).filter((k) => {
        const a = snap.axes[k];
        return (a.manual ?? a.value) > 0 && a.evidence.length > 0;
      }).length
    : null;

  const qualitativeEntries = qualitative
    ? qualitative.values.length +
      qualitative.fears.length +
      qualitative.operating_style.length +
      qualitative.rhythms.length +
      qualitative.red_lines.length
    : null;

  // `loadGhostAccuracy` resolves to null when nothing has been scored yet,
  // so `ghostAcc === null` alone cannot distinguish "no data" from "read
  // failed" — ask `failedReads`.
  const ghostFailed = failed("ghost_accuracy");
  const ghostTotal = ghostAcc ? ghostAcc.hits + ghostAcc.surprises : 0;
  const accuracy =
    !ghostFailed && ghostAcc && ghostTotal > 0 ? ghostAcc.hits / ghostTotal : null;

  // ONE population, counted in SQL rather than filtered from a list.
  //
  // 2026-09-02 (second pass) · these came from `loadAllContradictions(90)`,
  // which applies `take: 40` BEFORE the status is parsed out of the JSON body.
  // Past 40 rows in the window you could only ever see the 40 newest, and the
  // newest are the least likely to be resolved — so the resolve rate was
  // systematically low and the open count systematically short. The first pass
  // fixed the population MISMATCH and made the truncation visible; it did not
  // make the numbers right. A count never needed the list.
  const contradictionsOpen = allContradictions ? allContradictions.unresolved : null;
  const resolvedContradictions = allContradictions ? allContradictions.resolved : null;
  const contradictionsTotal = allContradictions ? allContradictions.total : null;
  // Nothing is truncated any more. The field stays so the UI contract and its
  // canary hold, and so a future re-truncation has somewhere honest to report.
  const contradictionsTruncated = false;

  const pts = {
    skills:
      skillsActive && graduatedCount !== null
        ? Math.min(20, (skillsActive.length + graduatedCount) * 2)
        : 0,
    identity_axes: axesFilled !== null ? axesFilled * (15 / 8) : 0,
    history: history ? Math.min(15, history.length * 0.5) : 0,
    qualitative:
      qualitativeEntries !== null ? Math.min(15, qualitativeEntries * 0.75) : 0,
    beliefs: beliefsActive ? Math.min(10, beliefsActive.length * 1) : 0,
    // null = UNMEASURABLE, and it is excluded from the total AND from the
    // maximum below rather than scored. Distinct from 0, which means measured
    // and bad.
    contradictions: ((): number | null => {
      // An empty list because the READ FAILED is not a clean ledger — this
      // branch is where the phantom 7 came from.
      if (
        allContradictions === null ||
        contradictionsOpen === null ||
        resolvedContradictions === null
      ) {
        return null;
      }
      // 2026-09-02 (self-audit of the same day's fix) · this returned a
      // hardcoded 7 for an EMPTY table. The earlier pass split "read failed"
      // from "empty" and stopped there, so an empty ledger kept collecting 7
      // of 100 points — and production has never recorded a single
      // contradiction in any of the three categories, so that branch is the
      // one it takes on every render. Seven fabricated points, permanently.
      //
      // It is the identical shape lib/brain/learning-velocity.ts removed in
      // the same wave: `resolutionRate = 1` for an empty table, where "never
      // contradicted myself" scored exactly like "found and resolved every
      // contradiction". Fixed there, missed here. A resolve rate over zero
      // contradictions is not a good score, it is no score.
      if (contradictionsTotal === null || contradictionsTotal === 0) return null;
      const resolveRate = resolvedContradictions / Math.max(1, contradictionsTotal);
      const openPenalty = Math.min(5, contradictionsOpen);
      return Math.max(0, resolveRate * 10 - openPenalty);
    })(),
    ghost: accuracy != null ? Math.min(10, accuracy * (10 / 0.6)) : 0,
    chat_memory:
      importanceCount !== null ? Math.min(5, importanceCount / 40) : 0,
  };

  const rawScore = Math.round(
    pts.skills +
      pts.identity_axes +
      pts.history +
      pts.qualitative +
      pts.beliefs +
      (pts.contradictions ?? 0) +
      pts.ghost +
      pts.chat_memory,
  );

  // The denominator shrinks with the numerator when a dimension cannot be
  // measured, so an unmeasurable subsystem neither pays nor is paid. Scoring
  // 93 of 100 because contradictions are unmeasurable is a worse lie than
  // either 93/90 or "unknown" — it silently spends the operator's ceiling.
  const CONTRADICTION_POINTS = 10;
  const scoreMax = 100 - (pts.contradictions === null ? CONTRADICTION_POINTS : 0);

  return {
    // Any failed read makes the sum a statement about subsystems we did
    // not read. There is no honest number to print, so there is none.
    score: failedReads.length > 0 ? null : Math.max(0, Math.min(scoreMax, rawScore)),
    /** What `score` is out of. Below 100 when a dimension is unmeasurable. */
    scoreMax,
    components: {
      skills: {
        active: skillsActive ? skillsActive.length : null,
        graduated: graduatedCount,
        pending: skillsPending ? skillsPending.length : null,
      },
      identity: {
        axes_filled: axesFilled,
        history_days: history ? history.length : null,
      },
      qualitative: { entries: qualitativeEntries },
      beliefs: {
        active: beliefsActive ? beliefsActive.length : null,
        candidates: beliefsPending ? beliefsPending.length : null,
      },
      contradictions: {
        open: contradictionsOpen,
        resolved: resolvedContradictions,
        truncated: contradictionsTruncated,
      },
      ghost: {
        hits: ghostFailed ? null : (ghostAcc?.hits ?? 0),
        surprises: ghostFailed ? null : (ghostAcc?.surprises ?? 0),
        accuracy,
      },
      chat_memory: {
        importance_rows: importanceCount,
        distilled_sessions: distilledCount,
      },
    },
    // Sorted because this list is rendered to the operator verbatim, and
    // `Promise.all` settles rejections in completion order — an unsorted
    // list would reshuffle between refreshes and read like the failure set
    // was changing when it was not.
    failedReads: [...failedReads].sort(),
    computed_at: new Date().toISOString(),
  };
}

// ──────────────── brain export ────────────────

/**
 * Full self-model dump · the downloadable JSON backup. Lifted verbatim
 * from GET /api/brain/export. Return type is `unknown` — the payload is
 * a deeply heterogeneous backup blob (skills · identity · contradictions
 * · ghost bundle) with no stable scalar contract, and the only consumer
 * serialises it straight to a Blob. Typing it `unknown` keeps the
 * recursive snapshot types out of the AppRouter (TS2589 firewall) · the
 * client casts on read.
 */
export async function buildBrainExport(): Promise<unknown> {
  const [
    skillsActive,
    skillsPending,
    identity,
    identityHistory,
    qualitative,
    beliefs,
    beliefCandidates,
    contradictions,
    ghostBundle,
    ghostAccuracy,
  ] = await Promise.all([
    loadActiveSkills().catch(() => []),
    loadPendingSkills().catch(() => []),
    loadIdentitySnapshot().catch(() => null),
    loadIdentityHistory(90).catch(() => []),
    loadQualitativeIdentity().catch(() => null),
    loadActiveBeliefs().catch(() => []),
    loadBeliefCandidates().catch(() => []),
    loadAllContradictions(180).catch(() => []),
    getGhostPredictions().catch(() => null),
    loadGhostAccuracy().catch(() => null),
  ]);

  return {
    exported_at: new Date().toISOString(),
    schema_version: "2026.04.19",
    skills: { active: skillsActive, pending: skillsPending },
    identity,
    identity_history: identityHistory,
    qualitative_identity: qualitative,
    beliefs: { active: beliefs, candidates: beliefCandidates },
    contradictions,
    ghost: { bundle: ghostBundle, accuracy: ghostAccuracy },
  };
}

// ──────────────── brain reset ────────────────

/**
 * The 12 BrainMemory categories `resetBrainState` wipes. Lifted
 * verbatim from `app/api/brain/reset/route.ts` (raw strings — the route
 * pre-dates the BRAIN_CATEGORIES registry; kept identical so the
 * destructive set never drifts between transports).
 */
const RESET_CATEGORIES = [
  "chat_importance",
  "chat_summary",
  "skill",
  "skill_pending",
  "identity_snapshot",
  "qualitative_identity",
  "ghost_prediction",
  "ghost_accuracy",
  "contradiction",
  "belief",
  "belief_candidate",
  "brain_dump_importance",
];

/** Shallow, explicit shape for a brain-reset result. */
export interface BrainResetResult {
  ok: true;
  deleted: number;
  categories: string[];
}

/**
 * Nuke ALL brain-learning state across the 12 categories. Lifted
 * verbatim from POST /api/brain/reset — same delete set, same
 * fire-and-forget audit-event write. Irreversible.
 */
export async function resetBrainState(): Promise<BrainResetResult> {
  const result = await prisma.brainMemory.deleteMany({
    where: { category: { in: RESET_CATEGORIES } },
  });

  // `qualitative_identity` is one of the rows just deleted, and
  // buildQualitativeContextBlock caches it for 900s. Without this the
  // cached object survives the reset: /chat keeps rendering the wiped
  // identity, and the next addManualEntry/removeEntry updates a row that
  // no longer exists — Prisma P2025.
  invalidateQualitativeIdentityCache();

  // 2026-08-06 · same defect, second cache. `identity_snapshot` is also in
  // RESET_CATEGORIES and loadIdentitySnapshot caches it for 300s, so without
  // this /chat keeps rendering the deleted self-model after a wipe. Found by
  // the adversarial review of the qualitative fix — one file over, identical
  // shape, and it would have shipped silently.
  invalidateIdentitySnapshotCache();

  await prisma.auditEvent
    .create({
      data: {
        actor: "brain_reset",
        eventType: "brain_insight",
        detail: `Full brain reset — ${result.count} rows deleted across ${RESET_CATEGORIES.length} categories`,
        payload: { categories: RESET_CATEGORIES, count: result.count },
      },
    })
    .catch(() => {});

  return { ok: true, deleted: result.count, categories: RESET_CATEGORIES };
}

// ──────────────── category stats ────────────────

/** One category-stats row · the shape /brain/categories renders. */
export interface CategoryStatRow {
  category: string;
  rows: number;
  permanentRows: number;
  latestAt: string | null;
  oldestAt: string | null;
  avgConfidence: number;
  domain: string;
  status: "registered" | "deprecated" | "unregistered";
  canonicalTarget: string | null;
}

/** Shallow, explicit shape for the category-stats heat-map. */
export interface CategoryStatsView {
  totalRows: number;
  totalCategories: number;
  categoriesRegistered: number;
  categoriesDeprecated: number;
  categoriesUnregistered: number;
  stats: CategoryStatRow[];
  generatedAt: string;
}

function domainForCategory(category: string): string {
  for (const [domain, cats] of Object.entries(CATEGORY_DOMAINS)) {
    if ((cats as readonly string[]).includes(category)) return domain;
  }
  return "Unregistered";
}

/**
 * BrainMemory category heat-map · per-category row counts, freshness,
 * confidence, and registry status. Lifted verbatim from GET
 * /api/brain/category-stats (the single GROUP BY `$queryRaw`).
 */
export async function buildCategoryStats(): Promise<CategoryStatsView> {
  const rows = await prisma.$queryRaw<
    Array<{
      category: string;
      rows: bigint;
      permanent_rows: bigint;
      latest_at: Date | null;
      oldest_at: Date | null;
      avg_confidence: number | null;
    }>
  >`
    SELECT
      category,
      COUNT(*)::bigint AS rows,
      COUNT(*) FILTER (WHERE expires_at IS NULL)::bigint AS permanent_rows,
      MAX(created_at) AS latest_at,
      MIN(created_at) AS oldest_at,
      AVG(confidence)::float8 AS avg_confidence
    FROM brain_memories
    GROUP BY category
    ORDER BY COUNT(*) DESC
  `;

  const stats: CategoryStatRow[] = rows.map((r) => {
    const isDeprecated = DEPRECATED_CATEGORY_MAP[r.category] !== undefined;
    const isKnown = KNOWN_BRAIN_CATEGORIES.has(r.category);
    return {
      category: r.category,
      rows: Number(r.rows),
      permanentRows: Number(r.permanent_rows),
      latestAt: r.latest_at?.toISOString() ?? null,
      oldestAt: r.oldest_at?.toISOString() ?? null,
      avgConfidence: Number(r.avg_confidence ?? 0),
      domain: domainForCategory(r.category),
      status: isDeprecated
        ? "deprecated"
        : isKnown
          ? "registered"
          : "unregistered",
      canonicalTarget: DEPRECATED_CATEGORY_MAP[r.category] ?? null,
    };
  });

  return {
    totalRows: stats.reduce((s, x) => s + x.rows, 0),
    totalCategories: stats.length,
    categoriesRegistered: stats.filter((s) => s.status === "registered")
      .length,
    categoriesDeprecated: stats.filter((s) => s.status === "deprecated")
      .length,
    categoriesUnregistered: stats.filter((s) => s.status === "unregistered")
      .length,
    stats,
    generatedAt: new Date().toISOString(),
  };
}

// ──────────────── recent insights ────────────────

/** One task-insight row · `metadata` projected to scalars. */
export interface RecentInsightRow {
  key: string;
  content: string;
  axis: string | null;
  wisdomQuery: string | null;
  confidence: number;
  lastSeen: string;
  enrichedAt: string | null;
}

/** Shallow, explicit shape for the recent-insights feed. */
export interface RecentInsightsView {
  insights: RecentInsightRow[];
  days: number;
  count: number;
}

/**
 * Last-N-days BrainMemory(task_insight) rows grouped-ready by axis.
 * Lifted verbatim from GET /api/brain/recent-insights — the metadata
 * Json column is projected to the 3 scalar fields here so the
 * procedure's public type stays shallow.
 */
export async function buildRecentInsights(args: {
  days: number;
  limit: number;
}): Promise<RecentInsightsView> {
  const since = new Date(Date.now() - args.days * 86_400_000);
  const rows = await prisma.brainMemory
    .findMany({
      where: {
        category: "task_insight",
        deletedAt: null,
        lastSeen: { gte: since },
      },
      orderBy: { lastSeen: "desc" },
      take: args.limit,
      select: {
        key: true,
        content: true,
        confidence: true,
        metadata: true,
        lastSeen: true,
      },
    })
    .catch(
      (): Array<{
        key: string;
        content: string;
        confidence: number;
        metadata: unknown;
        lastSeen: Date;
      }> => [],
    );

  const insights: RecentInsightRow[] = rows.map((r) => {
    const m = (r.metadata ?? null) as {
      axis?: string | null;
      wisdom_query?: string | null;
      enriched_at?: string | null;
    } | null;
    return {
      key: r.key,
      content: r.content,
      axis: m?.axis ?? null,
      wisdomQuery: m?.wisdom_query ?? null,
      confidence: r.confidence,
      lastSeen: r.lastSeen.toISOString(),
      enrichedAt: m?.enriched_at ?? null,
    };
  });

  return { insights, days: args.days, count: insights.length };
}

// ──────────────── graph neighborhood ────────────────

type NodeRef = { type: string; id: string };

/** One graph node · resolved label + edge degree. */
export interface GraphNeighborhoodNode {
  type: string;
  id: string;
  label: string;
  degree: number;
}

/** One graph edge between two nodes. */
export interface GraphNeighborhoodEdge {
  source: NodeRef;
  target: NodeRef;
  relationship: string;
  strength: number;
  evidence: string | null;
}

/** Shallow, explicit shape for a graph-neighborhood result. */
export interface GraphNeighborhoodView {
  root: { type: string; id: string; label: string } | null;
  nodes: GraphNeighborhoodNode[];
  edges: GraphNeighborhoodEdge[];
}

/** Resolve node labels in bulk · one query per entity type. */
async function resolveGraphLabels(
  refs: NodeRef[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const byType = new Map<string, Set<string>>();
  for (const r of refs) {
    if (!byType.has(r.type)) byType.set(r.type, new Set());
    byType.get(r.type)!.add(r.id);
  }

  const fetchers: Array<Promise<void>> = [];
  for (const [type, idSet] of byType) {
    const ids = Array.from(idSet);
    if (ids.length === 0) continue;

    if (type === "task") {
      fetchers.push(
        prisma.task
          .findMany({
            where: { id: { in: ids } },
            select: { id: true, title: true },
          })
          .then((rows) =>
            rows.forEach((r) => labels.set(`${type}:${r.id}`, r.title)),
          )
          .catch(() => {}),
      );
    } else if (type === "commitment") {
      const numIds = ids
        .map((i) => Number(i))
        .filter((n) => Number.isFinite(n));
      fetchers.push(
        prisma.commitment
          .findMany({
            where: { id: { in: numIds } },
            select: { id: true, description: true },
          })
          .then((rows) =>
            rows.forEach((r: { id: number; description: string }) =>
              labels.set(`${type}:${r.id}`, r.description),
            ),
          )
          .catch(() => {}),
      );
    } else if (type === "reflection") {
      fetchers.push(
        prisma.reflection
          .findMany({
            where: { id: { in: ids } },
            select: { id: true, insight: true, date: true },
          })
          .then((rows) =>
            rows.forEach((r) =>
              labels.set(`${type}:${r.id}`, `${r.date} · ${r.insight}`),
            ),
          )
          .catch(() => {}),
      );
    } else if (type === "memory" || type === "brain_memory") {
      fetchers.push(
        prisma.brainMemory
          .findMany({
            where: { id: { in: ids } },
            select: { id: true, content: true, category: true },
          })
          .then((rows) =>
            rows.forEach((r) =>
              labels.set(
                `${type}:${r.id}`,
                `[${r.category}] ${r.content.slice(0, 90)}`,
              ),
            ),
          )
          .catch(() => {}),
      );
    } else if (type === "brain_dump") {
      fetchers.push(
        prisma.brainDump
          .findMany({
            where: { id: { in: ids } },
            select: { id: true, summary: true },
          })
          .then((rows) =>
            rows.forEach((r) =>
              labels.set(`${type}:${r.id}`, r.summary ?? "(dump)"),
            ),
          )
          .catch(() => {}),
      );
    } else if (type === "mastery_decision" || type === "decision") {
      const numIds = ids
        .map((i) => Number(i))
        .filter((n) => Number.isFinite(n));
      fetchers.push(
        prisma.masteryDecision
          .findMany({
            where: { id: { in: numIds } },
            select: { id: true, title: true },
          })
          .then((rows) =>
            rows.forEach((r) => labels.set(`${type}:${r.id}`, r.title)),
          )
          .catch(() => {}),
      );
    } else if (type === "prediction") {
      fetchers.push(
        prisma.prediction
          .findMany({
            where: { id: { in: ids } },
            select: { id: true, prediction: true },
          })
          .then((rows) =>
            rows.forEach((r) => labels.set(`${type}:${r.id}`, r.prediction)),
          )
          .catch(() => {}),
      );
    }
  }
  await Promise.all(fetchers);
  return labels;
}

/**
 * The edge neighborhood around a single node (depth 1 or 2). Lifted
 * verbatim from GET /api/brain/graph-neighborhood — same top-3-neighbor
 * depth-2 fan-out cap, same label resolution.
 */
export async function buildGraphNeighborhood(args: {
  type: string;
  id: string;
  depth: 1 | 2;
}): Promise<GraphNeighborhoodView> {
  const { type, id, depth } = args;
  if (!type || !id) {
    return { root: null, nodes: [], edges: [] };
  }

  const firstHop = await prisma.memoryEdge.findMany({
    where: {
      OR: [
        { sourceType: type, sourceId: id },
        { targetType: type, targetId: id },
      ],
    },
    orderBy: { strength: "desc" },
    take: 40,
    select: {
      sourceType: true,
      sourceId: true,
      targetType: true,
      targetId: true,
      relationship: true,
      strength: true,
      evidence: true,
    },
  });

  const nodeMap = new Map<string, NodeRef & { degree: number }>();
  const addNode = (t: string, i: string) => {
    const key = `${t}:${i}`;
    const existing = nodeMap.get(key);
    if (existing) existing.degree++;
    else nodeMap.set(key, { type: t, id: i, degree: 1 });
  };
  addNode(type, id);
  for (const e of firstHop) {
    addNode(e.sourceType, e.sourceId);
    addNode(e.targetType, e.targetId);
  }

  let secondHop: typeof firstHop = [];
  if (depth >= 2) {
    const neighbors = Array.from(nodeMap.values())
      .filter((n) => !(n.type === type && n.id === id))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 3);
    const extra = await Promise.all(
      neighbors.map((n) =>
        prisma.memoryEdge.findMany({
          where: {
            OR: [
              { sourceType: n.type, sourceId: n.id },
              { targetType: n.type, targetId: n.id },
            ],
          },
          orderBy: { strength: "desc" },
          take: 12,
          select: {
            sourceType: true,
            sourceId: true,
            targetType: true,
            targetId: true,
            relationship: true,
            strength: true,
            evidence: true,
          },
        }),
      ),
    );
    secondHop = extra.flat();
    for (const e of secondHop) {
      addNode(e.sourceType, e.sourceId);
      addNode(e.targetType, e.targetId);
    }
  }

  const allRefs = Array.from(nodeMap.values()).map((n) => ({
    type: n.type,
    id: n.id,
  }));
  const labels = await resolveGraphLabels(allRefs);

  const nodes: GraphNeighborhoodNode[] = allRefs.map((r) => ({
    ...r,
    label: labels.get(`${r.type}:${r.id}`) ?? `${r.type}:${r.id.slice(0, 8)}`,
    degree: nodeMap.get(`${r.type}:${r.id}`)?.degree ?? 1,
  }));

  const edges: GraphNeighborhoodEdge[] = [...firstHop, ...secondHop].map(
    (e) => ({
      source: { type: e.sourceType, id: e.sourceId },
      target: { type: e.targetType, id: e.targetId },
      relationship: e.relationship,
      strength: e.strength,
      evidence: e.evidence,
    }),
  );

  const rootLabel =
    labels.get(`${type}:${id}`) ?? `${type}:${id.slice(0, 8)}`;
  return { root: { type, id, label: rootLabel }, nodes, edges };
}

// ──────────────── activity stream (entity-audit firehose) ────────────────

/** One audit event row · `payload` dropped, scalar fields only. */
export interface ActivityStreamEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  reason: string | null;
  source: string | null;
  createdAt: string;
}

/** Shallow, explicit shape for the global activity stream. */
export interface ActivityStreamView {
  count: number;
  entries: ActivityStreamEntry[];
  mode: "actor-firehose" | "global-firehose";
}

/**
 * The cross-OS entity-audit firehose · global (or actor-scoped) recent
 * activity. Lifted from the `firehose` branch of GET /api/audit/entity.
 * `getActorActivity` / `getGlobalActivity` already return scalar audit
 * rows (no Prisma Json) · the explicit interface pins the public shape
 * regardless.
 */
export async function buildActivityStream(args: {
  limit: number;
  actor?: string;
  since?: Date;
}): Promise<ActivityStreamView> {
  const raw = args.actor
    ? await getActorActivity(args.actor, {
        limit: args.limit,
        since: args.since,
      })
    : await getGlobalActivity({ limit: args.limit, since: args.since });

  const entries: ActivityStreamEntry[] = raw.map((e) => ({
    id: e.id,
    entityType: e.entityType,
    entityId: e.entityId,
    action: e.action,
    actor: e.actor,
    reason: e.reason ?? null,
    source: e.source ?? null,
    createdAt:
      e.createdAt instanceof Date
        ? e.createdAt.toISOString()
        : String(e.createdAt),
  }));

  return {
    count: entries.length,
    entries,
    mode: args.actor ? "actor-firehose" : "global-firehose",
  };
}

// ──────────────── page visit ────────────────

/** Shallow, explicit shape for a page-visit record result. */
export interface PageVisitResult {
  ok: boolean;
}

/**
 * Record a silent page visit for brain pattern detection. Lifted
 * verbatim from POST /api/brain/page-visit — same hour / day-of-week
 * derivation, same fail-silent contract (tracking is non-critical).
 */
export async function recordPageVisit(args: {
  page: string;
  referrer?: string | null;
}): Promise<PageVisitResult> {
  try {
    const hour = hourET();
    const dayOfWeek = new Date().toLocaleDateString("en-US", {
      weekday: "short",
      timeZone: "America/New_York",
    });
    await prisma.auditEvent.create({
      data: {
        actor: "page_tracker",
        eventType: "page_visit",
        detail: args.page,
        payload: {
          page: args.page,
          referrer: args.referrer || null,
          hour,
          dayOfWeek,
          timestamp: new Date().toISOString(),
        },
      },
    });
    return { ok: true };
  } catch {
    // Fail silently — tracking is non-critical.
    return { ok: true };
  }
}

// ──────────────── suggestion-cache telemetry ────────────────

/** Shallow, explicit shape for one stats window (live or 24h). */
export interface SuggestionStatsWindow {
  requests: number;
  cacheHits: number;
  cacheHitRate: number;
  aiOk: number;
  aiFail: number;
  heuristic: number;
  errorFallback: number;
  avgLatencyMs: number;
  p50Ms: number;
  p95Ms: number;
  sample: number;
}

/**
 * Shallow, explicit shape for the suggestion-telemetry feed. Carries
 * `live` + `history24` PLUS the flat legacy keys the panel actually
 * reads (the SuggestionTelemetryPanel binds the top-level `Stats`
 * shape) — verbatim with the GET /api/ai/chat/suggestions/stats
 * envelope so the consumer's reads are unchanged.
 */
export interface SuggestionStatsView extends SuggestionStatsWindow {
  live: SuggestionStatsWindow;
  history24: {
    requests: number;
    cacheHits: number;
    cacheHitRate: number;
    aiOk: number;
    aiFail: number;
    heuristic: number;
    errorFallback: number;
    avgLatencyMs: number;
    since: string;
  };
}

/**
 * Suggestion-cache hit/miss + AI OK/fail telemetry · lambda-local
 * live counters + 24h SystemMetric-persisted baseline. Lifted verbatim
 * from GET /api/ai/chat/suggestions/stats — same `live` / `history24`
 * envelope + flat legacy keys.
 */
export async function buildSuggestionStats(): Promise<SuggestionStatsView> {
  const live = readSuggestionMetrics();
  const history24 = await readHistoricalSuggestionMetrics(24);

  const liveWindow: SuggestionStatsWindow = {
    requests: live.requests,
    cacheHits: live.cacheHits,
    cacheHitRate: Number(live.cacheHitRate.toFixed(3)),
    aiOk: live.aiOk,
    aiFail: live.aiFail,
    heuristic: live.heuristic,
    errorFallback: live.errorFallback,
    avgLatencyMs: Math.round(live.avgLatencyMs),
    p50Ms: live.p50Ms,
    p95Ms: live.p95Ms,
    sample: live.latencySamples.length,
  };

  return {
    live: liveWindow,
    history24: {
      requests: history24.requests,
      cacheHits: history24.cacheHits,
      aiOk: history24.aiOk,
      aiFail: history24.aiFail,
      heuristic: history24.heuristic,
      errorFallback: history24.errorFallback,
      avgLatencyMs: history24.avgLatencyMs,
      since: history24.since,
      cacheHitRate:
        history24.requests > 0
          ? Number((history24.cacheHits / history24.requests).toFixed(3))
          : 0,
    },
    // Legacy flat keys — the panel binds these directly.
    ...liveWindow,
  };
}
