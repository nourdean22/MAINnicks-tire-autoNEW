/**
 * /api/beliefs — Nour's curated belief library. Apr 19.
 *
 *   GET → { active, candidates }
 *   PATCH { key, action, statement?, kind? }
 *     action: "promote" | "drop" | "edit" | "harvest_now"
 *
 * Owner-auth.
 */
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import {
  loadActiveBeliefs,
  loadBeliefCandidates,
  promoteBelief,
  dropBelief,
  editBelief,
  harvestBeliefs,
} from "@/lib/brain/belief-harvester";
import { ServiceError } from "@/lib/utils/service-error";

export const GET = apiHandler(
  async () => {
    const [active, candidates] = await Promise.all([
      loadActiveBeliefs(),
      loadBeliefCandidates(),
    ]);
    return { active, candidates };
  },
  { auth: "owner" },
);

interface PatchBody {
  key?: string;
  action?: "promote" | "drop" | "edit" | "harvest_now";
  statement?: string;
  kind?: "belief" | "belief_candidate";
}

export const PATCH = apiHandler(
  async (req) => {
    const body = await readRequestJson<PatchBody>(req);
    if (!body.action) throw new ServiceError("action required", 400);

    if (body.action === "harvest_now") {
      const result = await harvestBeliefs();
      return { ok: true, result };
    }

    if (!body.key) throw new ServiceError("key required", 400);

    if (body.action === "promote") {
      const promoted = await promoteBelief(body.key, body.statement);
      if (!promoted) throw new ServiceError("candidate not found", 404);
      return { ok: true, belief: promoted };
    }

    if (body.action === "drop") {
      const kind = body.kind ?? "belief_candidate";
      const dropped = await dropBelief(body.key, kind);
      if (!dropped) throw new ServiceError("not found", 404);
      return { ok: true, dropped: true };
    }

    if (body.action === "edit") {
      if (!body.statement) throw new ServiceError("statement required", 400);
      const kind = body.kind ?? "belief";
      const edited = await editBelief(body.key, kind, body.statement);
      if (!edited) throw new ServiceError("not found", 404);
      return { ok: true, belief: edited };
    }

    throw new ServiceError("unknown action", 400);
  },
  { auth: "owner" },
);
