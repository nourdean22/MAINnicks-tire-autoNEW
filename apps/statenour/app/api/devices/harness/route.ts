import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { harnessNodeKey, harnessPcLabel, harnessSnapshotSchema } from "@/lib/services/harness-status";
import { heartbeatRunner } from "@/lib/services/runner-state";
import { ServiceError } from "@/lib/utils/service-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/devices/harness: a PC stores its read-only harness snapshot.
 * Writes one RunnerNode row and returns nothing a PC could act on: this door carries no commands.
 * Sender: scripts/agent-os/harness-snapshot.mjs. Readers: lib/services/harness-status.ts.
 */
export const POST = apiHandler(
  async (req) => {
    const parsed = harnessSnapshotSchema.safeParse(await readRequestJson(req));
    if (!parsed.success) throw new ServiceError("Invalid harness snapshot", 400);
    const snapshot = parsed.data;
    await heartbeatRunner({
      nodeKey: harnessNodeKey(snapshot.pc),
      label: harnessPcLabel(snapshot.pc),
      status: "READY",
      version: snapshot.sha,
      metadata: { harnessSnapshot: snapshot },
    });
    return { ok: true };
  },
  { auth: "device" },
);
