/**
 * lib/services/mission-links.ts · v10.0.421
 *
 * CRUD for mission-to-mission links. Each link points from one
 * mission ("source") to another ("target") with an optional relation
 * type ("depends-on", "blocks", "related" / null=related).
 *
 * Design notes:
 *
 *   · We store links DIRECTIONALLY but expose them BIDIRECTIONALLY
 *     in `getLinksFor(missionId)` · operator viewing mission A sees
 *     all of (A→X, A→Y) outbound + (P→A, Q→A) inbound. Most operators
 *     don't think in arrows, they think "what's connected".
 *
 *   · `relation` is freeform-with-conventions. We don't enum-gate it
 *     so future relation types can be added without migrations. The
 *     UI shows known types as colored chips, unknown ones as plain.
 *
 *   · CASCADE on the DB side handles cleanup when a mission is
 *     hard-deleted. Soft-delete leaves links in place · operator can
 *     restore + the links are still there.
 */

import { prisma } from "@/lib/prisma";
import { activeOnly } from "@/lib/db/soft-delete";

export interface MissionLinkRow {
  id: string;
  sourceId: string;
  targetId: string;
  relation: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
  /** present when fetched via getLinksFor · the OTHER mission's title */
  otherMission?: { id: string; title: string; status: string; domain: string };
  /** "outbound" if this mission is the source · "inbound" if target */
  direction?: "outbound" | "inbound";
}

const VALID_RELATIONS = new Set([
  "depends-on",
  "blocks",
  "related",
  "supersedes",
  "spawned-from",
]);

function normalizeRelation(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed === "related") return null;
  if (!VALID_RELATIONS.has(trimmed)) return null;
  return trimmed;
}

/**
 * Create a link from source → target. Idempotent · if the link
 * already exists, return the existing row instead of failing on
 * the unique constraint.
 *
 * Throws if sourceId === targetId (DB also blocks via CHECK constraint).
 */
export async function createMissionLink(args: {
  sourceId: string;
  targetId: string;
  relation?: string | null;
  note?: string | null;
  createdBy?: string;
}): Promise<MissionLinkRow> {
  const { sourceId, targetId } = args;
  if (sourceId === targetId) {
    throw new Error("cannot link a mission to itself");
  }
  const relation = normalizeRelation(args.relation);
  const note = args.note?.slice(0, 500) ?? null;

  // Verify both missions exist + are not soft-deleted
  const [source, target] = await Promise.all([
    prisma.mission.findFirst({
      where: activeOnly({ id: sourceId }),
      select: { id: true },
    }),
    prisma.mission.findFirst({
      where: activeOnly({ id: targetId }),
      select: { id: true },
    }),
  ]);
  if (!source) throw new Error(`source mission ${sourceId} not found`);
  if (!target) throw new Error(`target mission ${targetId} not found`);

  // Upsert via unique key (sourceId, targetId)
  const link = await prisma.missionLink.upsert({
    where: { sourceId_targetId: { sourceId, targetId } },
    update: { relation, note },
    create: {
      sourceId,
      targetId,
      relation,
      note,
      createdBy: args.createdBy ?? "user",
    },
  });
  return link as MissionLinkRow;
}

/**
 * Delete a link by id.
 */
export async function deleteMissionLink(id: string): Promise<{ ok: boolean }> {
  await prisma.missionLink.delete({ where: { id } }).catch((err) => {
    // P2025 = record not found · idempotent delete
    const code = (err as { code?: string }).code;
    if (code !== "P2025") throw err;
  });
  return { ok: true };
}

/**
 * Get all links touching `missionId` (both outbound + inbound).
 * Each row carries the OTHER mission's identity + a direction flag.
 *
 * Returns the union, deduped by other-mission-id (if A→B and B→A
 * both exist, surface both rows separately so operator sees the
 * relationship from both sides).
 */
export async function getLinksFor(
  missionId: string,
): Promise<MissionLinkRow[]> {
  const [outbound, inbound] = await Promise.all([
    prisma.missionLink.findMany({
      where: { sourceId: missionId },
      include: {
        target: {
          select: { id: true, title: true, status: true, domain: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.missionLink.findMany({
      where: { targetId: missionId },
      include: {
        source: {
          select: { id: true, title: true, status: true, domain: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const out: MissionLinkRow[] = [];
  for (const l of outbound) {
    out.push({
      id: l.id,
      sourceId: l.sourceId,
      targetId: l.targetId,
      relation: l.relation,
      note: l.note,
      createdBy: l.createdBy,
      createdAt: l.createdAt,
      otherMission: l.target,
      direction: "outbound",
    });
  }
  for (const l of inbound) {
    out.push({
      id: l.id,
      sourceId: l.sourceId,
      targetId: l.targetId,
      relation: l.relation,
      note: l.note,
      createdBy: l.createdBy,
      createdAt: l.createdAt,
      otherMission: l.source,
      direction: "inbound",
    });
  }
  return out;
}

export const MISSION_LINK_RELATIONS = [
  { value: "related", label: "related" },
  { value: "depends-on", label: "depends on" },
  { value: "blocks", label: "blocks" },
  { value: "supersedes", label: "supersedes" },
  { value: "spawned-from", label: "spawned from" },
];
