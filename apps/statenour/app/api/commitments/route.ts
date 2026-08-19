import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import { today } from "@/lib/utils/datetime";
import { logUpdate, stripNoise } from "@/lib/db/entity-audit";
import { emitCommitmentTransition } from "@/lib/db/brain-bus-emit";
// hooks-lib REST→tRPC slice (2026-05-22) · the commitment-create
// service · also called by the new `operator.createCommitment` tRPC
// procedure (the `/commit` chat direct-action) · drift impossible.
import { createCommitment } from "@/lib/services/commitments";

// v10.0.37 — owner-gated. Pre-fix unauthed.
export const GET = apiHandler(async () => {
  // v8.24 · soft-delete retrofit. Commitments use deletedAt for the
  // archive-but-don't-purge pattern; without filtering, archived rows
  // would still show on the dashboard.
  // v10.0.37 — exclude overdue from active so the two arrays don't
  // overlap (every overdue was also matching the active filter,
  // double-rendering on the dashboard + inflating counts).
  const active = await prisma.commitment.findMany({
    where: {
      status: { in: ["active", "in_progress"] },
      deletedAt: null,
      OR: [{ deadline: null }, { deadline: { gte: today() } }],
    },
    orderBy: { deadline: "asc" },
  });

  const overdue = await prisma.commitment.findMany({
    where: {
      status: { in: ["active", "in_progress"] },
      deletedAt: null,
      deadline: { not: null, lt: today() },
    },
  });

  const statsRaw = await prisma.commitment.groupBy({
    by: ["status"],
    _count: { _all: true },
    where: { deletedAt: null },
  });
  const stats = statsRaw.map((s) => ({ status: s.status, count: s._count._all }));

  const total = stats.reduce((sum, s) => sum + s.count, 0);
  // Every dominant completion writer (completeCommitment tool,
  // completeActiveCommitment, REST bulk complete) writes status
  // "completed" — only legacy rows say "kept". Counting "kept" alone made
  // keep_rate read ~0% regardless of actual behavior.
  const kept = stats
    .filter((s) => s.status === "kept" || s.status === "completed")
    .reduce((sum, s) => sum + s.count, 0);
  const keepRate = total > 0 ? Math.round((kept / total) * 100) : 0;

  return { active, overdue, stats, keep_rate: keepRate };
}, { auth: "owner" });

// v10.0.255 audit fix · POST was unauthenticated. Continued the same
// audit sweep that fixed v10.0.253 (missions POST), v10.0.254
// (missions [id] PATCH/DELETE), and the goals POST/PATCH/DELETE in
// the same v10.0.255 commit. Anyone could create / update / archive
// commitments · which would corrupt the keep-rate stat, the brain-bus
// transitions, and the daily brief. Now owner-gated.
export const POST = apiHandler(async (req) => {
  const body = await req.json();

  if (body.action === "update" && body.id) {
    // v8.0 — capture before-state for entity-audit diff.
    const before = await prisma.commitment.findUnique({ where: { id: body.id } });
    const updated = await prisma.commitment.update({
      where: { id: body.id },
      data: { status: body.status, notes: body.notes || null },
    });
    if (before) {
      void logUpdate(
        "commitment",
        String(updated.id),
        stripNoise(before as unknown as Record<string, unknown>),
        stripNoise(updated as unknown as Record<string, unknown>),
        { source: "api:commitments.POST.update" },
      );
      // v10.0.63 · brain-bus producer · emit on actual status change
      // only (re-saves with same status are no-ops). Decision-pattern
      // engine reads commitment_event BrainMemory rows to learn the
      // transition arc.
      if (before.status !== updated.status) {
        void emitCommitmentTransition({
          commitmentId: updated.id,
          oldStatus: before.status,
          newStatus: updated.status,
          description: updated.description,
          toWhom: updated.toWhom ?? null,
          domain: updated.domain ?? null,
          transitionedAt: new Date().toISOString(),
        });
      }
    }
    return { ok: true };
  }

  // Bulk update — apply the same status (kept/broken/expired) to an
  // array of commitment IDs. Added so the /commitments page can offer
  // multi-select triage without hammering the endpoint one-by-one.
  if (body.action === "bulk_update" && Array.isArray(body.ids) && body.status) {
    const ids: number[] = body.ids
      .map((n: unknown) => Number(n))
      .filter((n: number) => Number.isFinite(n));
    if (ids.length === 0) return { ok: true, updated: 0 };
    // v10.0.63 · capture per-row state for the brain-bus emit. Reading
    // before+after lets us emit one transition event per actual change.
    const before = await prisma.commitment
      .findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          status: true,
          description: true,
          toWhom: true,
          domain: true,
        },
      })
      .catch((): Array<{ id: number; status: string; description: string; toWhom: string | null; domain: string | null }> => []);
    const result = await prisma.commitment.updateMany({
      where: { id: { in: ids } },
      data: { status: body.status },
    });
    // v10.0.63 · emit one transition event per row whose status
    // actually changed. Same-id+newStatus+minute-bucket dedupe in the
    // emit wrapper handles bulk-action retries.
    const ts = new Date().toISOString();
    for (const c of before) {
      if (c.status !== body.status) {
        void emitCommitmentTransition({
          commitmentId: c.id,
          oldStatus: c.status,
          newStatus: body.status,
          description: c.description,
          toWhom: c.toWhom,
          domain: c.domain,
          transitionedAt: ts,
        });
      }
    }
    return { ok: true, updated: result.count };
  }

  // Expire stale — mark all active commitments older than N days
  // (default 30) as "expired". Useful for bulk-cleaning the 120
  // commitment pile that nobody's going to keep.
  if (body.action === "expire_stale") {
    const days = Number(body.days ?? 30);
    const cutoff = new Date(Date.now() - days * 86400000);
    const cutoffIso = cutoff.toISOString().slice(0, 10);
    const result = await prisma.commitment.updateMany({
      where: {
        status: { in: ["active", "in_progress"] },
        dateMade: { lt: cutoffIso },
      },
      data: { status: "expired" },
    });
    return { ok: true, expired: result.count, olderThanDays: days };
  }

  const { to_whom, description, deadline, domain } = body;
  if (!description) throw new ServiceError("description required", 400);

  // hooks-lib REST→tRPC slice (2026-05-22) · the create branch moved
  // to the shared `commitments.createCommitment` so this legacy REST
  // consumer AND the new `operator.createCommitment` tRPC procedure
  // can't drift. The other branches stay inline (no tRPC consumer).
  return createCommitment({
    description,
    toWhom: to_whom,
    deadline,
    domain,
  });
}, { auth: "owner" });
