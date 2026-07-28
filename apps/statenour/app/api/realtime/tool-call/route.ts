/**
 * POST /api/realtime/tool-call · v10.0.529.100 · Wave 44
 *
 * Voice-mode tool dispatcher. The OpenAI Realtime session has tools
 * declared at mint-time (see ../session/route.ts REALTIME_TOOLS).
 * When the model decides to fire a tool, the data channel emits
 * `response.function_call_arguments.done`. The client picks that up
 * (hooks/use-realtime-voice.ts) and POSTs here with { name, arguments }.
 *
 * We dispatch by `name` to the canonical service, return the result,
 * and the client streams it back into the Realtime session as a
 * function_call_output so the agent can continue speaking with the
 * outcome in context.
 *
 * Wave 44 launches with ONE tool: createTask. Add more by:
 *   1. Declaring the tool in REALTIME_TOOLS (session route)
 *   2. Adding a case in the switch below
 *   3. Returning the result the agent should speak about
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { createTask } from "@/lib/services/tasks";
import { checkTask } from "@/lib/services/task-actions";
import { resolveInboxMissionId } from "@/lib/services/missions";
import { prisma } from "@/lib/prisma";
import { emitTaskEventAsync } from "@/lib/brain/task-events";
import { logger as rootLogger } from "@/lib/logger";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

export const runtime = "nodejs";

const log = rootLogger.withSurface("api/realtime/tool-call");

interface ToolCallBody {
  name?: string;
  arguments?: Record<string, unknown>;
  callId?: string;
}

export async function POST(req: NextRequest) {
  await requireSession(req);

  let body: ToolCallBody;
  try {
    body = (await req.json()) as ToolCallBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const name = body.name;
  const args = body.arguments ?? {};
  if (!name || typeof name !== "string") {
    return NextResponse.json({ ok: false, error: "missing tool name" }, { status: 400 });
  }

  try {
    switch (name) {
      case "createTask": {
        const title = typeof args.title === "string" ? args.title.slice(0, 200) : "";
        if (!title) {
          return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
        }
        const inboxMissionId = await resolveInboxMissionId();
        const created = await createTask({
          title,
          missionId: inboxMissionId,
          status: "INBOX",
          nextPhysicalAction:
            typeof args.nextPhysicalAction === "string" && args.nextPhysicalAction
              ? args.nextPhysicalAction.slice(0, 200)
              : title,
          effort: typeof args.effort === "string" ? args.effort : "M15",
          roiScore: args.loopKind === "PROMISE" ? 80 : 50,
          frictionScore: 30,
          energyRequired: "MEDIUM",
          context: typeof args.context === "string" ? args.context : "ANYWHERE",
          finishCondition: title,
          loopKind: typeof args.loopKind === "string" ? args.loopKind : "ONCE",
          dueDate: typeof args.dueDate === "string" ? new Date(args.dueDate) : null,
          promiseTo: typeof args.promiseTo === "string" ? args.promiseTo : null,
          autoPriorityExplanation: "captured via voice (Realtime API)",
        });
        log.info("voice_tool_createTask", {
          callId: body.callId,
          taskId: created?.id,
          title: title.slice(0, 60),
        });
        // Concise result the agent will speak back · keep under 30 words.
        return NextResponse.json({
          ok: true,
          result: created
            ? `Task captured: "${created.title}" · in your inbox · id ${created.id.slice(0, 8)}`
            : "Task captured (no view-model returned).",
        });
      }
      case "snoozeTask": {
        // v10.0.529.101 · Wave 45 · mirrors lib/ai/tools.ts snoozeTask
        // execute · captures originalStatus for undo + flips to WAITING
        // + sets snoozedUntil to 7am on the target day.
        const days = typeof args.days === "number" ? Math.max(1, Math.min(365, Math.floor(args.days))) : 0;
        if (!days) {
          return NextResponse.json({ ok: false, error: "days required (1-365)" }, { status: 400 });
        }
        const taskId = typeof args.taskId === "string" ? args.taskId : undefined;
        const titleQuery = typeof args.titleQuery === "string" ? args.titleQuery : undefined;

        let target = taskId
          ? await prisma.task.findUnique({
              where: { id: taskId },
              select: { id: true, title: true, status: true },
            })
          : null;
        if (!target && titleQuery) {
          const candidates = await prisma.task.findMany({
            where: {
              status: { in: ["INBOX", "READY", "DOING"] },
              title: { contains: titleQuery, mode: "insensitive" },
              deletedAt: null,
            },
            orderBy: { lastTouchedAt: "desc" },
            take: 1,
            select: { id: true, title: true, status: true },
          });
          target = candidates[0] ?? null;
        }
        if (!target) {
          return NextResponse.json({ ok: true, result: "I couldn't find that task." });
        }

        const wakeAt = new Date();
        wakeAt.setDate(wakeAt.getDate() + days);
        wakeAt.setHours(7, 0, 0, 0);

        const originalStatus = target.status;
        await prisma.task.update({
          where: { id: target.id },
          data: { status: "WAITING", snoozedUntil: wakeAt, lastTouchedAt: new Date() },
        });
        emitTaskEventAsync({
          taskId: target.id,
          kind: "snoozed",
          source: "voice:snoozeTask",
          payload: { days, wakeAt: wakeAt.toISOString() },
        });
        // Wave 41 undo token (30s · same pattern as lib/ai/tools.ts)
        const undoToken = `undo_${target.id}_${Date.now()}`;
        await prisma.brainMemory
          .create({
            data: {
              category: "undo_token",
              key: undoToken,
              content: JSON.stringify({
                toolName: "snoozeTask",
                taskId: target.id,
                originalStatus,
              }),
              source: "voice-tool",
              confidence: 1.0,
              expiresAt: new Date(Date.now() + 30 * 1000),
              createdBy: "nick",
            },
          })
          .catch(() => null);

        const label = days === 1 ? "tomorrow" : days === 7 ? "next week" : `${days} days`;
        log.info("voice_tool_snoozeTask", { callId: body.callId, taskId: target.id, days });
        return NextResponse.json({
          ok: true,
          result: `Snoozed "${target.title.slice(0, 40)}" until ${label}.`,
        });
      }

      case "completeTask": {
        // v10.0.529.101 · Wave 45 · resolve the target by id or title,
        // then delegate the completion itself to the shared checkTask
        // service (streaks, idempotency, XP/stat credit, goal lift).
        const taskId = typeof args.taskId === "string" ? args.taskId : undefined;
        const titleQuery = typeof args.titleQuery === "string" ? args.titleQuery : undefined;

        let target = taskId
          ? await prisma.task.findUnique({
              where: { id: taskId },
              select: { id: true, title: true, loopKind: true, streakCount: true, lastCompletedAt: true, status: true },
            })
          : null;
        if (!target && titleQuery) {
          const candidates = await prisma.task.findMany({
            where: {
              status: { in: ["INBOX", "READY", "DOING"] },
              title: { contains: titleQuery, mode: "insensitive" },
              deletedAt: null,
            },
            orderBy: { lastTouchedAt: "desc" },
            take: 1,
            select: { id: true, title: true, loopKind: true, streakCount: true, lastCompletedAt: true, status: true },
          });
          target = candidates[0] ?? null;
        }
        if (!target) {
          return NextResponse.json({ ok: true, result: "I couldn't find that task." });
        }

        // Voice completions go through the shared checkTask spine — the
        // previous raw prisma.task.update path earned NO stat/XP credit,
        // no goal lift, no brain-bus emit, used UTC day-math for streaks,
        // and killed WEEKLY loops by flipping them to permanent DONE.
        // checkTask handles all four loop kinds + same-day idempotency.
        const res = await checkTask({ id: target.id, action: "complete" });

        if (res.idempotent) {
          return NextResponse.json({
            ok: true,
            result: `"${target.title.slice(0, 40)}" already checked off today · streak ${res.streakCount ?? target.streakCount} preserved.`,
          });
        }

        // checkTask does not emit a TaskEvent itself — keep the voice
        // source attribution the history/pattern views rely on.
        emitTaskEventAsync({
          taskId: target.id,
          kind: "completed",
          source: "voice:completeTask",
          ...(res.task?.streakCount != null ? { payload: { streakCount: res.task.streakCount } } : {}),
        });

        if (target.loopKind === "DAILY" || target.loopKind === "WEEKLY") {
          const streak = res.task?.streakCount ?? 1;
          log.info("voice_tool_completeTask_daily", { callId: body.callId, taskId: target.id, streakCount: streak });
          return NextResponse.json({
            ok: true,
            result: `Done · ${streak} day streak on "${target.title.slice(0, 40)}".`,
          });
        }

        log.info("voice_tool_completeTask", { callId: body.callId, taskId: target.id });
        return NextResponse.json({
          ok: true,
          result: `Done · "${target.title.slice(0, 60)}" complete.`,
        });
      }

      case "pinMemory": {
        // v10.0.529.101 · Wave 45 · mirrors lib/ai/tools.ts pinMemory
        // execute · upserts a pinned_user BrainMemory row + flushes the
        // prompt cache so the next chat turn sees the pin immediately.
        const content = typeof args.content === "string" ? args.content.slice(0, 1200) : "";
        if (!content || content.length < 5) {
          return NextResponse.json({ ok: false, error: "content required (>= 5 chars)" }, { status: 400 });
        }
        const label = typeof args.label === "string" ? args.label.slice(0, 40) : undefined;
        const slug = content
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 60) + "-" + Date.now().toString(36).slice(-6);

        const row = await prisma.brainMemory.upsert({
          where: { id: `pin-${slug}` },
          create: {
            id: `pin-${slug}`,
            category: BRAIN_CATEGORIES.PINNED_USER,
            key: slug,
            content,
            metadata: label ? { label } : undefined,
            source: "pin:voice",
            confidence: 1.0,
            createdBy: "nick",
          },
          update: {
            content,
            metadata: label ? { label } : undefined,
            updatedAt: new Date(),
          },
        });

        // Hot-flush the prompt cache so the next chat turn sees the pin
        // without waiting for the 45s TTL (same as /pins page does on
        // manual pin · Wave 34 pattern).
        void prisma.brainMemory.deleteMany({
          where: { category: "system_prompt_cache" },
        }).catch((e) => {
          logError("realtime.tool-call", e, { stage: "prompt-cache-flush" }, "warn");
          return null;
        });

        log.info("voice_tool_pinMemory", { callId: body.callId, pinId: row.id, label });
        return NextResponse.json({
          ok: true,
          result: `Pinned${label ? ` (${label})` : ""}: ${content.slice(0, 60)}${content.length > 60 ? "…" : ""}`,
        });
      }

      default:
        return NextResponse.json(
          { ok: false, error: `unknown tool: ${name}` },
          { status: 400 },
        );
    }
  } catch (err) {
    log.error("voice_tool_failed", {
      name,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
