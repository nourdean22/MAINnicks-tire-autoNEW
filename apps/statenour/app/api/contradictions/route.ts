/**
 * /api/contradictions — list + resolve Nour's stated-position conflicts.
 *
 *   GET ?all=1 → all (including resolved). Default: unresolved only.
 *   PATCH { key, status, note? } → apply resolution; deprecates the
 *     losing memory row if status is current_wins or old_wins.
 *
 * Owner-auth.
 *
 * Phase B.6d (2026-05-22 · legacy-modernizer REST→tRPC brain slice) ·
 * the list + resolve wrappers moved to
 * `lib/services/contradictions.{listStoredContradictions,
 * resolveStoredContradiction}` so this route AND the new
 * `trpc.brain.{contradictions,resolveContradiction}` procedures call the
 * same functions · drift impossible.
 */
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import {
  listStoredContradictions,
  resolveStoredContradiction,
} from "@/lib/services/contradictions";
import { type ContradictionStatus } from "@/lib/brain/contradiction-surfacer";
import { ServiceError } from "@/lib/utils/service-error";

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const all = url.searchParams.get("all") === "1";
    return listStoredContradictions({ includeResolved: all });
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
    return resolveStoredContradiction({
      key: body.key,
      status: body.status as Exclude<ContradictionStatus, "unresolved">,
      note: body.note,
    });
  },
  { auth: "owner" },
);
