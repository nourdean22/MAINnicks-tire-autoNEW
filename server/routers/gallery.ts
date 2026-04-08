/**
 * Repair Gallery Router
 * Handles before/after repair photo gallery for public display and admin management.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, adminProcedure } from "../_core/trpc";
import {
  getPublicGalleryItems, getAllGalleryItems, createGalleryItem,
  updateGalleryItem, deleteGalleryItem,
} from "../db";
import { sanitizeText } from "../sanitize";

export const galleryRouter = router({
  /** Get published gallery items (public) */
  list: publicProcedure.query(async () => {
    return getPublicGalleryItems();
  }),

  /** Get all gallery items including unpublished (admin) */
  listAll: adminProcedure.query(async () => {
    return getAllGalleryItems();
  }),

  /** Create a new gallery item (admin) */
  create: adminProcedure
    .input(z.object({
      title: z.string().min(1).max(255),
      description: z.string().max(2000).optional(),
      beforeImageUrl: z.string().url().max(1000),
      afterImageUrl: z.string().url().max(1000),
      serviceType: z.string().min(1).max(100),
      vehicleInfo: z.string().max(255).optional(),
      isPublished: z.number().int().min(0).max(1).default(1),
      sortOrder: z.number().int().min(0).default(0),
    }))
    .mutation(async ({ input }) => {
      try {
        return createGalleryItem({
          ...input,
          title: sanitizeText(input.title),
          description: input.description ? sanitizeText(input.description) : undefined,
          serviceType: sanitizeText(input.serviceType),
          vehicleInfo: input.vehicleInfo ? sanitizeText(input.vehicleInfo) : undefined,
        });
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),

  /** Update a gallery item (admin) */
  update: adminProcedure
    .input(z.object({
      id: z.number().int(),
      title: z.string().min(1).max(255).optional(),
      description: z.string().max(2000).optional(),
      beforeImageUrl: z.string().url().max(1000).optional(),
      afterImageUrl: z.string().url().max(1000).optional(),
      serviceType: z.string().min(1).max(100).optional(),
      vehicleInfo: z.string().max(255).optional(),
      isPublished: z.number().int().min(0).max(1).optional(),
      sortOrder: z.number().int().min(0).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { id, ...data } = input;
        const sanitized: Record<string, any> = { ...data };
        if (data.title) sanitized.title = sanitizeText(data.title);
        if (data.description) sanitized.description = sanitizeText(data.description);
        if (data.serviceType) sanitized.serviceType = sanitizeText(data.serviceType);
        if (data.vehicleInfo) sanitized.vehicleInfo = sanitizeText(data.vehicleInfo);
        return updateGalleryItem(id, sanitized);
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),

  /** Delete a gallery item (admin) */
  delete: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      try {
        return deleteGalleryItem(input.id);
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),
});
