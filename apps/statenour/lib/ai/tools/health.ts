/**
 * Health tools — body tracking reads.
 *
 * Includes: getBodyData.
 *
 * v10.0.529.106 · Wave 82 · extracted from monolithic lib/ai/tools.ts.
 * Aggregate barrel: lib/ai/tools.ts re-exports nourTools composed from
 * all 7 domain files. Catalog source of truth: lib/ai/tools/catalog.ts.
 */

import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { daysAgo, toDateString } from "@/lib/utils/datetime";
import { logError } from "@/lib/utils/error-log";

export const healthTools = {
  getBodyData: tool({
    description: "Get recent body tracking entries",
    inputSchema: z.object({ days: z.number().min(1).max(365).default(30) }),
    execute: async ({ days }) => {
      // truth-substrate audit P0 (#6): keep the tool resilient (return [] so the
      // chat turn survives) but never SILENTLY conceal a failed read — a swallowed
      // error otherwise reads to the model as "no body tracking entries", and
      // downstream (pipeline-controller) even treats that absence as an avoidance
      // signal. Log loudly so the failure is observable.
      return prisma.bodyTracking.findMany({
        where: { date: { gte: toDateString(daysAgo(days)) } },
        orderBy: { date: "desc" },
      }).catch((e): never[] => {
        logError("ai.tools.health.getBodyData", e, { days });
        return [];
      });
    },
  }),

  // H4 · 2026-07-28 late · Apple Health reads. Both tools carry their
  // own freshness (lastSyncAt) so Nick can say "as of" instead of
  // implying live data. Observed values only — no derived scores.
  getHealthToday: tool({
    description:
      "Today's health snapshot: sleep, weight, workout (BodyTracking) plus steps, resting heart rate and HRV from Apple Health samples, with last-sync freshness",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const todayEt = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        const dayStartUtc = new Date(`${todayEt}T04:00:00Z`); // ET day start (EDT); close enough for a daily snapshot
        const [body, samples, lastBatch] = await Promise.all([
          prisma.bodyTracking.findUnique({ where: { date: todayEt } }),
          prisma.healthSample.findMany({
            where: {
              startAt: { gte: dayStartUtc },
              metricType: { in: ["step_count", "resting_heart_rate", "heart_rate_variability"] },
            },
            select: { metricType: true, numericValue: true, startAt: true },
            orderBy: { startAt: "asc" },
          }),
          prisma.healthIngestBatch.findFirst({ orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
        ]);
        let steps = 0;
        let restingHr: number | null = null;
        let hrvMs: number | null = null;
        for (const s of samples) {
          if (s.metricType === "step_count" && s.numericValue != null) steps += s.numericValue;
          else if (s.metricType === "resting_heart_rate" && s.numericValue != null) restingHr = s.numericValue;
          else if (s.metricType === "heart_rate_variability" && s.numericValue != null) hrvMs = s.numericValue;
        }
        return {
          date: todayEt,
          sleepHours: body?.sleepHours ?? null,
          weightLb: body?.weight ?? null,
          workoutDone: body?.workoutDone ?? null,
          energy: body?.energy ?? null,
          stress: body?.stress ?? null,
          steps: steps > 0 ? Math.round(steps) : null,
          restingHrBpm: restingHr,
          hrvMs,
          lastSyncAt: lastBatch?.receivedAt?.toISOString() ?? null,
          note: lastBatch ? undefined : "no Apple Health sync received yet — values are manual entries only",
        };
      } catch (e) {
        logError("ai.tools.health.getHealthToday", e, {});
        return { error: "health read failed — state unknown, not empty" };
      }
    },
  }),

  getSleepTrend: tool({
    description: "Sleep-hours series over the last N days (BodyTracking canonical, Apple Health-fed) with coverage count",
    inputSchema: z.object({ days: z.number().min(3).max(90).default(14) }),
    execute: async ({ days }) => {
      try {
        const rows = await prisma.bodyTracking.findMany({
          where: { date: { gte: toDateString(daysAgo(days)) } },
          select: { date: true, sleepHours: true },
          orderBy: { date: "desc" },
        });
        const withData = rows.filter((r) => r.sleepHours != null);
        return {
          days,
          nightsWithData: withData.length,
          coverage: `${withData.length}/${days} nights`,
          series: rows.map((r) => ({ date: r.date, sleepHours: r.sleepHours })),
        };
      } catch (e) {
        logError("ai.tools.health.getSleepTrend", e, { days });
        return { error: "sleep trend read failed — state unknown, not empty" };
      }
    },
  }),

};
