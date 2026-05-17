import { cronHandler } from "@/lib/utils/http";
import { runPredictions, evaluatePredictions } from "@/lib/brain/predictive-engine";
import { discoverConnections } from "@/lib/brain/relational-graph";
export const maxDuration = 60;

/**
 * GET /api/cron/predict — Layer 5 + Layer 6 combined cron
 *
 * 1. Evaluate past predictions (did they come true?)
 * 2. Generate new predictions based on current trends
 * 3. Discover new connections in the relational graph
 */
export const GET = cronHandler(async () => {
  // Layer 5: Check past predictions
  const evaluation = await evaluatePredictions();

  // Layer 5: Generate new predictions
  const newPredictions = await runPredictions();

  // Layer 6: Auto-discover connections between entities
  const graphDiscovery = await discoverConnections();

  return {
    layer5: {
      evaluated: evaluation,
      newPredictions: {
        saved: newPredictions.saved,
        predictions: newPredictions.predictions,
      },
    },
    layer6: {
      connectionsDiscovered: graphDiscovery.discovered,
    },
  };
});
