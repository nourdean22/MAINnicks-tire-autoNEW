import { runConversationMissionLinkBackfill } from "@/lib/db/conversation-mission-linker";
import { cronHandler } from "@/lib/utils/http";

export const maxDuration = 120;

export const GET = cronHandler(async () => {
  const started = Date.now();
  const report = await runConversationMissionLinkBackfill();
  return { ok: true, durationMs: Date.now() - started, ...report };
});
