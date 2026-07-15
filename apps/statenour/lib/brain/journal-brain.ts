/**
 * Journal Brain · async enrichment pass (Phase 1 · 2026-06-01)
 *
 * Runs AFTER an entry is safely persisted — fire-and-forget from the capture
 * pipeline (ingestJournal) so capture stays instant. What it does, in one pass:
 *
 *   1. GROUND   — load the operator's ACTIVE goals + missions
 *   2. CLASSIFY — re-derive entryType WITH that goal context (the "fast" ingest
 *                 pass classified blind; this "reason" pass classifies grounded)
 *   3. LINK     — propose the best goal/mission match + a 0-1 confidence.
 *                 confidence >= autoConfirmThreshold  → "auto"  (lands now)
 *                 confidence <  autoConfirmThreshold  → "proposed" (awaits ✓)
 *   4. SCORE    — grounded XP bonus to the linked goal's stats (only when the
 *                 link is auto-confirmed; a "proposed" link credits on confirm).
 *
 * Writes the grounding columns + enrichedAt so the inline "impact receipt" can
 * be DERIVED at read time (link columns + the mastery_xp_event ledger rows) —
 * no receipt column needed. Never throws: capture already returned to the user,
 * and the enrichedAt-null cron resweep is the durability net if the process
 * dies mid-pass.
 *
 * Phase 2 extends this SAME pass with the creative-idea + challenge layers
 * (see the marked hook below) so the 6 scattered brains converge into one loop.
 */

import { prisma } from "@/lib/prisma";
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
import { extractJsonObject } from "@/lib/ai/extract-structured";
import { sanitizeForPrompt } from "@/lib/ai/prompt/sanitize";
import { creditStatXp } from "@/lib/mastery/credit";
import { effectiveGoalStats } from "@/lib/mastery/goal-stats";
import { getJournalSettings, type JournalSettingsValues } from "@/lib/journal/settings";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/journal-brain");
const aiChat = makeTracedAiChat("journal-brain", "journal");

/** The four journal silos that carry the grounding columns. */
export type JournalSilo =
  | "brain_dump"
  | "reflection"
  | "situation_log"
  | "decision_replay";

/** Thought types (mirrors ThoughtType in journal-ingest · only brain_dump
 *  persists this to a real column). Kept local to avoid a circular import. */
const ENTRY_TYPES = [
  "raw", "thinking", "reasoning", "insight",
  "decision", "reflection", "planning", "venting",
] as const;
type EntryType = (typeof ENTRY_TYPES)[number];

/** Link lifecycle stored in link_status. "auto" = high-confidence auto-confirm
 *  (credited immediately); "proposed" = awaiting operator ✓ (credits on confirm);
 *  "confirmed"/"rejected" are set by the confirm path. null = no link found. */
export type LinkStatus = "auto" | "proposed" | "confirmed" | "rejected";

/**
 * Stable idempotency key for ONE (journal entry, stat) grounded credit.
 * Shared by the enrichment pass AND the confirm-link mutation so re-crediting
 * the same entry/stat is a no-op upsert (never double-counts). Distinct from
 * the Phase 0 baseline key `journal-base:<id>` and the task key `goal-task:…`.
 */
export function groundedJournalSourceKey(entryId: string, statKey: string): string {
  return `goal-journal:${entryId}:${statKey}`;
}

/** Round to one decimal — matches goalStatXp's rounding so XP reads cleanly. */
function round1(n: number): number {
  return Math.max(0, Math.round(n * 10) / 10);
}

interface ActiveGoal {
  id: string;
  title: string;
  domain: string;
  statLinks: { statKey: string; weight: number }[];
}
interface ActiveMission {
  id: string;
  title: string;
  domain: string;
}

/** AI grounding result, post-validation against the real candidate sets. */
interface Grounding {
  entryType: EntryType;
  domains: string[];
  goalId: string | null;
  missionId: string | null;
  confidence: number; // 0-1, clamped
}

/**
 * Credit the grounded XP bonus for an entry linked to a goal. Mirrors the task
 * path (effectiveGoalStats → per-stat creditStatXp) but uses the JOURNAL weight
 * as the base × the settings groundedXpMultiplier. Idempotent per (entry, stat).
 * Returns the stats credited (for logging / receipt).
 */
export async function creditGroundedGoalXp(
  entryId: string,
  goal: ActiveGoal,
  settings: JournalSettingsValues,
): Promise<{ statKey: string; xp: number }[]> {
  const stats = effectiveGoalStats(goal.statLinks ?? [], goal.domain);
  const credited: { statKey: string; xp: number }[] = [];
  for (const s of stats) {
    const xp = round1(settings.baselineXp * s.weight * settings.groundedXpMultiplier);
    if (xp <= 0) continue;
    const ok = await creditStatXp({
      stat: s.statKey,
      xp,
      signal: "journal",
      evidence: `journal → goal · ${goal.title}`.slice(0, 120),
      sourceKey: groundedJournalSourceKey(entryId, s.statKey),
    }).catch(() => false);
    if (ok) credited.push({ statKey: s.statKey, xp });
  }
  return credited;
}

/** Fetch a goal (with stat links) by id, for crediting. */
async function fetchGoalForCredit(goalId: string): Promise<ActiveGoal | null> {
  return prisma.lifeGoal
    .findUnique({
      where: { id: goalId },
      select: { id: true, title: true, domain: true, statLinks: { select: { statKey: true, weight: true } } },
    })
    .catch(() => null);
}

/** Resolve the goal whose stats an entry credits: the directly-linked goal, else
 *  the linked mission's PARENT goal (`mission.lifeGoalId`). Lets mission links earn
 *  XP too — the prod profile showed 1 active goal vs 10 active missions, so routing
 *  mission grounding to its parent goal is the highest-leverage way to make the
 *  grounded score actually fire. Returns null if neither resolves to a goal. */
async function resolveCreditGoal(
  goalId: string | null,
  missionId: string | null,
): Promise<ActiveGoal | null> {
  if (goalId) {
    const g = await fetchGoalForCredit(goalId);
    if (g) return g;
  }
  if (missionId) {
    const m = await prisma.mission
      .findUnique({ where: { id: missionId }, select: { lifeGoalId: true } })
      .catch(() => null);
    if (m?.lifeGoalId) return fetchGoalForCredit(m.lifeGoalId);
  }
  return null;
}

/** Persist the grounding columns to the correct silo table. entry_type is a
 *  real column on brain_dumps only; the other silos keep their own type-ish
 *  columns (category/context) and just get the link + enrichedAt. */
async function writeGrounding(
  silo: JournalSilo,
  id: string,
  g: Grounding,
  status: LinkStatus | null,
): Promise<void> {
  const linkData = {
    goalId: g.goalId,
    missionId: g.missionId,
    linkConfidence: g.confidence,
    linkStatus: status,
    enrichedAt: new Date(),
  };
  switch (silo) {
    case "brain_dump":
      await prisma.brainDump.update({ where: { id }, data: { ...linkData, entryType: g.entryType } });
      break;
    case "reflection":
      await prisma.reflection.update({ where: { id }, data: linkData });
      break;
    case "situation_log":
      await prisma.situationLog.update({ where: { id }, data: linkData });
      break;
    case "decision_replay":
      await prisma.decisionReplay.update({ where: { id }, data: linkData });
      break;
  }
}

/** Just stamp enrichedAt (used for too-short entries / no-op passes) so the
 *  cron resweep doesn't keep re-picking the row forever. */
async function markEnriched(silo: JournalSilo, id: string): Promise<void> {
  const data = { enrichedAt: new Date() };
  switch (silo) {
    case "brain_dump": await prisma.brainDump.update({ where: { id }, data }); break;
    case "reflection": await prisma.reflection.update({ where: { id }, data }); break;
    case "situation_log": await prisma.situationLog.update({ where: { id }, data }); break;
    case "decision_replay": await prisma.decisionReplay.update({ where: { id }, data }); break;
  }
}

/**
 * Enrich one journal entry. Safe to call fire-and-forget (`void enrichJournalEntry(...)`).
 * Never throws — all failures are logged and swallowed; the cron resweep retries
 * anything left with enrichedAt = null.
 */
export async function enrichJournalEntry(
  silo: JournalSilo,
  id: string,
  text: string,
  opts: { notifyTelegram?: boolean } = {},
): Promise<void> {
  try {
    const body = text.trim();
    // Too short to ground/classify meaningfully — stamp + bail so the resweep
    // doesn't re-pick it. (Mirrors attributeText's 12-char floor.)
    if (body.length < 12) {
      await markEnriched(silo, id).catch(() => {});
      return;
    }

    const settings = await getJournalSettings();

    // 1. GROUND — load active goals (+ their stat links) and missions. Small
    //    set (operator has dozens, not thousands), so we feed them inline to
    //    the model rather than building an embedding index (YAGNI — verified
    //    goals aren't embedded and the candidate set is tiny).
    const [goals, missions] = await Promise.all([
      prisma.lifeGoal.findMany({
        where: { status: "active", deletedAt: null },
        select: { id: true, title: true, domain: true, statLinks: { select: { statKey: true, weight: true } } },
        take: 50,
      }).catch((): ActiveGoal[] => []),
      prisma.mission.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, title: true, domain: true },
        take: 50,
      }).catch((): ActiveMission[] => []),
    ]);

    // 2+3. CLASSIFY + LINK in one "reason" call. The model sees the candidate
    //      goals/missions and must return an id FROM THE LIST or null (we
    //      validate after, so a hallucinated id can't cause an FK violation).
    const goalMenu = goals.map((g) => `G:${g.id} — ${sanitizeForPrompt(g.title, 80)}`).join("\n") || "(none active)";
    const missionMenu = missions.map((m) => `M:${m.id} — ${sanitizeForPrompt(m.title, 80)}`).join("\n") || "(none active)";

    const res = await aiChat(
      [
        {
          role: "system",
          content: `You ground Nour's journal entry against what he is ACTUALLY working toward.

Return ONLY valid JSON:
{
  "entryType": "raw|thinking|reasoning|insight|decision|reflection|planning|venting",
  "domains": ["business|health|personal|finance|relationship|mastery"],
  "goalId": "<one G:<id> from the GOALS list, or null>",
  "missionId": "<one M:<id> from the MISSIONS list, or null>",
  "confidence": 0.0
}

Rules:
- entryType: the kind of thinking (default "raw" when unsure).
- goalId / missionId: ONLY an id that appears verbatim in the lists below, or null. Return the id WITHOUT the "G:"/"M:" prefix. Pick null unless the entry genuinely advances or reflects on that goal/mission — do NOT force a match.
- confidence: how sure you are of the goal/mission link, 0.0 (no link) to 1.0 (certain). If both ids are null, confidence is 0.
- Be honest. A wrong link is worse than no link.

GOALS:
${goalMenu}

MISSIONS:
${missionMenu}`,
        },
        { role: "user", content: sanitizeForPrompt(body, 1200) },
      ],
      "reason",
    );

    const parsed = extractJsonObject<{
      entryType?: string;
      domains?: unknown;
      goalId?: unknown;
      missionId?: unknown;
      confidence?: unknown;
    }>(res.content);

    if (!parsed.ok) {
      log.warn("journal_brain_parse_failed", { silo, id, raw: parsed.raw?.slice(0, 200) });
      await markEnriched(silo, id).catch(() => {});
      return;
    }
    const d = parsed.value;

    // Validate everything against reality before writing.
    const entryType: EntryType = ENTRY_TYPES.includes(d.entryType as EntryType)
      ? (d.entryType as EntryType)
      : "raw";
    const domains = Array.isArray(d.domains)
      ? d.domains.filter((x): x is string => typeof x === "string").slice(0, 6)
      : [];
    // Strip any stray "G:"/"M:" prefix the model leaves on, then confirm the id
    // is actually one we offered (kills hallucinated FKs).
    const rawGoalId = typeof d.goalId === "string" ? d.goalId.replace(/^G:/, "").trim() : "";
    const rawMissionId = typeof d.missionId === "string" ? d.missionId.replace(/^M:/, "").trim() : "";
    const goal = goals.find((g) => g.id === rawGoalId) ?? null;
    const mission = missions.find((m) => m.id === rawMissionId) ?? null;
    const confidence = Math.min(1, Math.max(0, typeof d.confidence === "number" ? d.confidence : 0));

    const grounding: Grounding = {
      entryType,
      domains,
      goalId: goal?.id ?? null,
      missionId: mission?.id ?? null,
      confidence: goal || mission ? confidence : 0,
    };

    // Link lifecycle: high-confidence auto-confirms; lower sits as "proposed"
    // until the operator taps ✓ (web chip / Telegram button). No link → null.
    const hasLink = !!(goal || mission);
    const status: LinkStatus | null = hasLink
      ? confidence >= settings.autoConfirmThreshold ? "auto" : "proposed"
      : null;

    await writeGrounding(silo, id, grounding, status);

    // 4. SCORE — grounded bonus only when the GOAL link is auto-confirmed.
    //    A "proposed" link defers its credit to the confirm mutation, so the
    //    operator confirming is what banks the bonus (matches the design:
    //    baseline rewards the habit on capture; grounded rewards the substance
    //    once the goal connection is trusted).
    let creditedStats: { statKey: string; xp: number }[] = [];
    if (status === "auto") {
      // Credit the directly-linked goal, OR (mission link only) the mission's
      // parent goal — so the 10 active missions route XP to their goal, not just
      // the 1 standalone goal (prod-profile finding).
      const creditGoal = goal ?? (mission ? await resolveCreditGoal(null, mission.id) : null);
      if (creditGoal) creditedStats = await creditGroundedGoalXp(id, creditGoal, settings);
    }

    // Telegram confirm surface · for telegram-originated captures with a
    // PROPOSED (not auto-confirmed) goal link, ping the operator to confirm
    // from their phone. Auto-confirmed links need no action; fire-and-forget.
    if (opts.notifyTelegram && goal && status === "proposed") {
      const { sendTelegramWithButtons } = await import("@/lib/services/telegram");
      await sendTelegramWithButtons(
        `🔗 Linked your journal note to a goal:\n<b>${goal.title}</b>\n\nConfirm?`,
        [
          [
            { text: "✓ Confirm", callback_data: `jlink:c:${silo}:${id}` },
            { text: "✗ No", callback_data: `jlink:r:${silo}:${id}` },
          ],
        ],
      ).catch(() => {});
    }

    // ─── Phase 2 · creative + challenge (the "sharp" layer) ──────────────
    // Bold, unrestricted idea generation + one pointed challenge, gated by
    // settings. Stored as a BrainMemory "take" keyed to the entry and surfaced
    // in the impact receipt. This is what makes the journal feel generative
    // rather than generic. Awaited inside the pass (still async vs capture).
    if (settings.creativeIntensity !== "off" || settings.challengeCadence !== "off") {
      await generateJournalTake(id, body, goal?.title ?? null, settings).catch((err) =>
        log.warn("journal_brain_take_failed", {
          silo, id, error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    // ─────────────────────────────────────────────────────────────────────

    log.info("journal_brain_enriched", {
      silo, id, entryType,
      goalId: grounding.goalId, missionId: grounding.missionId,
      confidence, status,
      creditedStats: creditedStats.length,
    });
  } catch (err) {
    log.warn("journal_brain_failed", {
      silo, id, error: err instanceof Error ? err.message : String(err),
    });
    // Leave enrichedAt null → the cron resweep will retry this entry.
  }
}

// resweepUnenriched (brain_dump-only durability sweep) was retired in the
// silo wave (audit 2026-07-15) — the mastery-xp cron now runs
// backfillJournalBrain({ limit: 15 }) which sweeps all 4 silos with the
// same idempotency guarantees.

/**
 * Phase 2 · the "sharp" layer. One "reason" call produces (a) a bold,
 * unrestricted creative idea/angle the entry sparks and (b) one pointed
 * challenge (counter-question / blind spot). Gated by settings:
 *   · creativeIntensity "bold" → daring, unconventional · "balanced" → grounded · "off" → no idea
 *   · challengeCadence    !== "off" → include a challenge
 * Stored as a BrainMemory "take" keyed to the entry (journal-take:<id>) and
 * surfaced in the impact receipt (trpc.journal.receipt). Never throws.
 */
async function generateJournalTake(
  id: string,
  text: string,
  goalTitle: string | null,
  settings: JournalSettingsValues,
): Promise<void> {
  const wantIdea = settings.creativeIntensity !== "off";
  const wantChallenge = settings.challengeCadence !== "off";
  if (!wantIdea && !wantChallenge) return;
  const tone =
    settings.creativeIntensity === "bold"
      ? "Be bold, unconventional, and unrestricted — no hedging, no safe platitudes. Push Nour somewhere he didn't expect."
      : "Be thoughtful, sharp, and grounded.";
  const goalLine = goalTitle ? `\nThis entry relates to his goal: "${goalTitle}".` : "";

  const res = await aiChat(
    [
      {
        role: "system",
        content: `You are Nick — Nour's sharp, loyal thinking partner reacting to his journal entry.${goalLine}

Return ONLY valid JSON:
{
  "idea": ${wantIdea ? '"one bold, specific, NON-OBVIOUS idea or angle this sparks (1-2 sentences)"' : "null"},
  "challenge": ${wantChallenge ? '"one sharp challenge — a counter-question, blind spot, or uncomfortable truth (1 sentence). Make him think; do NOT flatter."' : "null"},
  "nextAction": "ONE concrete next move WITH timing if this entry implies action — e.g. 'Tomorrow before 11am, 25 min on the highest-leverage business task before any entertainment.' Imperative and specific to his journey. Use null if the entry implies no real action — do NOT invent one.",
  "domain": "the life domain of that move: business|health|personal|finance|relationship|mastery — or null"
}

No preamble. Specific over generic. Blank beats fabricated: null the action if none is real. ${tone}`,
      },
      { role: "user", content: sanitizeForPrompt(text, 1000) },
    ],
    "reason",
  );

  const parsed = extractJsonObject<{ idea?: unknown; challenge?: unknown; nextAction?: unknown; domain?: unknown }>(res.content);
  if (!parsed.ok) return;
  const idea = typeof parsed.value.idea === "string" ? parsed.value.idea.trim().slice(0, 600) : null;
  const challenge = typeof parsed.value.challenge === "string" ? parsed.value.challenge.trim().slice(0, 400) : null;
  // Next-Action: the loop's "Act" step. Honest — null when the model returns no
  // real move (don't fabricate). Live-verify 2026-07-15: some models return the
  // literal STRING "null" instead of JSON null — that rendered "NEXT ACTION:
  // null [ACCEPT]" on /journal, so scrub null-ish strings here at the source.
  const rawAction = typeof parsed.value.nextAction === "string" ? parsed.value.nextAction.trim() : "";
  const actionText =
    rawAction && !["null", "none", "n/a"].includes(rawAction.toLowerCase()) ? rawAction.slice(0, 300) : null;
  const actionDomain = typeof parsed.value.domain === "string" ? parsed.value.domain.trim().slice(0, 24) : null;
  const nextAction = actionText ? { action: actionText, domain: actionDomain } : null;
  if (!idea && !challenge && !nextAction) return;

  const takeContent = JSON.stringify({ idea, challenge, nextAction });
  await prisma.brainMemory
    .upsert({
      where: { category_key: { category: "journal_brain_take", key: `journal-take:${id}` } },
      create: {
        category: "journal_brain_take",
        key: `journal-take:${id}`,
        content: takeContent,
        source: "journal_brain",
        confidence: 1,
      },
      update: { content: takeContent },
    })
    .catch(() => {});
}

export interface JournalBackfillResult {
  silo: JournalSilo;
  candidates: number;
  enriched: number;
}

/**
 * Phase 3 · backfill. Re-run the enrichment pass over historical entries
 * (enrichedAt = null) across the 4 silos, bounded by `limit` per silo, with an
 * opt `dryRun` that only COUNTS candidates. Idempotent — enrichJournalEntry's
 * grounded credit dedupes by sourceKey, so draining in repeated batches never
 * double-credits. The operator runs dryRun first to size the job, then drains.
 */
export async function backfillJournalBrain(
  opts: { silo?: JournalSilo; limit?: number; dryRun?: boolean } = {},
): Promise<JournalBackfillResult[]> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200);
  const silos: JournalSilo[] = opts.silo
    ? [opts.silo]
    : ["brain_dump", "reflection", "situation_log", "decision_replay"];
  const results: JournalBackfillResult[] = [];

  for (const silo of silos) {
    let rows: { id: string; text: string }[] = [];
    if (silo === "brain_dump") {
      // deletedAt filter (audit 2026-07-15) — without it the backfill
      // burns "reason" calls enriching soft-deleted/quarantined rows.
      const r = await prisma.brainDump
        .findMany({ where: { enrichedAt: null, deletedAt: null }, select: { id: true, rawThoughts: true }, orderBy: { createdAt: "desc" }, take: limit })
        .catch((): { id: string; rawThoughts: string }[] => []);
      rows = r.map((x) => ({ id: x.id, text: x.rawThoughts }));
    } else if (silo === "reflection") {
      const r = await prisma.reflection
        .findMany({ where: { enrichedAt: null, deletedAt: null }, select: { id: true, insight: true }, orderBy: { createdAt: "desc" }, take: limit })
        .catch((): { id: string; insight: string }[] => []);
      rows = r.map((x) => ({ id: x.id, text: x.insight }));
    } else if (silo === "situation_log") {
      const r = await prisma.situationLog
        .findMany({ where: { enrichedAt: null }, select: { id: true, situation: true }, orderBy: { createdAt: "desc" }, take: limit })
        .catch((): { id: string; situation: string }[] => []);
      rows = r.map((x) => ({ id: x.id, text: x.situation }));
    } else {
      const r = await prisma.decisionReplay
        .findMany({ where: { enrichedAt: null }, select: { id: true, title: true, context: true }, orderBy: { createdAt: "desc" }, take: limit })
        .catch((): { id: string; title: string; context: string | null }[] => []);
      rows = r.map((x) => ({ id: x.id, text: [x.title, x.context].filter(Boolean).join(" — ") }));
    }

    let enriched = 0;
    if (!opts.dryRun) {
      for (const row of rows) {
        await enrichJournalEntry(silo, row.id, row.text);
        enriched++;
      }
    }
    results.push({ silo, candidates: rows.length, enriched });
  }
  return results;
}

/**
 * Confirm or reject a proposed journal→goal link. SHARED by the tRPC
 * confirmLink mutation (web chip) AND the Telegram callback handler so there's
 * one source of truth. Accept → linkStatus="confirmed" + (idempotently) bank
 * the grounded XP bonus. Reject → clear the link + linkStatus="rejected".
 * Idempotent: creditGroundedGoalXp dedupes by sourceKey.
 */
export async function confirmJournalLink(
  silo: JournalSilo,
  id: string,
  accept: boolean,
): Promise<{ ok: boolean; accepted: boolean; creditedStats: { statKey: string; xp: number }[] }> {
  const sel = { goalId: true, missionId: true };
  const row =
    silo === "brain_dump"
      ? await prisma.brainDump.findUnique({ where: { id }, select: sel })
      : silo === "reflection"
        ? await prisma.reflection.findUnique({ where: { id }, select: sel })
        : silo === "situation_log"
          ? await prisma.situationLog.findUnique({ where: { id }, select: sel })
          : await prisma.decisionReplay.findUnique({ where: { id }, select: sel });
  if (!row) return { ok: false, accepted: accept, creditedStats: [] };

  const data = accept
    ? { linkStatus: "confirmed" }
    : { linkStatus: "rejected", goalId: null, missionId: null };
  if (silo === "brain_dump") await prisma.brainDump.update({ where: { id }, data });
  else if (silo === "reflection") await prisma.reflection.update({ where: { id }, data });
  else if (silo === "situation_log") await prisma.situationLog.update({ where: { id }, data });
  else await prisma.decisionReplay.update({ where: { id }, data });

  let creditedStats: { statKey: string; xp: number }[] = [];
  if (accept) {
    // Direct goal link, else the linked mission's parent goal (mission→goal).
    const creditGoal = await resolveCreditGoal(row.goalId ?? null, row.missionId ?? null);
    if (creditGoal) {
      const settings = await getJournalSettings();
      creditedStats = await creditGroundedGoalXp(id, creditGoal, settings);
    }
  }
  return { ok: true, accepted: accept, creditedStats };
}
