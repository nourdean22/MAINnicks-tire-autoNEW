/**
 * POST /api/drive/sync
 *
 * Manual Google Drive ingest trigger. Runs the same pipeline as the
 * scheduled cron (/api/cron/ingest-drive) but on demand — used by
 * the Settings "Sync Now" button, the `syncDriveMemory` chat tool,
 * and the Prompt Inspector's "Refresh Cold Memory" action.
 *
 * Returns the full ingest stats so the UI can show a toast with
 * concrete numbers ("Ingested 3 new docs, 2 skipped, 4.1s").
 *
 * Body (optional):
 *   { actor?: string, limit?: number }
 *     actor — label for the audit event ("user_sync", "nick_tool_call", etc.)
 *     limit — how many recent files to consider (default 25, max 100)
 */

import { runDriveIngest } from "@/lib/brain/drive-ingest";
import { recordError } from "@/lib/errors/record-error";

import { requireSession } from "@/lib/auth-guard";
export const maxDuration = 300;

export async function POST(req: Request) {
  await requireSession(req);
  try {
    const body = (await req.json().catch(() => ({}))) as {
      actor?: string;
      limit?: number;
    };

    const limit = Math.min(100, Math.max(1, body.limit ?? 25));
    const actor = body.actor || "user_sync";

    const result = await runDriveIngest({
      limit,
      actor,
      source: "drive_manual_sync",
    });

    return Response.json(result);
  } catch (err) {
    recordError("chat:post-process", err, { stage: "drive-sync-route" });
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Sync failed",
        stored: 0,
        skippedCount: 0,
        categoryCounts: {},
        errors: [],
        durationMs: 0,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/drive/sync
 *
 * Returns cold memory stats (how much is indexed, when last sync ran,
 * coverage). Used by Settings to show the current state without
 * triggering a new sync.
 */
export async function GET() {
  try {
    const { getColdMemoryStats } = await import("@/lib/brain/cold-memory");
    const stats = await getColdMemoryStats();
    return Response.json(stats);
  } catch (err) {
    recordError("chat:post-process", err, { stage: "drive-stats" });
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Stats failed",
      },
      { status: 500 }
    );
  }
}
