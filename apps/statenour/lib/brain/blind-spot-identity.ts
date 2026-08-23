/**
 * Blind-spot identity + recurrence policy (2026-08-22).
 *
 * WHAT WAS BROKEN. The nightly cron persisted every detected spot under
 * `blindspot_${domain}_${Date.now()}`. `brainMemory.remember()` upserts on the
 * (category, key) unique, so a clock in the key asserts "today's sighting of
 * this fact is a DIFFERENT fact from yesterday's". Every run therefore
 * inserted brand-new rows and the operator's verdicts had nothing to attach
 * to.
 *
 * Measured on prod 2026-08-22, across all six rows the live engine had ever
 * written: the operator judged 3 of 3 on 08-21 (2 noise, 1 investigate); the
 * 08-22 run regenerated the same three spots as unjudged rows. 100% of the
 * verdict history was erased within 24h — and `getBlindSpotContext()` read the
 * newest of them straight back into the system prompt.
 *
 * WHY THIS FIXES SUPPRESSION FOR FREE. `reinforce()` (memory-manager.ts)
 * updates seenCount / confidence / lastSeen / content and NEVER writes
 * `metadata`. So once the key is stable, a re-sighting refreshes the card's
 * text and recency while the operator's `discoveryVerdict` survives untouched.
 * That is load-bearing and silent, so tests/brain/reinforce-metadata-canary.test.ts
 * pins it against the REAL function with a mocked prisma. (This module's own
 * test file mocks memory-manager wholesale, so it can only restate the
 * assumption, not verify it — adversarial review caught exactly that.)
 *
 * RECURRENCE POLICY — suppress by default, resurface ONLY on escalation.
 *
 * Ancker et al. (PMC5387195; 112 clinicians, 1,266,325 alerts) measured that
 * acceptance falls 30% per additional alert in an encounter (IRR 0.70,
 * p < .001) and 10% per 5-point rise in the repeated-alert share (IRR 0.90,
 * p < .001) — and that once a clinician overrides an alert, they override its
 * repeats 87.9% of the time. Re-asking a settled question is ~88% wasted AND
 * it taxes every other card shown beside it. So: suppress.
 *
 * But a blind spot is a monotone-worsening class — days-since-attention only
 * grows. Unconditional suppression turns one `noise` tap into permanent
 * blindness in the category where that costs most. A TIME-based re-ask
 * ("resurface after 30d") is unbounded and simply reinstates the fatigue on a
 * timer. Severity escalation is bounded: four tiers means a spot can resurface
 * at most three times in its entire life, however long it persists — and it is
 * the detector's OWN encoding of "this got worse", not a number invented here.
 *
 * `known` is deliberately exempt: "already knew" is a claim about NOVELTY, and
 * a known thing getting worse does not make it new. It stays suppressed from
 * the feed regardless of severity (it still reaches the system prompt, because
 * the operator confirmed it TRUE — see getBlindSpotContext).
 */
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { brainMemory } from "@/lib/brain/memory-manager";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import type { BlindSpot } from "@/lib/brain/blind-spot-detector";

/** Higher = worse. Ordinal only; the gaps carry no meaning. */
export const SEVERITY_RANK: Record<BlindSpot["severity"], number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export type BlindSpotVerdict = "investigate" | "known" | "noise";

/** One entry per verdict the operator has ever given this spot. */
export interface VerdictHistoryEntry {
  verdict: BlindSpotVerdict;
  at: string;
  severityRank: number;
}

/**
 * The identity of a spot: what it is ABOUT, with everything variable removed.
 *
 * ONLY A LEADING digit run collapses to `#`, and that restriction is the whole
 * design. Two live detector templates open with a moving count —
 * `${pendingDecisions} decisions awaiting review` (blind-spot-detector.ts:264)
 * and `${driftAlerts.length} unresolved drift alerts accumulating` (:276) — so
 * without this they mint a fresh key on the exact days their number moves.
 * (A third, `${staleLEads} leads over 7 days old`, is guarded by
 * `if (staleLEads > 0)` behind a hardcoded `Promise.resolve(0)` at :195, so it
 * has never fired. Counting it as live would overstate the case.)
 *
 * Collapsing EVERY digit run, as the first version of this did, is a data-loss
 * bug: the two highest-volume templates interpolate free operator text —
 * `Commitment overdue: "${c.description}"` (:218) and
 * `Open loop untouched: "${loop.title}"` (:235). Two READY tasks named
 * "Order 4 winter tires" and "Order 6 winter tires" would normalise to one
 * identity, so the second would reinforce the first's row, the operator would
 * only ever see one of them, and a single "Noise" tap would suppress both.
 * Caught in adversarial review before ship. The moving counts all sit at
 * position 0; operator prose does not.
 *
 * Scoped by domain AND frame so two engines that phrase a finding similarly
 * about different subjects cannot collide.
 *
 * Residual, stated rather than assumed away: identity is derived from the
 * commitment/task TITLE, so renaming one orphans its verdict. That is the
 * correct trade — a renamed thing may genuinely be a different thing — but it
 * is a real edge, not an impossibility.
 */
export function blindSpotIdentity(spot: BlindSpot): string {
  const normalized = spot.description
    .toLowerCase()
    .replace(/^\d+/, "#")
    .replace(/\s+/g, " ")
    .trim();
  return `${spot.domain.toLowerCase()}|${spot.frame ?? "neglect"}|${normalized}`;
}

/**
 * The (category, key) half of the upsert. Hashed rather than raw so a long
 * commitment title cannot produce an unwieldy key; 16 hex chars matches the
 * house convention in IntelligenceOutcome.contentHash.
 */
export function blindSpotKey(spot: BlindSpot): string {
  const digest = createHash("sha256").update(blindSpotIdentity(spot)).digest("hex").slice(0, 16);
  return `blindspot_${spot.domain.toLowerCase()}_${digest}`;
}

/**
 * The stored card text. Extracted from the cron so persist and tests share ONE
 * definition — the previous inline template drifted out of reach of any test.
 */
export function blindSpotContent(spot: BlindSpot): string {
  return `[${spot.severity.toUpperCase()}] ${spot.description}: ${spot.evidence}. Action: ${spot.suggestedAction}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readHistory(metadata: unknown): VerdictHistoryEntry[] {
  const raw = asRecord(metadata).discoveryVerdictHistory;
  return Array.isArray(raw) ? (raw as VerdictHistoryEntry[]) : [];
}

/**
 * Does a re-sighting at `severity` clear the standing verdict?
 *
 * Only `noise` is escalation-clearable (see the module header on `known`).
 * `investigate` already spawned a task — that task is the tracker, and
 * re-opening the card would double-count the same work.
 */
export function shouldResurface(
  verdict: string | null | undefined,
  verdictSeverityRank: number | null,
  currentSeverity: BlindSpot["severity"],
): boolean {
  if (verdict !== "noise") return false;
  if (verdictSeverityRank === null) return false;
  return SEVERITY_RANK[currentSeverity] > verdictSeverityRank;
}

/**
 * The tier a stored card was written at, read from its own text.
 *
 * Deliberately NOT "whatever tier the spot is at today": the escalation policy
 * compares against the tier the verdict was GIVEN at, and using today's tier
 * stamps a suppressed spot at its escalated rank and silences it forever.
 */
export function severityRankFromContent(content: string): number | null {
  const tag = content.match(/^\[([A-Z]+)\]/)?.[1]?.toLowerCase();
  return tag && tag in SEVERITY_RANK ? SEVERITY_RANK[tag as BlindSpot["severity"]] : null;
}

/**
 * Verdict from the column, falling back to `metadata`.
 *
 * Every other reader in this wave has this fallback; the inheritance lookup
 * originally did not, which made a verdict given by a deployment predating the
 * migration invisible to the one query that exists to rescue it — and because
 * inheritance runs only on a first sighting, that miss is permanent.
 */
export function readAnyVerdict(
  column: string | null | undefined,
  metadata: unknown,
): BlindSpotVerdict | null {
  const fromColumn = column;
  const fromMeta = asRecord(metadata).discoveryVerdict;
  const v = fromColumn ?? fromMeta;
  return v === "investigate" || v === "known" || v === "noise" ? v : null;
}

/**
 * Does a legacy row describe the SAME spot as `spot`?
 *
 * Reuses blindSpotIdentity's normalisation on both sides rather than a LIKE.
 * The legacy key carries the domain (`blindspot_<domain>_<epoch>`) and the
 * content carries `[TIER] <description>: <evidence>`, so both halves of the
 * identity are recoverable — except `frame`, which was never persisted. Domain
 * plus normalised description is therefore the scope, and across the nine live
 * templates no two differ only by frame.
 */
export function legacyIdentityMatches(
  spot: BlindSpot,
  legacyKey: string,
  legacyContent: string,
): boolean {
  const legacyDomain = legacyKey.replace(/^blindspot_/, "").replace(/_[^_]*$/, "").toLowerCase();
  if (legacyDomain !== spot.domain.toLowerCase()) return false;

  const body = legacyContent.replace(/^\[[A-Z]+\]\s*/, "");
  const norm = (t: string) => t.toLowerCase().replace(/^\d+/, "#").replace(/\s+/g, " ").trim();
  // Prefix, not substring: the evidence half follows the description after
  // ": ", so a prefix test is exact where `contains` over-matched.
  return norm(body).startsWith(`${norm(spot.description)}: `);
}

export interface PersistResult {
  key: string;
  /** `created` - first sighting. `reinforced` - same spot, verdict intact. */
  action: "created" | "reinforced";
  /** True when an escalation cleared a standing `noise` verdict. */
  resurfaced: boolean;
  /** True when this write revived a TTL-tombstoned row. See the TTL note. */
  revived: boolean;
  /**
   * True when the row's `lastSeen` did NOT move — the commit gateway returned
   * `noop` or parked the write. Reported, never assumed away: the call site's
   * whole reason for counting is that a silent write failure used to look
   * healthy.
   */
  noop: boolean;
  /**
   * Set when a first sighting under the stable key adopted a verdict the
   * operator gave under a legacy timestamped key. Carries the source row id so
   * the adoption is auditable and reversible.
   */
  inheritedVerdictFrom?: string;
}

/**
 * Persist one detected spot under its stable identity.
 *
 * THE TTL TRAP, and why this does an explicit reconciling write.
 *
 * A stable key is necessary but NOT sufficient, and shipping it alone would
 * have been a worse regression than the bug it fixes. Caught in adversarial
 * review, then confirmed against prod:
 *
 *  1. `remember()`'s create arm stamps `expiresAt = now + 24h` — `blind_spot`
 *     is not in ONE_SHOT_RECORD_CATEGORIES (memory-manager.ts:501).
 *  2. `reinforce()` clears that expiry only at `seenCount >= 3` AND
 *     `bumpConfidence !== false` (memory-manager.ts:542). For a same-source
 *     nightly automation the commit gateway returns `noop` (identical content →
 *     returns the row untouched, :401) or `update` (→ `reinforce(..., {
 *     bumpConfidence: false })`, :424). NEITHER increments `seenCount`, so the
 *     full-bump path at :488 is unreachable and the row can never promote.
 *  3. `pruneNoise()` soft-deletes every row with `expiresAt < now`, no category
 *     filter (memory-consolidation.ts:251); data-cleanup HARD-deletes the same
 *     set. Prod already holds 15 soft-deleted blind_spot rows from this sweep,
 *     and 3 of the 6 engine rows were past due at diagnosis — including all
 *     three carrying the operator's only verdicts.
 *  4. `findUnique` on (category, key) does not filter `deletedAt`, so a
 *     tombstoned row still answers as `existing`, the create arm is never taken
 *     again, and the identity is BURNED — the spot disappears from the feed and
 *     the system prompt permanently.
 *
 * Base rate confirming the diagnosis: the two engines that already write stable
 * keys are 5/5 and 2/2 promoted-and-permanent; blind-spot-detector is 0/6.
 *
 * So this reconciles explicitly after `remember()`: revive a tombstone, drop
 * the probationary expiry once a spot has been seen twice (which is what
 * "temporary until reinforced" was always meant to mean), and refresh
 * `lastSeen` the gateway's `noop` path leaves stale.
 */
export async function persistBlindSpot(spot: BlindSpot): Promise<PersistResult> {
  const key = blindSpotKey(spot);
  const content = blindSpotContent(spot);

  // deletedAt is deliberately NOT filtered: a tombstoned row must be found so
  // it can be revived. Filtering it here would leave the row invisible to the
  // feed while still occupying the unique key.
  const existing = await prisma.brainMemory.findUnique({
    where: { category_key: { category: BRAIN_CATEGORIES.BLIND_SPOT, key } },
    select: { id: true, metadata: true, deletedAt: true, lastSeen: true },
  });

  // Captured BEFORE any write: the reconciling update below clears deletedAt,
  // and reading it afterwards would report `revived: false` on every revival.
  const wasTombstoned = existing?.deletedAt != null;

  const meta = asRecord(existing?.metadata);
  const standingVerdict = typeof meta.discoveryVerdict === "string" ? meta.discoveryVerdict : null;
  const standingRank =
    typeof meta.discoveryVerdictSeverityRank === "number"
      ? meta.discoveryVerdictSeverityRank
      : null;
  const resurfaced = shouldResurface(standingVerdict, standingRank, spot.severity);

  await brainMemory.remember(BRAIN_CATEGORIES.BLIND_SPOT, key, content, "blind-spot-detector", {
    blindSpotIdentity: blindSpotIdentity(spot),
    blindSpotSeverityRank: SEVERITY_RANK[spot.severity],
    blindSpotFrame: spot.frame ?? "neglect",
  });

  if (!existing) {
    // FIRST SIGHTING UNDER THE STABLE KEY — inherit any verdict the operator
    // already gave this spot under a legacy timestamped key.
    //
    // Changing the key scheme does not retroactively unify the 255 rows
    // already written as `blindspot_<domain>_<epoch>`. Without this, the fix
    // would work going forward while permanently orphaning the only real
    // labels there are: measured on prod 2026-08-22 the operator has FIVE
    // labels in total, three of them on legacy blind-spot rows. Losing them is
    // losing 60% of the training signal.
    //
    // MATCHED BY THE SAME IDENTITY FUNCTION, not by a LIKE.
    //
    // The first version used `content: { contains: `${description}: ` }`. Three
    // separate defects, all found in adversarial review:
    //   · it did not collapse the LEADING digit run, so the two templates the
    //     normalisation exists for -- `N decisions awaiting review` and
    //     `N unresolved drift alerts accumulating` -- were exactly the two the
    //     bridge could never match once N moved. Inheritance runs only on a
    //     first sighting, so that miss is permanent.
    //   · it scoped by neither domain nor frame, so moving a task between
    //     missions changed its identity and the bridge would then adopt the old
    //     mission's verdict anyway.
    //   · Prisma's `contains` does not escape `%` or `_`, and both matching
    //     templates interpolate free operator text. A task titled
    //     "Cut ad spend 20% this month" becomes a wildcard.
    //
    // So: fetch the verdict-carrying rows (a tiny, bounded population -- three
    // on prod today) and compare with legacyIdentityMatches(), which reuses
    // blindSpotIdentity's own normalisation. No LIKE, nothing to escape.
    //
    // Soft-deleted rows are deliberately INCLUDED: one of the operator's five
    // labels sits on a row the consolidate cron tombstoned on 08-20, and a
    // tombstone does not unmake a judgement.
    //
    // The metadata arm of the OR is the deploy-window fallback every other
    // reader in this wave has. `not: DbNull` on a jsonb path is well-defined
    // for a missing key (it excludes the row), so it carries no NULL trap.
    const candidates = await prisma.brainMemory.findMany({
      where: {
        category: BRAIN_CATEGORIES.BLIND_SPOT,
        OR: [
          { discoveryVerdict: { not: null } },
          { metadata: { path: ["discoveryVerdict"], not: Prisma.DbNull } },
        ],
      },
      // NULLS LAST explicitly. A bare `desc` is NULLS FIRST on Postgres, and
      // the backfill can leave discovery_rated_at NULL on a row whose verdict
      // is set (the two CASE arms are independent), so the default would sort
      // an undated verdict ahead of every properly dated one.
      orderBy: [{ discoveryRatedAt: { sort: "desc", nulls: "last" } }],
      take: 200,
      select: {
        id: true, key: true, content: true, metadata: true,
        discoveryVerdict: true, discoveryRatedAt: true,
      },
    });

    const match = candidates.find((c) =>
      legacyIdentityMatches(spot, c.key, c.content) &&
      readAnyVerdict(c.discoveryVerdict, c.metadata) !== null,
    );

    if (match) {
      const inheritedVerdict = readAnyVerdict(match.discoveryVerdict, match.metadata)!;
      // The tier the verdict was GIVEN at, read from the legacy row's own text.
      // The previous fallback used TODAY's severity, and since
      // discoveryVerdictSeverityRank only started being written on 2026-08-22
      // while the real legacy verdicts are from 08-21, that fallback fired on
      // 100% of the rows this bridge exists to rescue -- stamping them at the
      // current (often escalated) tier and thereby suppressing them forever.
      // `?? low` keeps the safe direction: over-resurface, never never-resurface.
      const inheritedRank =
        severityRankFromContent(match.content) ??
        (typeof asRecord(match.metadata).discoveryVerdictSeverityRank === "number"
          ? (asRecord(match.metadata).discoveryVerdictSeverityRank as number)
          : SEVERITY_RANK.low);

      const created = await prisma.brainMemory.findUnique({
        where: { category_key: { category: BRAIN_CATEGORIES.BLIND_SPOT, key } },
        select: { metadata: true },
      });

      // The escalation may ALREADY have happened between the verdict and this
      // first stable-key sighting. Adopting the verdict as active would swallow
      // it silently, so the same policy applies here as on a re-sighting.
      const escalated = shouldResurface(inheritedVerdict, inheritedRank, spot.severity);
      const ratedAt =
        match.discoveryRatedAt?.toISOString() ??
        (typeof asRecord(match.metadata).discoveryRatedAt === "string"
          ? (asRecord(match.metadata).discoveryRatedAt as string)
          : new Date().toISOString());

      await prisma.brainMemory.update({
        where: { category_key: { category: BRAIN_CATEGORIES.BLIND_SPOT, key } },
        data: {
          // COLUMN AND METADATA TOGETHER. Writing only metadata is how the
          // resurface path became a no-op -- every reader prefers the column.
          discoveryVerdict: escalated ? null : inheritedVerdict,
          discoveryRatedAt: escalated ? null : match.discoveryRatedAt,
          discoveryProvenance: "engine",
          // A judged row must never carry the probationary TTL.
          expiresAt: null,
          metadata: {
            ...asRecord(created?.metadata),
            discoveryVerdict: escalated ? null : inheritedVerdict,
            discoveryRatedAt: escalated ? null : ratedAt,
            discoveryVerdictSeverityRank: escalated ? null : inheritedRank,
            ...(escalated
              ? {
                  discoveryVerdictHistory: [
                    { verdict: inheritedVerdict, at: ratedAt, severityRank: inheritedRank },
                  ],
                  discoveryResurfacedAt: new Date().toISOString(),
                  discoveryResurfacedFromRank: inheritedRank,
                  discoveryResurfacedToRank: SEVERITY_RANK[spot.severity],
                }
              : {}),
            // Provenance of the VERDICT itself, so this is auditable and the
            // inheritance is reversible by clearing exactly these rows.
            discoveryVerdictInheritedFrom: match.id,
          } as never,
        },
      });
      return {
        key,
        action: "created",
        resurfaced: escalated,
        revived: false,
        noop: false,
        inheritedVerdictFrom: match.id,
      };
    }

    // No legacy verdict. Still stamp provenance, or the column decays toward
    // all-NULL as the population turns over and restoredHidden silently reads
    // zero -- the "hidden pile nothing reports" failure it exists to prevent.
    await prisma.brainMemory.update({
      where: { category_key: { category: BRAIN_CATEGORIES.BLIND_SPOT, key } },
      data: { discoveryProvenance: "engine" },
    });
    return { key, action: "created", resurfaced: false, revived: false, noop: false };
  }

  // Re-read rather than trusting the pre-read: `remember()` has three paths
  // that write NOTHING and return the untouched row (gateway noop, park for
  // review, and an unknown-category park). Deriving the report from the
  // pre-read would say "reinforced" for a write that never landed — the exact
  // all-clear-on-failure the cron's own counter exists to prevent.
  const after = await prisma.brainMemory.findUnique({
    where: { id: existing.id },
    select: { metadata: true, lastSeen: true },
  });
  const noop = after != null && after.lastSeen.getTime() === existing.lastSeen.getTime();

  // remember() -> reinforce() leaves metadata alone by design, so anything on
  // the metadata is an explicit second write. The history is APPENDED, never
  // replaced: the card has to be able to say "you called this noise 2x" after
  // it comes back, or the resurface is just a repeat alert.
  const history = readHistory(existing.metadata);
  if (resurfaced && standingVerdict) {
    history.push({
      verdict: standingVerdict as BlindSpotVerdict,
      at:
        typeof meta.discoveryRatedAt === "string"
          ? meta.discoveryRatedAt
          : new Date().toISOString(),
      severityRank: standingRank ?? SEVERITY_RANK[spot.severity],
    });
  }

  await prisma.brainMemory.update({
    where: { id: existing.id },
    data: {
      // COLUMN AND METADATA TOGETHER. Clearing only `metadata` on a resurface
      // made the entire recurrence policy a NO-OP: every reader in this wave
      // prefers the column, so an escalated spot stayed filtered out of the
      // feed, out of the exact count and out of the system prompt while the
      // cron cheerfully reported `resurfaced: 1`. Found in adversarial review;
      // the canary could not see it because the fake store had no column.
      ...(resurfaced ? { discoveryVerdict: null, discoveryRatedAt: null } : {}),
      // Written on every reinforce so the column has an ongoing producer and
      // does not decay to all-NULL as the population turns over.
      discoveryProvenance: "engine",
      // A spot detected a SECOND time is not probationary. `remember()`'s own
      // create-arm comment calls the 24h stamp "temporary until reinforced";
      // this is the reinforcement, and the gateway will never deliver the
      // seenCount that would otherwise clear it.
      expiresAt: null,
      // Revive a TTL tombstone. Without this the unique key stays occupied by
      // an invisible row and the spot can never surface again.
      deletedAt: null,
      // The gateway's noop path returns without touching lastSeen, which would
      // strand a still-current spot outside the feed's recency window.
      lastSeen: new Date(),
      metadata: {
        ...asRecord(after?.metadata ?? existing.metadata),
        ...(resurfaced
          ? {
              discoveryVerdict: null,
              discoveryVerdictSeverityRank: null,
              discoveryVerdictHistory: history,
              discoveryResurfacedAt: new Date().toISOString(),
              discoveryResurfacedFromRank: standingRank,
              discoveryResurfacedToRank: SEVERITY_RANK[spot.severity],
            }
          : {}),
        blindSpotSeverityRank: SEVERITY_RANK[spot.severity],
      } as never,
    },
  });

  return {
    key,
    action: "reinforced",
    resurfaced,
    revived: wasTombstoned,
    noop,
  };
}
