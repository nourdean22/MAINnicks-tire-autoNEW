import { apiHandler } from "@/lib/utils/http";

/**
 * /api/templates · v10.0.60 · Wave A part 3.
 *
 * Pre-cleanup: GET + POST were dead `Promise.resolve(null|[])`
 * placeholders for a `template` Prisma model that doesn't exist
 * in the schema. Templates were never built out beyond the route
 * scaffold. Returning honest empty + a structured "not implemented"
 * note so any client that polls this endpoint sees the state
 * clearly instead of pretending an empty list means "no templates
 * yet, keep checking."
 *
 * Future direction: if templates ship, replace with a real Prisma
 * model + queries. Until then, this endpoint stays stubbed but
 * honest. The 410 Gone status on POST signals "this surface isn't
 * accepting writes" so admin UIs that try to create templates
 * fail cleanly instead of silently dropping the create.
 */
export const GET = apiHandler(async () => {
  return {
    templates: [] as Array<unknown>,
    categories: [] as string[],
    notImplemented: true,
    note: "Templates surface scaffolded but never built. Returns empty.",
  };
});

export const POST = apiHandler(async () => {
  return {
    error: "Templates write surface is not implemented.",
    code: "TEMPLATES_NOT_IMPLEMENTED",
    status: 410,
  };
}, { auth: "sync" });
