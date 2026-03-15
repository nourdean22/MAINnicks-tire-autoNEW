import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { createBooking, getBookings, updateBookingStatus } from "./db";
import { notifyOwner } from "./_core/notification";
import { getWeather, getWeatherAlert } from "./weather";
import { z } from "zod";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  weather: router({
    current: publicProcedure.query(async () => {
      const weather = await getWeather();
      if (!weather) return { alert: null, weather: null };
      const alert = getWeatherAlert(weather);
      return { alert, weather };
    }),
  }),

  booking: router({
    create: publicProcedure
      .input(
        z.object({
          name: z.string().min(1, "Name is required"),
          phone: z.string().min(7, "Phone number is required"),
          email: z.string().email().optional().or(z.literal("")),
          service: z.string().min(1, "Service is required"),
          vehicle: z.string().optional(),
          preferredDate: z.string().optional(),
          preferredTime: z.enum(["morning", "afternoon", "no-preference"]).default("no-preference"),
          message: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const result = await createBooking({
          name: input.name,
          phone: input.phone,
          email: input.email || null,
          service: input.service,
          vehicle: input.vehicle || null,
          preferredDate: input.preferredDate || null,
          preferredTime: input.preferredTime,
          message: input.message || null,
        });

        // Notify shop owner
        await notifyOwner({
          title: `New Booking: ${input.service}`,
          content: `Name: ${input.name}\nPhone: ${input.phone}\nService: ${input.service}\nVehicle: ${input.vehicle || "Not specified"}\nPreferred Date: ${input.preferredDate || "Flexible"}\nPreferred Time: ${input.preferredTime}\nMessage: ${input.message || "None"}`,
        }).catch(() => {});

        return result;
      }),

    list: publicProcedure.query(async () => {
      return getBookings();
    }),

    updateStatus: publicProcedure
      .input(
        z.object({
          id: z.number(),
          status: z.enum(["new", "confirmed", "completed", "cancelled"]),
        })
      )
      .mutation(async ({ input }) => {
        return updateBookingStatus(input.id, input.status);
      }),
  }),
});

export type AppRouter = typeof appRouter;
