/**
 * /api/contradictions — list + resolve Nour's stated-position conflicts.
 *
 *   GET ?all=1 → all (including resolved). Default: unresolved only.
 *   PATCH { key, status, note? } → apply resolution; deprecates the
 *     losing memory row if status is current_wins or old_wins.
 *
 * Owner-auth.
 */
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import {
  loadRecentContradictions,
  loadAllContradictions,
  resolveContradiction,
  type ContradictionStatus,
} from "@/lib/brain/contradiction-surfacer";
import { ServiceError } from "@/lib/utils/service-error";

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const all = url.searchParams.get("all") === "1";
    const rows = all
      ? await loadAllContradictions(90)
      : await loadRecentContradictions(14, false);
    return { contradictions: rows };
  },
  { auth: "owner" },
);

const VALID_STATUSES: ContradictionStatus[] = [
  "current_wins",
  "old_wins",
  "both_valid",
  "dismissed",
];

interface PatchBody {
  key?: string;
  status?: ContradictionStatus;
  note?: string;
}

export const PATCH = apiHandler(
  async (req) => {
    const body = await readRequestJson<PatchBody>(req);
    if (!body.key) throw new ServiceError("key required", 400);
    if (!body.status || !VALID_STATUSES.includes(body.status)) {
      throw new ServiceError(
        `status must be one of: ${VALID_STATUSES.join(", ")}`,
        400,
      );
    }
    const resolved = await resolveContradiction(
      body.key,
      body.status as Exclude<ContradictionStatus, "unresolved">,
      body.note,
    );
    if (!resolved) throw new ServiceError("contradiction not found", 404);
    return { contradiction: resolved };
  },
  { auth: "owner" },
);
