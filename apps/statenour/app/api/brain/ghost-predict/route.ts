/**
 * GET /api/brain/ghost-predict — current Ghost Nick bundle + accuracy.
 * POST → force recompute.
 */
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import {
  getGhostPredictions,
  computeGhostPredictions,
  loadGhostAccuracy,
  dismissPrediction,
} from "@/lib/brain/ghost-nick";
import { ServiceError } from "@/lib/utils/service-error";

export const GET = apiHandler(
  async () => {
    const [bundle, accuracy] = await Promise.all([
      getGhostPredictions(),
      loadGhostAccuracy(),
    ]);
    return { bundle, accuracy };
  },
  { auth: "owner" },
);

export const POST = apiHandler(
  async () => {
    const [bundle, accuracy] = await Promise.all([
      computeGhostPredictions(),
      loadGhostAccuracy(),
    ]);
    return { bundle, accuracy, recomputed: true };
  },
  { auth: "owner" },
);

interface PatchBody {
  action?: "dismiss";
  taskIdOrTitle?: string;
}

export const PATCH = apiHandler(
  async (req) => {
    const body = await readRequestJson<PatchBody>(req);
    if (body.action !== "dismiss") throw new ServiceError("unknown action", 400);
    if (!body.taskIdOrTitle) throw new ServiceError("taskIdOrTitle required", 400);
    const bundle = await dismissPrediction(body.taskIdOrTitle);
    if (!bundle) throw new ServiceError("bundle missing or no match", 404);
    return { bundle };
  },
  { auth: "owner" },
);
