import { apiHandler } from "@/lib/utils/http";
import {
  getGoals,
  createGoal,
  updateGoal,
  removeGoal,
  createGoalSchema,
  updateGoalSchema,
} from "@/lib/services/goals";

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const horizon = url.searchParams.get("horizon");
  const domain = url.searchParams.get("domain");
  const includeDeleted = url.searchParams.get("includeDeleted") === "1";

  const enrichedGoals = await getGoals({ horizon, domain, includeDeleted });
  
  return { goals: enrichedGoals };
}, { auth: "owner" });

// v10.0.255 audit fix · POST / PATCH / DELETE were unauthenticated.
// GET was owner-gated since the goals model went live, but the
// mutating methods were missed. Same shape as the v10.0.253 missions
// audit · anyone could create / rename / re-prioritize / delete any
// goal, polluting the goal-pace dashboard, the AI tool catalog (which
// reads goals by title), and the linked-task counts.
export const POST = apiHandler(async (req) => {
  const body = createGoalSchema.parse(await req.json());
  const goal = await createGoal(body);
  return goal;
}, { auth: "owner" });

export const PATCH = apiHandler(async (req) => {
  const parsed = updateGoalSchema.parse(await req.json());
  const goal = await updateGoal(parsed);
  return goal;
}, { auth: "owner" });

export const DELETE = apiHandler(async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) throw new Error("id required");

  return await removeGoal(id);
}, { auth: "owner" });
