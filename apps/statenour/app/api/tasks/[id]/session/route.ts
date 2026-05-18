/**
 * POST /api/tasks/:id/session — log a session event against an active
 * task. Apr 19.
 *
 * Types:
 *   • note    → text note / transcript (string)
 *   • photo   → base64 data URL or image URL
 *   • voice   → transcribed voice note (text) + optional audio URL
 *   • log     → progress log line
 *
 * All session events land in BrainMemory with category="task_session"
 * and a composite key `session:{taskId}:{ts}`. Metadata carries kind,
 * taskTitle, and optional attachment refs so the /tasks detail view
 * can replay the session timeline.
 *
 * GET /api/tasks/:id/session returns all session events for the task
 * ordered oldest-first, so the active-task companion can show a live
 * running log + the full /tasks detail page can render a transcript.
 */

import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

type Kind = "note" | "photo" | "voice" | "log";

interface Body {
  kind?: Kind;
  text?: string;
  photoUrl?: string;        // base64 data URL or remote URL
  audioUrl?: string;        // optional audio attachment
  durationMs?: number;      // voice recording duration
}

interface TaskSessionPayload {
  kind: Kind;
  taskTitle: string;
  text?: string;
  photoUrl?: string;
  audioUrl?: string;
  durationMs?: number;
  createdAt: string;
}

export const POST = apiHandler(
  async (req, { params }) => {
    const { id } = (await params) ?? { id: "" };
    if (!id) throw new ServiceError("task id required", 400);

    const body = await readRequestJson<Body>(req);
    const kind: Kind = body.kind ?? "note";
    if (!["note", "photo", "voice", "log"].includes(kind)) {
      throw new ServiceError(`invalid kind: ${kind}`, 400);
    }

    const task = await prisma.task
      .findUnique({ where: { id }, select: { id: true, title: true } })
      .catch(() => null);
    if (!task) throw new ServiceError("task not found", 404);

    // Build the session memory row. Content is a short human-readable
    // summary for grep-ability; payload lives in metadata.
    const ts = Date.now();
    const text = (body.text ?? "").trim();
    const summary =
      kind === "photo"
        ? `photo · ${task.title}`
        : kind === "voice"
          ? `voice · ${task.title} · ${text.slice(0, 80)}`
          : kind === "log"
            ? `log · ${task.title} · ${text.slice(0, 80)}`
            : `note · ${task.title} · ${text.slice(0, 80)}`;

    const payload: TaskSessionPayload = {
      kind,
      taskTitle: task.title,
      text: text || undefined,
      photoUrl: body.photoUrl,
      audioUrl: body.audioUrl,
      durationMs: body.durationMs,
      createdAt: new Date(ts).toISOString(),
    };

    const mem = await prisma.brainMemory.create({
      data: {
        category: BRAIN_CATEGORIES.TASK_SESSION,
        key: `session:${id}:${ts}`,
        source: "ultron-desk",
        content: summary,
        confidence: 0.75,
        metadata: {
          taskId: id,
          ...(payload as unknown as Record<string, unknown>),
        },
      },
    });

    return { ok: true, sessionId: mem.id, kind, createdAt: payload.createdAt };
  },
  { auth: "owner" },
);

export const GET = apiHandler(
  async (_req, { params }) => {
    const { id } = (await params) ?? { id: "" };
    if (!id) throw new ServiceError("task id required", 400);

    const rows = await prisma.brainMemory
      .findMany({
        where: { category: BRAIN_CATEGORIES.TASK_SESSION, key: { startsWith: `session:${id}:` } },
        orderBy: { createdAt: "asc" },
        take: 100,
        select: {
          id: true,
          content: true,
          metadata: true,
          createdAt: true,
        },
      })
      .catch((): never[] => []);

    const events = rows.map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        kind: (meta.kind as Kind) ?? "note",
        text: typeof meta.text === "string" ? meta.text : undefined,
        photoUrl: typeof meta.photoUrl === "string" ? meta.photoUrl : undefined,
        audioUrl: typeof meta.audioUrl === "string" ? meta.audioUrl : undefined,
        durationMs: typeof meta.durationMs === "number" ? meta.durationMs : undefined,
        createdAt: r.createdAt.toISOString(),
      };
    });

    return { ok: true, taskId: id, events };
  },
  { auth: "owner" },
);
