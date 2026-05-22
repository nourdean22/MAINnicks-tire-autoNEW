/**
 * lib/services/task-session.ts · Phase B.6b (2026-05-22 ·
 * legacy-modernizer REST→tRPC ultron slice · task-domain sub-slice).
 *
 * Task working-session service · extracted from
 * `app/api/tasks/[id]/session/route.ts` so the legacy REST endpoints
 * (GET + POST) AND the new `trpc.task.{session,logSessionEvent}`
 * procedures both call this single pair of functions · drift between
 * the two consumers is structurally impossible. Same shared-service
 * pattern as the Z / B.5 chat slices.
 *
 * A working session is a stream of timestamped events tied to a task:
 *   · note    → text note / transcript
 *   · photo   → base64 data URL or remote image URL
 *   · voice   → transcribed voice note (+ optional audio URL + duration)
 *   · log     → progress log line
 *
 * Events land in BrainMemory with category="task_session" and a
 * composite key `session:{taskId}:{ts}`. Metadata carries kind,
 * taskTitle, and optional attachment refs so the /tasks detail view
 * can replay the session timeline. Behaviour preserved verbatim from
 * the route handler.
 */

import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export type TaskSessionKind = "note" | "photo" | "voice" | "log";

const VALID_KINDS: readonly TaskSessionKind[] = [
  "note",
  "photo",
  "voice",
  "log",
];

/**
 * Shallow, explicit row shape for the session read procedure. Returning
 * the raw `prisma.brainMemory.findMany({ select })` type (the metadata
 * Json column) leaks Prisma's recursive `JsonValue` machinery into the
 * AppRouter type · past a certain router size that surfaces as TS2589
 * at consumer `.useQuery` call-sites. The route already projects the
 * Json column down to these scalar fields; this flat interface keeps
 * the procedure's public type shallow. Mirrors the `TaskEventRow`
 * pattern at the top of `lib/trpc/routers/task.ts`.
 */
export interface TaskSessionEvent {
  id: string;
  kind: TaskSessionKind;
  text?: string;
  photoUrl?: string;
  audioUrl?: string;
  durationMs?: number;
  createdAt: string;
}

export interface LogSessionEventArgs {
  taskId: string;
  kind?: TaskSessionKind;
  text?: string;
  /** base64 data URL or remote URL. */
  photoUrl?: string;
  /** optional audio attachment. */
  audioUrl?: string;
  /** voice recording duration. */
  durationMs?: number;
}

export interface LogSessionEventResult {
  ok: true;
  sessionId: string;
  kind: TaskSessionKind;
  createdAt: string;
}

export interface TaskSessionView {
  ok: true;
  taskId: string;
  events: TaskSessionEvent[];
}

/**
 * Read all session events for a task, oldest-first, capped at 100.
 * Lifted verbatim from GET /api/tasks/[id]/session · same effects.
 */
export async function getTaskSession(
  taskId: string,
): Promise<TaskSessionView> {
  if (!taskId) throw new ServiceError("task id required", 400);

  const rows = await prisma.brainMemory
    .findMany({
      where: {
        category: BRAIN_CATEGORIES.TASK_SESSION,
        key: { startsWith: `session:${taskId}:` },
      },
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

  const events: TaskSessionEvent[] = rows.map((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      kind: (meta.kind as TaskSessionKind) ?? "note",
      text: typeof meta.text === "string" ? meta.text : undefined,
      photoUrl: typeof meta.photoUrl === "string" ? meta.photoUrl : undefined,
      audioUrl: typeof meta.audioUrl === "string" ? meta.audioUrl : undefined,
      durationMs:
        typeof meta.durationMs === "number" ? meta.durationMs : undefined,
      createdAt: r.createdAt.toISOString(),
    };
  });

  return { ok: true, taskId, events };
}

/**
 * Log one session event against a task. Lifted verbatim from
 * POST /api/tasks/[id]/session · same effects (404 on missing task,
 * 400 on bad kind, BrainMemory row write).
 */
export async function logSessionEvent(
  args: LogSessionEventArgs,
): Promise<LogSessionEventResult> {
  const { taskId } = args;
  if (!taskId) throw new ServiceError("task id required", 400);

  const kind: TaskSessionKind = args.kind ?? "note";
  if (!VALID_KINDS.includes(kind)) {
    throw new ServiceError(`invalid kind: ${kind}`, 400);
  }

  const task = await prisma.task
    .findUnique({ where: { id: taskId }, select: { id: true, title: true } })
    .catch(() => null);
  if (!task) throw new ServiceError("task not found", 404);

  // Build the session memory row. Content is a short human-readable
  // summary for grep-ability; payload lives in metadata.
  const ts = Date.now();
  const text = (args.text ?? "").trim();
  const summary =
    kind === "photo"
      ? `photo · ${task.title}`
      : kind === "voice"
        ? `voice · ${task.title} · ${text.slice(0, 80)}`
        : kind === "log"
          ? `log · ${task.title} · ${text.slice(0, 80)}`
          : `note · ${task.title} · ${text.slice(0, 80)}`;

  const createdAt = new Date(ts).toISOString();
  const payload = {
    kind,
    taskTitle: task.title,
    text: text || undefined,
    photoUrl: args.photoUrl,
    audioUrl: args.audioUrl,
    durationMs: args.durationMs,
    createdAt,
  };

  const mem = await prisma.brainMemory.create({
    data: {
      category: BRAIN_CATEGORIES.TASK_SESSION,
      key: `session:${taskId}:${ts}`,
      source: "ultron-desk",
      content: summary,
      confidence: 0.75,
      metadata: {
        taskId,
        ...(payload as unknown as Record<string, unknown>),
      },
    },
  });

  return { ok: true, sessionId: mem.id, kind, createdAt };
}
