/**
 * Technicians Router
 * Handles technician profile management for the team page.
 */
import { z } from "zod";
import { router, publicProcedure, adminProcedure } from "../_core/trpc";
import {
  getActiveTechnicians, getAllTechnicians, createTechnician,
  updateTechnician, deleteTechnician,
} from "../db";
import { sanitizeText } from "../sanitize";

export const techniciansRouter = router({
  /** Get active technicians for public display */
  list: publicProcedure.query(async () => {
    return getActiveTechnicians();
  }),

  /** Get all technicians including inactive (admin) */
  listAll: adminProcedure.query(async () => {
    return getAllTechnicians();
  }),

  /** Create a new technician profile (admin) */
  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      title: z.string().min(1).max(255),
      bio: z.string().max(2000).optional(),
      specialties: z.string().max(500).optional(),
      yearsExperience: z.number().int().min(0).max(60).default(0),
      certifications: z.string().max(500).optional(),
      photoUrl: z.string().url().max(1000).optional(),
      isActive: z.number().int().min(0).max(1).default(1),
      sortOrder: z.number().int().min(0).default(0),
    }))
    .mutation(async ({ input }) => {
      return createTechnician({
        ...input,
        name: sanitizeText(input.name),
        title: sanitizeText(input.title),
        bio: input.bio ? sanitizeText(input.bio) : undefined,
        specialties: input.specialties ? sanitizeText(input.specialties) : undefined,
        certifications: input.certifications ? sanitizeText(input.certifications) : undefined,
      });
    }),

  /** Update a technician profile (admin) */
  update: adminProcedure
    .input(z.object({
      id: z.number().int(),
      name: z.string().min(1).max(255).optional(),
      title: z.string().min(1).max(255).optional(),
      bio: z.string().max(2000).optional(),
      specialties: z.string().max(500).optional(),
      yearsExperience: z.number().int().min(0).max(60).optional(),
      certifications: z.string().max(500).optional(),
      photoUrl: z.string().url().max(1000).optional(),
      isActive: z.number().int().min(0).max(1).optional(),
      sortOrder: z.number().int().min(0).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const sanitized: Record<string, any> = { ...data };
      if (data.name) sanitized.name = sanitizeText(data.name);
      if (data.title) sanitized.title = sanitizeText(data.title);
      if (data.bio) sanitized.bio = sanitizeText(data.bio);
      if (data.specialties) sanitized.specialties = sanitizeText(data.specialties);
      if (data.certifications) sanitized.certifications = sanitizeText(data.certifications);
      return updateTechnician(id, sanitized);
    }),

  /** Delete a technician profile (admin) */
  delete: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      return deleteTechnician(input.id);
    }),
});
