/**
 * /api/identity — Nour's 8-axis self-model.
 *
 *   GET        → current snapshot (computed if missing)
 *   POST       → recompute now
 *   PATCH      → { axis, value: number | null } set/clear manual override
 *
 * All owner-auth.
 */
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import {
  computeIdentitySnapshot,
  loadIdentitySnapshot,
  loadIdentityHistory,
  setManualOverride,
  type AxisKey,
} from "@/lib/brain/identity-snapshot";
import { ServiceError } from "@/lib/utils/service-error";

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const withHistory = url.searchParams.get("history") === "1";
    const [snap, history] = await Promise.all([
      loadIdentitySnapshot(),
      withHistory ? loadIdentityHistory(30) : Promise.resolve(null),
    ]);
    return { snapshot: snap, history };
  },
  { auth: "owner" },
);

export const POST = apiHandler(
  async () => {
    const snap = await computeIdentitySnapshot();
    return { snapshot: snap, recomputed: true };
  },
  { auth: "owner" },
);

interface PatchBody {
  axis?: AxisKey;
  value?: number | null;
}

const VALID_AXES: AxisKey[] = [
  "velocity",
  "patience_horizon",
  "promise_integrity",
  "dopamine_discipline",
  "business_vs_personal",
  "risk_appetite",
  "social_battery",
  "reflection_cadence",
];

export const PATCH = apiHandler(
  async (req) => {
    const body = await readRequestJson<PatchBody>(req);
    if (!body.axis || !VALID_AXES.includes(body.axis)) {
      throw new ServiceError("axis required (one of the 8)", 400);
    }
    const value = body.value == null ? null : Number(body.value);
    if (value != null && (Number.isNaN(value) || value < 0 || value > 100)) {
      throw new ServiceError("value must be 0-100 or null", 400);
    }
    const snap = await setManualOverride(body.axis, value);
    return { snapshot: snap };
  },
  { auth: "owner" },
);
