/**
 * /api/identity/qualitative — Nour's values/fears/style/rhythms/red-lines.
 *
 *   GET       → current identity
 *   POST      → recompute
 *   PATCH     → { action, bucket, text } add/remove manual entry
 *
 * Owner-auth.
 */
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import {
  loadQualitativeIdentity,
  computeQualitativeIdentity,
  addManualEntry,
  removeEntry,
  type IdentityBucket,
} from "@/lib/brain/qualitative-identity";
import { ServiceError } from "@/lib/utils/service-error";

const VALID_BUCKETS: IdentityBucket[] = [
  "values", "fears", "operating_style", "rhythms", "red_lines",
];

export const GET = apiHandler(
  async () => {
    const identity = await loadQualitativeIdentity();
    return { identity };
  },
  { auth: "owner" },
);

export const POST = apiHandler(
  async () => {
    const identity = await computeQualitativeIdentity();
    return { identity, recomputed: true };
  },
  { auth: "owner" },
);

interface PatchBody {
  action?: "add" | "remove";
  bucket?: IdentityBucket;
  text?: string;
}

export const PATCH = apiHandler(
  async (req) => {
    const body = await readRequestJson<PatchBody>(req);
    if (!body.action) throw new ServiceError("action required", 400);
    if (!body.bucket || !VALID_BUCKETS.includes(body.bucket)) {
      throw new ServiceError(`bucket must be one of ${VALID_BUCKETS.join(", ")}`, 400);
    }
    if (!body.text || body.text.trim().length < 3) {
      throw new ServiceError("text required (≥3 chars)", 400);
    }
    const identity = body.action === "add"
      ? await addManualEntry(body.bucket, body.text)
      : await removeEntry(body.bucket, body.text);
    return { identity };
  },
  { auth: "owner" },
);
