/**
 * Persona Drift Detector · v10.0.529.32 · Arc B Feature 4 · Ghost Nick
 *
 * Mirrors the contradiction-surfacer pattern. Detects when Nick's
 * recent replies drift from the operator's stated 8-axis identity ·
 * the apr-19 brain_learning_architecture overlay (BrainMemory category
 * "identity_snapshot" key "current"). Standalone DETECTION loop ·
 * doesn't touch the chat reply pipeline · drift events land in
 * BrainMemory(category="persona_drift") for operator review via the
 * existing SituationCard meta-aggregator.
 *
 * Phase 1 = detection-only. Regeneration (the original Arc B vision's
 * "regenerate with persona-anchor") is deliberately Phase 2 · risky to
 * silently rewrite Nick's outputs without operator review. Detection
 * surfaces the gap; the operator decides whether to update the 8-axis
 * spec (their values shifted) or treat as a false-positive.
 *
 * Architecture:
 *   1. computePersonaVector() · render identity_snapshot to text,
 *      embed, cache in module memory keyed by identity_snapshot's
 *      updatedAt (rotates when the operator engages with /mastery).
 *   2. scanRecentReplies() · fetch last N hours of assistant ChatMessages,
 *      join their precomputed embeddings from vector_embeddings, compute
 *      cosine against persona vector. Below the similarity floor =
 *      drift. Persist via upsert into BrainMemory(category="persona_drift").
 *   3. loadRecentDrifts() · helper for downstream surfaces (situation
 *      card meta-aggregator · future dedicated drift card).
 *
 * Idempotency contract:
 *   · Persist key = sha1(messageId) · re-runs of the scan don't
 *     duplicate. The metadata.detectedAt advances on re-detection so
 *     downstream surfaces see fresh-ness even if the underlying
 *     reply is the same.
 *
 * Threshold tuning rationale:
 *   · Cosine similarity floor = 0.60 (drift > 0.40). The Arc B vision
 *     specified ">0.4 drift" which maps to similarity < 0.60. Tight
 *     enough that off-topic replies surface · loose enough that normal
 *     domain variance (Nick answering about cars vs philosophy)
 *     doesn't fire constantly.
 *   · The identity_snapshot text-render uses ALL 8 axes so the
 *     vector covers the full operator-self-model surface. Limited
 *     vector means narrow-topic replies could false-positive ·
 *     accepted trade-off for Phase 1 (detection is suggestive, not
 *     authoritative).
 */

import { prisma } from "@/lib/prisma";
import { createHash } from "node:crypto";
import { getEmbedding } from "@/lib/ai/provider";
import { cosineSimilarity } from "@/lib/brain/embedding-utils";
import { logger as rootLogger } from "@/lib/logger";
import { logError } from "@/lib/utils/error-log";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { sanitizeForPrompt } from "@/lib/ai/prompt/sanitize";

const log = rootLogger.withSurface("brain/persona-drift-detector");

/** Cosine similarity floor · below this = drift event. */
export const DRIFT_SIMILARITY_FLOOR = 0.6;

/** How many hours of recent assistant replies to scan per pass. */
const DEFAULT_SCAN_WINDOW_HOURS = 6;

/** Maximum messages scanned per pass · keeps the cron snappy. */
const SCAN_MESSAGE_CAP = 60;

// ── Persona vector cache · keyed by identity_snapshot.updatedAt ──────

interface PersonaVectorCache {
  vec: number[];
  renderedFor: string; // ISO timestamp of identity_snapshot.updatedAt
  computedAt: number;
}

let personaCache: PersonaVectorCache | null = null;

/**
 * Render the 8-axis identity snapshot to a paragraph of natural
 * language that captures Nour's stated self-model. The text is what
 * gets embedded · the embedding is the persona vector.
 *
 * Exported for unit testing so the prompt shape stays stable as a
 * contract between this detector and the embedding provider.
 */
export function renderIdentityToText(
  snap: { axes: Record<string, { value: number; manual: number | null; direction: string }> },
): string {
  const lines: string[] = [
    "Operator self-model · 8-axis identity overlay. This is who the operator stated they are at the latest snapshot point.",
  ];
  for (const [axisName, axis] of Object.entries(snap.axes)) {
    const effective = axis.manual ?? axis.value;
    const directionWord =
      axis.direction === "rising"
        ? "rising"
        : axis.direction === "falling"
          ? "falling"
          : "stable";
    lines.push(
      `${axisName.replace(/_/g, " ")}: ${effective}/100 · ${directionWord}`,
    );
  }
  lines.push(
    "Reply alignment context: the operator favors clarity, depth, and editorial-minimalist density. Long preambles, generic AI-slop, and surface-level summaries drift from this self-model.",
  );
  return lines.join("\n");
}

/**
 * Get the operator's persona vector. Cached in module memory keyed by
 * the identity_snapshot.updatedAt · rotates automatically when the
 * operator engages with /mastery and the snapshot regenerates. Returns
 * null when the snapshot is missing OR the embedding provider is
 * unavailable · upstream callers degrade silently.
 */
export async function computePersonaVector(): Promise<number[] | null> {
  const snap = await prisma.brainMemory
    .findUnique({
      where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
      select: { content: true, updatedAt: true },
    })
    .catch(() => null);
  if (!snap?.content) return null;

  const updatedAtIso = snap.updatedAt.toISOString();
  if (personaCache && personaCache.renderedFor === updatedAtIso) {
    return personaCache.vec;
  }

  let parsed: { axes?: Record<string, { value: number; manual: number | null; direction: string }> };
  try {
    parsed = JSON.parse(snap.content);
  } catch {
    log.warn("identity_snapshot_unparsable", { length: snap.content.length });
    return null;
  }
  if (!parsed.axes || Object.keys(parsed.axes).length === 0) {
    return null;
  }

  const text = renderIdentityToText({ axes: parsed.axes });
  const vec = await getEmbedding(text);
  if (vec.length === 0) {
    // Embedding provider down · don't cache · retry next call.
    return null;
  }

  personaCache = { vec, renderedFor: updatedAtIso, computedAt: Date.now() };
  return vec;
}

// ── Drift detection types ────────────────────────────────────────────

export interface DriftEvent {
  message_id: string;
  conversation_id: string;
  similarity: number;
  drift: number; // 1 - similarity · easier to read at the call site
  excerpt: string;
  detected_at: string;
  persona_snapshot_at: string; // identity_snapshot.updatedAt at detection time
}

export interface StoredDrift extends DriftEvent {
  key: string;
  createdAt: string;
}

function buildDriftKey(messageId: string): string {
  return createHash("sha1").update(`drift::${messageId}`).digest("hex").slice(0, 16);
}

// ── Main scan ────────────────────────────────────────────────────────

/**
 * Scan recent assistant replies for persona drift. Designed for cron
 * use (every 4h) · also callable on-demand. Quiet on failures · the
 * detection is supplementary, not load-critical.
 */
export async function scanRecentReplies(opts?: {
  windowHours?: number;
  floor?: number;
  cap?: number;
}): Promise<{ scanned: number; drifted: number; events: DriftEvent[] }> {
  const windowHours = opts?.windowHours ?? DEFAULT_SCAN_WINDOW_HOURS;
  const floor = opts?.floor ?? DRIFT_SIMILARITY_FLOOR;
  const cap = opts?.cap ?? SCAN_MESSAGE_CAP;
  const since = new Date(Date.now() - windowHours * 3600_000);

  const persona = await computePersonaVector();
  if (!persona) {
    log.info("scan_skipped_no_persona", { windowHours });
    return { scanned: 0, drifted: 0, events: [] };
  }

  // Pull recent assistant ChatMessages that have embeddings stored.
  // We join via vector_embeddings.sourceId = ChatMessage.id since the
  // embed-backfill cron stamps `sourceType="chat_message"` with the
  // chat message id as sourceId. Messages without embeddings (very
  // recent · backfill hasn't run yet) are skipped this pass · the
  // next scan picks them up after backfill catches up.
  const recentMessages = await prisma.chatMessage
    .findMany({
      where: {
        role: "assistant",
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: cap,
      select: { id: true, content: true, conversationId: true, createdAt: true },
    })
    .catch((): never[] => []);

  if (recentMessages.length === 0) {
    return { scanned: 0, drifted: 0, events: [] };
  }

  const messageIds = recentMessages.map((m) => m.id);
  const embeddings = await prisma.vectorEmbedding
    .findMany({
      where: { sourceType: "chat_message", sourceId: { in: messageIds } },
      select: { sourceId: true, embedding: true },
    })
    .catch((): never[] => []);
  const embeddingByMsgId = new Map<string, number[]>();
  let malformedEmbeddings = 0;
  for (const row of embeddings) {
    try {
      const vec = JSON.parse(row.embedding) as number[];
      if (Array.isArray(vec) && vec.length > 0) {
        embeddingByMsgId.set(row.sourceId, vec);
      }
    } catch {
      // skip malformed embedding · embed-backfill will rewrite next pass ·
      // aggregated below (up to 60 rows per 4h cron pass)
      malformedEmbeddings++;
    }
  }
  if (malformedEmbeddings > 0) {
    logError(
      "brain.persona-drift-detector",
      new Error(`${malformedEmbeddings} malformed embedding rows skipped`),
      { fn: "scanRecentReplies", malformedEmbeddings, scanned: embeddings.length },
      "warn",
    );
  }

  const events: DriftEvent[] = [];
  const detectedAtIso = new Date().toISOString();
  const personaSnapshotAt =
    personaCache?.renderedFor ?? new Date().toISOString();

  for (const msg of recentMessages) {
    const vec = embeddingByMsgId.get(msg.id);
    if (!vec) continue;
    const sim = cosineSimilarity(vec, persona);
    if (sim >= floor) continue;
    const drift = Number((1 - sim).toFixed(3));
    events.push({
      message_id: msg.id,
      conversation_id: msg.conversationId,
      similarity: Number(sim.toFixed(3)),
      drift,
      excerpt: msg.content.replace(/\s+/g, " ").slice(0, 200).trim(),
      detected_at: detectedAtIso,
      persona_snapshot_at: personaSnapshotAt,
    });
  }

  // Persist drift events · upsert by stable key so re-runs don't dup.
  // Best-effort · failures don't propagate · downstream surfaces just
  // see partial drift data instead of a thrown 500.
  for (const ev of events) {
    const key = buildDriftKey(ev.message_id);
    await prisma.brainMemory
      .upsert({
        where: { category_key: { category: "persona_drift", key } },
        create: {
          category: "persona_drift",
          key,
          content: JSON.stringify(ev),
          confidence: ev.drift, // higher drift = stronger signal
          source: "persona_drift_detector",
        },
        update: {
          content: JSON.stringify(ev),
          confidence: ev.drift,
          lastSeen: new Date(),
        },
      })
      .catch((err) => {
        log.warn("drift_persist_failed", {
          messageId: ev.message_id,
          error: err instanceof Error ? err.message.slice(0, 200) : String(err),
        });
      });
  }

  log.info("persona_drift_scan_complete", {
    scanned: recentMessages.length,
    drifted: events.length,
    windowHours,
  });

  return {
    scanned: recentMessages.length,
    drifted: events.length,
    events,
  };
}

// ── Read helper for downstream surfaces ──────────────────────────────

/**
 * Load recent drift events for surface consumption. Soft-delete + the
 * 7d default window keep the result set tight · downstream surfaces
 * (SituationCard, future drift card) only want active signal.
 */
export async function loadRecentDrifts(
  windowDays: number = 7,
): Promise<StoredDrift[]> {
  const since = new Date(Date.now() - windowDays * 86400_000);
  const rows = await prisma.brainMemory
    .findMany({
      where: {
        category: "persona_drift",
        createdAt: { gte: since },
        deletedAt: null,
      },
      orderBy: { confidence: "desc" }, // strongest drift first
      take: 20,
      select: { key: true, content: true, createdAt: true },
    })
    .catch((): never[] => []);
  const out: StoredDrift[] = [];
  let malformed = 0;
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.content) as DriftEvent;
      out.push({ ...parsed, key: r.key, createdAt: r.createdAt.toISOString() });
    } catch {
      // skip malformed row · aggregated below — this loop is on the
      // situation-card read path, and parse errors can embed excerpt content
      malformed++;
    }
  }
  if (malformed > 0) {
    logError(
      "brain.persona-drift-detector",
      new Error(`${malformed} malformed persona_drift rows skipped`),
      { fn: "loadRecentDrifts", malformed, scanned: rows.length },
      "warn",
    );
  }
  return out;
}

/** Count helper · cheap badge data for chips + situation card. */
export async function countRecentDrifts(windowDays: number = 7): Promise<number> {
  const since = new Date(Date.now() - windowDays * 86400_000);
  return prisma.brainMemory
    .count({
      where: {
        category: "persona_drift",
        createdAt: { gte: since },
        deletedAt: null,
      },
    })
    .catch(() => 0);
}

// ── v10.0.529.38 · operator dismiss/snooze actions ───────────────────

export type DriftResolution = "dismiss" | "snooze" | "acknowledge";

/**
 * Resolve a drift event. "dismiss" soft-deletes the row · the operator
 * judged the detection a false positive. "snooze" stamps a snoozeUntil
 * timestamp so the card hides it for 7d (re-surfaces if it triggers
 * again past that). "acknowledge" stamps acknowledgedAt without
 * hiding · the operator saw it · the row stays visible until it
 * naturally expires from the 7d window.
 */
export async function resolveDriftEvent(
  key: string,
  resolution: DriftResolution,
  note?: string,
): Promise<{ ok: boolean }> {
  const row = await prisma.brainMemory
    .findUnique({
      where: { category_key: { category: "persona_drift", key } },
      select: { id: true, content: true },
    })
    .catch(() => null);
  if (!row) return { ok: false };

  if (resolution === "dismiss") {
    await prisma.brainMemory
      .update({
        where: { id: row.id },
        data: {
          deletedAt: new Date(),
          confidence: 0.1, // floor so downstream consumers see it as low-signal even if they bypass deletedAt
        },
      })
      .catch(() => undefined);
  } else {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(row.content) as Record<string, unknown>;
    } catch {
      // proceed with empty parsed · the resolution metadata still lands ·
      // static message — parse errors can embed excerpt content
      logError(
        "brain.persona-drift-detector",
        new Error("malformed persona_drift row content"),
        { fn: "resolveDriftEvent", key, resolution },
        "warn",
      );
    }
    const updated = {
      ...parsed,
      resolution,
      resolved_at: new Date().toISOString(),
      resolution_note: note ?? null,
      snooze_until:
        resolution === "snooze"
          ? new Date(Date.now() + 7 * 86400_000).toISOString()
          : null,
    };
    await prisma.brainMemory
      .update({
        where: { id: row.id },
        data: {
          content: JSON.stringify(updated),
          lastSeen: new Date(),
        },
      })
      .catch(() => undefined);
  }

  log.info("drift_resolved", { key, resolution });
  return { ok: true };
}

/**
 * Load drift events for the dedicated review card. Filters out
 * dismissed (soft-deleted) AND snoozed-not-yet-expired. Same sort
 * as the situation source (confidence desc · strongest drift first).
 */
export async function loadActiveDrifts(
  windowDays: number = 7,
): Promise<StoredDrift[]> {
  const since = new Date(Date.now() - windowDays * 86400_000);
  const rows = await prisma.brainMemory
    .findMany({
      where: {
        category: "persona_drift",
        createdAt: { gte: since },
        deletedAt: null,
      },
      orderBy: { confidence: "desc" },
      take: 20,
      select: { key: true, content: true, createdAt: true },
    })
    .catch((): never[] => []);
  const out: StoredDrift[] = [];
  const now = Date.now();
  let malformed = 0;
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.content) as DriftEvent & {
        snooze_until?: string | null;
        resolution?: DriftResolution;
      };
      // Hide snoozed events whose snooze window hasn't expired yet.
      if (parsed.snooze_until) {
        const until = Date.parse(parsed.snooze_until);
        if (Number.isFinite(until) && until > now) continue;
      }
      out.push({ ...parsed, key: r.key, createdAt: r.createdAt.toISOString() });
    } catch {
      // skip malformed row · aggregated below (read path, excerpt content)
      malformed++;
    }
  }
  if (malformed > 0) {
    logError(
      "brain.persona-drift-detector",
      new Error(`${malformed} malformed persona_drift rows skipped`),
      { fn: "loadActiveDrifts", malformed, scanned: rows.length },
      "warn",
    );
  }
  return out;
}

// ── v10.0.529.36 · F4 Phase 2 · pre-emptive persona-anchor injection ──
//
// Rationale: post-process REGENERATION (the original Arc B vision)
// silently rewrites Nick's output if drift > 0.4 cosine. Risks:
//   · doubles latency on every drifting reply
//   · silent rewriting can degrade quality if the persona-anchored
//     regen happens to lose information the first reply nailed
//   · operator can't see the original to compare
//
// This Phase-2 approach is cleaner: BEFORE Nick generates a reply,
// inject the operator's 8-axis identity as a system-prompt anchor.
// The reply emerges already aligned · drift-detector still scans
// post-hoc to catch alignment failures · no rewriting · no doubled
// latency · operator's stated identity always present in context.
//
// Caching · the prompt text only changes when identity_snapshot
// rotates (operator engages with /mastery and the snapshot
// regenerates). 5-minute TTL is plenty for the chat hot path.

interface PersonaAnchorCache {
  text: string;
  snapshotUpdatedAt: string;
  loadedAt: number;
}

let personaAnchorCache: PersonaAnchorCache | null = null;
const PERSONA_ANCHOR_TTL_MS = 5 * 60 * 1000;

/**
 * Build the operator's persona-anchor block for chat-system-prompt
 * injection. Returns empty string when:
 *   · identity_snapshot is missing (fresh-OS · operator hasn't
 *     engaged with /mastery yet · zero injection cost)
 *   · the JSON blob is unparsable (corrupted row · same fallthrough)
 *
 * Safe to call from the hot chat path · cached + defensive · never
 * throws · never blocks generation.
 */
export async function getPersonaAnchorPrompt(): Promise<string> {
  // Quick cache hit · cheap TTL check before any DB read
  if (
    personaAnchorCache &&
    Date.now() - personaAnchorCache.loadedAt < PERSONA_ANCHOR_TTL_MS
  ) {
    return personaAnchorCache.text;
  }

  const snap = await prisma.brainMemory
    .findUnique({
      where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
      select: { content: true, updatedAt: true },
    })
    .catch(() => null);
  if (!snap?.content) return "";

  let parsed: { axes?: Record<string, { value: number; manual: number | null; direction: string }> };
  try {
    parsed = JSON.parse(snap.content);
  } catch {
    return "";
  }
  if (!parsed.axes || Object.keys(parsed.axes).length === 0) return "";

  // Tight prose block · NOT the same as renderIdentityToText (which is
  // optimized for embedding · this one is optimized for in-prompt
  // operator-context reading). The 8 axes get one-line summaries with
  // direction · the model reads "this is who they ARE" rather than
  // "embed this for similarity."
  const lines: string[] = [
    `## Operator identity anchor (8-axis self-model · ground truth)`,
    `Nour's stated current self-model · use as the alignment anchor when generating replies. If the axis value is < 35/100 the operator self-reports as that pole; > 65/100 the opposite pole; 35-65 = neutral. Direction tells whether the axis is currently rising / falling / stable. Anchor your reply tone + frame to this profile.`,
    ``,
  ];
  for (const [axisName, axis] of Object.entries(parsed.axes)) {
    const effective = axis.manual ?? axis.value;
    const arrow =
      axis.direction === "rising"
        ? "↑"
        : axis.direction === "falling"
          ? "↓"
          : "→";
    const pole =
      effective < 35
        ? "low"
        : effective > 65
          ? "high"
          : "balanced";
    lines.push(`- ${axisName.replace(/_/g, " ")}: ${effective}/100 ${arrow} (${pole})`);
  }
  lines.push(``);
  lines.push(
    `Drift is detected post-hoc when the reply embedding falls below 0.6 cosine similarity to this anchor. Aligning here reduces drift events and preserves the operator's stated identity in Nick's voice.`,
  );

  // v10.0.529.43 · Arc B F4 Phase 3 · behavioral-corpus enrichment.
  // When the operator has imported their text corpus (ChatGPT export ·
  // iCloud Notes · journals · etc) via scripts/import-persona-corpus.ts,
  // a centroid is available in BrainMemory(category=
  // "behavioral_persona_vector") AND a structured voice profile from
  // persona-corpus-analyzer is in BrainMemory(category=
  // "behavioral_persona_profile"). Prefer the structured profile when
  // present (concrete tells the model can act on) · fall back to the
  // raw "corpus available" hint when only the centroid exists.
  try {
    const [{ loadBehavioralPersonaCentroid }, { loadPersonaProfile }] = await Promise.all([
      import("@/lib/brain/persona-corpus-importer"),
      import("@/lib/brain/persona-corpus-analyzer"),
    ]);
    const [behavioral, profile] = await Promise.all([
      loadBehavioralPersonaCentroid(),
      loadPersonaProfile(),
    ]);
    if (profile) {
      lines.push(``);
      lines.push(`## Operator voice profile (from corpus · ${profile.sampleSize} utterances)`);
      // 2026-07-11 review · profile.summary interpolates raw top-phrases
      // extracted from the operator's IMPORTED corpus (ChatGPT export,
      // iCloud Notes, journals) which can contain pasted third-party text.
      // Fence it before it enters the system prompt.
      lines.push(sanitizeForPrompt(profile.summary, 1200));
      lines.push(
        `Use these tells as the alignment target when phrasing replies. The 8-axis above is the operator's STATED self-model; this profile is their ACTUAL recorded voice — when the two diverge, the recorded voice usually wins for tone, the stated self-model usually wins for values.`,
      );
    } else if (behavioral && behavioral.utteranceCount > 0) {
      lines.push(``);
      lines.push(
        `Behavioral corpus available · ${behavioral.utteranceCount} operator-authored utterances embedded as the ground-truth voice anchor. Lean toward the operator's actual recorded voice over a generic helpful tone.`,
      );
    }
  } catch (err) {
    // Behavioral enrichment is optional · failure degrades silently to
    // the identity-only anchor.
    logError("brain.persona-drift-detector", err, { fn: "getPersonaAnchorPrompt" }, "warn");
  }

  const text = lines.join("\n");
  personaAnchorCache = {
    text,
    snapshotUpdatedAt: snap.updatedAt.toISOString(),
    loadedAt: Date.now(),
  };
  return text;
}

/**
 * Force a cache invalidation · called when the identity_snapshot row
 * is known to have rotated (e.g. operator just engaged with /mastery
 * scoring) so the NEXT chat turn picks up the fresh anchor instead of
 * waiting up to 5 minutes for the TTL to expire.
 */
export function invalidatePersonaAnchorCache(): void {
  personaAnchorCache = null;
}
