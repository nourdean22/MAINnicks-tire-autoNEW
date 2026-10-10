import { cronHandler } from "@/lib/utils/http";
import { runAutonomicOrchestrator } from "@/lib/services/autonomic-orchestrator";

export const maxDuration = 120; // 2 minutes: heals crons and trips provider circuit breakers

export const GET = cronHandler(async () => {
  const result = await runAutonomicOrchestrator();
  return {
    status: "ok",
    ...result,
  };
});
