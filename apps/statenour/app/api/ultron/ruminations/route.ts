// CP7 · force-dynamic · Railway build cannot reach Neon during static
// prerender. Runtime semantics unchanged (cached() makes these effectively
// dynamic on Vercel too).
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

import { requireSession } from "@/lib/auth-guard";
import { auditUpdate } from "@/lib/db/actor";
import { logUpdate } from "@/lib/db/entity-audit";
/**
 * GET /api/ultron/ruminations
 *
 * Surfaces items Nour is over-thinking. Currently draws from two pools:
 *
 *   1. Pending decision replays whose reviewAt is in the past — these are
 *      decisions he made 30/60/90 days ago and scheduled to review, but
 *      never did. The longer they age unreviewed, the more likely they
 *      are rumination fuel.
 *
 *   2. Overdue commitments (Loop.loopKind=PROMISE with deadline<today).
 *
 * Each item has a "force a call" set of actions:
 *   - YES   → mark the decision reviewed with outcome="kept"
 *   - NO    → mark reviewed with outcome="abandoned"
 *   - LATER → push reviewAt forward one week (+ log the push)
 *
 * PATCH /api/ultron/ruminations  { id, action: "YES"|"NO"|"LATER", reason? }
 */

export interface RuminationItem {
  kind: "decision" | "commitment";
  id: string;
  title: string;
  ageDays: number;
  reason: string;          // one-liner why Ultron flagged it
  suggestedActions: Array<"YES" | "NO" | "LATER">;
  meta?: Record<string, unknown>;
}

export async function GET() {
  try {
    const now = new Date();
    const [decisions, overdueLoops] = await Promise.all([
      prisma.decisionReplay.findMany({
        where: { reviewed: false, reviewAt: { lte: now } },
        orderBy: { reviewAt: "asc" },
        take: 10,
        select: {
          id: true,
          title: true,
          choiceMade: true,
          reasoning: true,
          reviewAt: true,
          createdAt: true,
        },
      }).catch(() => []),
      prisma.task.findMany({
        where: {
          loopKind: "PROMISE",
          status: { notIn: ["DONE", "ARCHIVED"] },
          dueDate: { lt: now },
          deletedAt: null,
        },
        orderBy: { dueDate: "asc" },
        take: 5,
        select: { id: true, title: true, dueDate: true, promiseTo: true, createdAt: true },
      }).catch(() => []),
    ]);

    const items: RuminationItem[] = [];

    for (const d of decisions) {
      const ageDays = Math.floor((now.getTime() - d.reviewAt.getTime()) / 86400000);
      items.push({
        kind: "decision",
        id: d.id,
        title: d.title,
        ageDays,
        reason:
          ageDays > 14
            ? `review due ${ageDays}d ago — decision rotting`
            : `review overdue — 30 sec to close this loop`,
        suggestedActions: ["YES", "NO", "LATER"],
        meta: { choiceMade: d.choiceMade, reasoning: d.reasoning },
      });
    }

    for (const l of overdueLoops) {
      const dueTs = l.dueDate ? l.dueDate.getTime() : l.createdAt.getTime();
      const ageDays = Math.floor((now.getTime() - dueTs) / 86400000);
      items.push({
        kind: "commitment",
        id: l.id,
        title: l.title,
        ageDays,
        reason:
          l.promiseTo
            ? `promised ${l.promiseTo} — ${ageDays}d overdue`
            : `promise overdue ${ageDays}d — resolve or explicitly abandon`,
        suggestedActions: ["YES", "NO", "LATER"],
        meta: { promiseTo: l.promiseTo },
      });
    }

    return NextResponse.json({
      data: {
        items,
        counts: {
          decisions: decisions.length,
          commitments: overdueLoops.length,
          total: items.length,
        },
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        data: { items: [], counts: { decisions: 0, commitments: 0, total: 0 }, generatedAt: new Date().toISOString() },
        error: String(err),
      },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  await requireSession(req);
  try {
    const body = (await req.json()) as {
      kind?: "decision" | "commitment";
      id?: string;
      action?: "YES" | "NO" | "LATER";
      reason?: string;
    };
    if (!body.id || !body.action || !body.kind) {
      return NextResponse.json({ error: "id, kind, action required" }, { status: 400 });
    }

    if (body.kind === "decision") {
      if (body.action === "LATER") {
        const nextReviewAt = new Date(Date.now() + 7 * 86400000);
        await prisma.decisionReplay.update({
          where: { id: body.id },
          data: { reviewAt: nextReviewAt },
        });
      } else {
        await prisma.decisionReplay.update({
          where: { id: body.id },
          data: {
            reviewed: true,
            reviewedAt: new Date(),
            outcome: body.action === "YES" ? "kept" : "abandoned",
            lesson: body.reason || null,
          },
        });
      }
    } else if (body.kind === "commitment") {
      // v9.1.19 · attach actor + entity-audit on both branches.
      const before = await prisma.task.findUnique({
        where: { id: body.id },
        select: { id: true, status: true, dueDate: true, lastTouchedAt: true },
      });
      if (body.action === "LATER") {
        const nextDue = new Date(Date.now() + 7 * 86400000);
        const after = await prisma.task.update({
          where: { id: body.id },
          data: {
            dueDate: nextDue,
            lastTouchedAt: new Date(),
            ...auditUpdate(),
          },
          select: { id: true, status: true, dueDate: true, lastTouchedAt: true },
        });
        if (before) {
          void logUpdate(
            "task",
            body.id,
            before as Record<string, unknown>,
            after as Record<string, unknown>,
            { source: "ultron:ruminations.LATER", reason: "deferred 7d" },
          );
        }
      } else {
        const after = await prisma.task.update({
          where: { id: body.id },
          data: {
            status: body.action === "YES" ? "DONE" : "ARCHIVED",
            lastTouchedAt: new Date(),
            ...auditUpdate(),
          },
          select: { id: true, status: true, dueDate: true, lastTouchedAt: true },
        });
        if (before) {
          void logUpdate(
            "task",
            body.id,
            before as Record<string, unknown>,
            after as Record<string, unknown>,
            {
              source: "ultron:ruminations",
              reason: body.action === "YES" ? "kept (DONE)" : "abandoned (ARCHIVED)",
            },
          );
        }
      }
    }

    return NextResponse.json({ data: { ok: true } });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
