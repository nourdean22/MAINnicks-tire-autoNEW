/**
 * POST /api/undo/[token] · v10.0.529.97 · Wave 41
 *
 * One-shot undo for chat-driven mutating tools. After every undo-able
 * tool execute() captures the pre-mutation state into a BrainMemory
 * row (category="undo_token", expiresAt=now+30s) and returns the
 * token in its output. The tool-result card surfaces an "Undo" tap
 * affordance for 30s · tapping POSTs here.
 *
 * Supported tools (Wave 41 launch):
 *   · snoozeTask   · restore status, clear snoozedUntil
 *   · archiveGoal  · restore status, clear deletedAt
 *
 * Idempotent: multiple POSTs against the same token return the same
 * result (the row is soft-deleted on first successful revert; a
 * second attempt finds the consumedAt marker and returns ok=true
 * without re-running the revert).
 *
 * Errors:
 *   404 · token not found OR expired
 *   400 · token payload malformed (defensive · should never happen)
 *   200 · revert succeeded OR was already consumed
 *
 * Fires notifyDataChanged-equivalent · the bus is browser-side so the
 * client wraps this POST and triggers the bus on success.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";

export const runtime = "nodejs";

interface UndoPayload {
  toolName: "snoozeTask" | "archiveGoal";
  taskId?: string;
  goalId?: string;
  originalStatus: string;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  await requireSession(req);

  const { token } = await ctx.params;
  if (!token || typeof token !== "string" || token.length < 8) {
    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 400 });
  }

  const row = await prisma.brainMemory.findFirst({
    where: {
      category: "undo_token",
      key: token,
    },
    select: { id: true, content: true, expiresAt: true, deletedAt: true },
  });

  if (!row) {
    return NextResponse.json({ ok: false, error: "token not found" }, { status: 404 });
  }

  // Already consumed · idempotent return
  if (row.deletedAt) {
    return NextResponse.json({ ok: true, alreadyUndone: true });
  }

  // Expired (>30s old · cron / next reads should clean these up)
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ ok: false, error: "token expired" }, { status: 404 });
  }

  let payload: UndoPayload;
  try {
    payload = JSON.parse(row.content) as UndoPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "malformed token payload" }, { status: 400 });
  }

  try {
    // v10.0.529.97 · Wave 41 · dispatch revert by toolName. Each branch
    // is small + idempotent. Adding a new tool to undo means adding a
    // branch here and writing the matching undo_token in the tool
    // execute() · no schema migration required.
    switch (payload.toolName) {
      case "snoozeTask": {
        if (!payload.taskId) {
          return NextResponse.json({ ok: false, error: "missing taskId" }, { status: 400 });
        }
        await prisma.task.update({
          where: { id: payload.taskId },
          data: {
            status: payload.originalStatus as "INBOX" | "READY" | "DOING" | "WAITING" | "DONE",
            snoozedUntil: null,
            lastTouchedAt: new Date(),
          },
        });
        break;
      }
      case "archiveGoal": {
        if (!payload.goalId) {
          return NextResponse.json({ ok: false, error: "missing goalId" }, { status: 400 });
        }
        await prisma.lifeGoal.update({
          where: { id: payload.goalId },
          data: {
            status: payload.originalStatus,
            deletedAt: null,
            updatedAt: new Date(),
          },
        });
        break;
      }
      default: {
        return NextResponse.json(
          { ok: false, error: `unsupported toolName: ${payload.toolName}` },
          { status: 400 },
        );
      }
    }

    // Mark token consumed · subsequent POSTs hit the alreadyUndone branch.
    await prisma.brainMemory
      .update({ where: { id: row.id }, data: { deletedAt: new Date() } })
      .catch(() => null);

    return NextResponse.json({
      ok: true,
      undone: true,
      toolName: payload.toolName,
      entityId: payload.taskId ?? payload.goalId,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
