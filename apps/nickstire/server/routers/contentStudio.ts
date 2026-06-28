/**
 * NOUR-OS Content Studio Router — bridges nickstire.org admin shell to statenour
 * Content Studio operations, using STATENOUR_SYNC_KEY.
 */
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { z } from "zod";

const NOUR_OS_API = process.env.NOUR_OS_API_URL ?? "https://bdnick.info";
const SYNC_KEY = process.env.STATENOUR_SYNC_KEY || "";

async function fetchContentStudio(path: string, method: string = "GET", body?: any) {
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(SYNC_KEY ? { Authorization: `Bearer ${SYNC_KEY}` } : {}),
    },
    ...(body && { body: JSON.stringify(body) })
  };

  const res = await fetch(`${NOUR_OS_API}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new TRPCError({ 
      code: "INTERNAL_SERVER_ERROR", 
      message: `ContentStudio API error (${res.status}): ${text}` 
    });
  }
  return res.json();
}

const StatusSchema = z.enum(["draft", "published"]);

export const contentStudioRouter = router({
  create: adminProcedure
    .input(
      z.object({
        contentType: z.string().min(1),
        topic: z.string().min(1),
        briefJson: z.record(z.string(), z.any()),
        status: StatusSchema.optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await fetchContentStudio("/api/trpc/contentStudio.create", "POST", input);
      return result?.result?.data;
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string(),
        topic: z.string().optional(),
        briefJson: z.record(z.string(), z.any()).optional(),
        status: StatusSchema.optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await fetchContentStudio("/api/trpc/contentStudio.update", "POST", input);
      return result?.result?.data;
    }),

  list: adminProcedure
    .input(
      z
        .object({
          contentType: z.string().optional(),
          status: z.string().optional(),
          limit: z.number().int().min(1).max(100).default(50).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      // For tRPC queries, inputs are encoded as JSON in the URL via the `input` query param
      const urlParams = new URLSearchParams();
      if (input) {
        urlParams.set("input", JSON.stringify(input));
      }
      const qs = urlParams.toString() ? `?${urlParams.toString()}` : "";
      const result = await fetchContentStudio(`/api/trpc/contentStudio.list${qs}`);
      return result?.result?.data ?? [];
    }),

  get: adminProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .query(async ({ input }) => {
      const urlParams = new URLSearchParams();
      urlParams.set("input", JSON.stringify(input));
      const result = await fetchContentStudio(`/api/trpc/contentStudio.get?${urlParams.toString()}`);
      return result?.result?.data;
    }),

  delete: adminProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await fetchContentStudio("/api/trpc/contentStudio.delete", "POST", input);
      return result?.result?.data;
    }),
});
