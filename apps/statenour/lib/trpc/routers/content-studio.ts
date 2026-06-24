/**
 * lib/trpc/routers/content-studio.ts
 *
 * TRPC endpoints for the shared NOUR OS Content Studio memory.
 * Exposes operations for Instagram Carousel and Faceless Reel studios.
 */

import { z } from "zod";
import { router, operatorProcedure } from "../trpc";
import {
  createStudioProject,
  updateStudioProject,
  listStudioProjects,
  getStudioProject,
  deleteStudioProject,
} from "@/lib/services/content-studio";

const StatusSchema = z.enum(["draft", "published"]);

export const contentStudioRouter = router({
  /**
   * Create a new content studio project.
   */
  create: operatorProcedure
    .input(
      z.object({
        contentType: z.string().min(1),
        topic: z.string().min(1),
        briefJson: z.record(z.string(), z.any()),
        status: StatusSchema.optional(),
      })
    )
    .mutation(async ({ input }) => {
      return await createStudioProject({
        ...input,
        briefJson: input.briefJson as any,
      });
    }),

  /**
   * Update an existing content studio project.
   */
  update: operatorProcedure
    .input(
      z.object({
        id: z.string(),
        topic: z.string().optional(),
        briefJson: z.record(z.string(), z.any()).optional(),
        status: StatusSchema.optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return await updateStudioProject(id, {
        ...data,
        briefJson: data.briefJson as any,
      });
    }),

  /**
   * List all content studio projects, optionally filtering by content type.
   */
  list: operatorProcedure
    .input(
      z
        .object({
          contentType: z.string().optional(),
          limit: z.number().int().min(1).max(100).default(50).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return await listStudioProjects(input?.contentType, input?.limit);
    }),

  /**
   * Retrieve a specific content studio project by ID.
   */
  get: operatorProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .query(async ({ input }) => {
      return await getStudioProject(input.id);
    }),

  /**
   * Delete a content studio project.
   */
  delete: operatorProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      return await deleteStudioProject(input.id);
    }),
});
