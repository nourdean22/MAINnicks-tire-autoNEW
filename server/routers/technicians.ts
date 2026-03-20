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
      return createTechnician(input);
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
      return updateTechnician(id, data);
    }),

  /** Delete a technician profile (admin) */
  delete: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      return deleteTechnician(input.id);
    }),
});
