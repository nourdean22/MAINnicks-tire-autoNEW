/**
 * Vapi Admin Router — manage the AI receptionist from /admin.
 *
 * Endpoints:
 *  · status         — connection state + assistant count (admin badge)
 *  · createAssistant — one-time setup mutation
 *  · updateAssistant — re-push the latest prompt + tools to Vapi
 *  · recentCalls    — paginated call log for admin monitor panel
 *  · todayMetrics   — wave-86: derived KPIs for the Voice Receptionist dashboard
 *  · todayCalls     — wave-86: today-only call list with createdAt for the table
 *  · callDetails    — wave-86: single-call transcript + tool-call invocations
 *
 * Caching: todayMetrics / todayCalls / callDetails memo for 60s server-side
 * since admin polling is ~30s and VAPI rate-limits.
 */

import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { createLogger } from "../lib/logger";

const log = createLogger("vapi");

// ─── 60s in-memory memo ──────────────────────────────────
type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL_MS = 60_000;

async function memoize<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.value;
  const value = await fetcher();
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

// ─── Direct VAPI fetcher for new procedures ─────────────
const VAPI_BASE = "https://api.vapi.ai";

async function vapiApiFetch<T>(path: string): Promise<T> {
  const key = process.env.VAPI_API_KEY;
  if (!key) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "VAPI_API_KEY not configured",
    });
  }
  const res = await fetch(`${VAPI_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    const body = await res.text();
    log.warn("VAPI fetch failed", { status: res.status, path, body: body.slice(0, 300) });
    throw new TRPCError({ code: "BAD_GATEWAY", message: `VAPI API ${res.status}` });
  }
  return res.json() as Promise<T>;
}

interface VapiCallSummary {
  id: string;
  type?: string;
  startedAt?: string;
  endedAt?: string;
  createdAt?: string;
  endedReason?: string;
  customer?: { number?: string; name?: string };
  cost?: number;
  summary?: string;
  analysis?: { summary?: string; structuredData?: Record<string, unknown>; successEvaluation?: string };
}

interface VapiMessage {
  role: string;
  message?: string;
  time?: number;
  endTime?: number;
  secondsFromStart?: number;
  toolCalls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  toolCallId?: string;
  result?: string;
}

interface VapiCallDetail extends VapiCallSummary {
  messages?: VapiMessage[];
  transcript?: string;
  recordingUrl?: string;
}

function durationSeconds(call: VapiCallSummary): number {
  if (!call.startedAt || !call.endedAt) return 0;
  const ms = new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime();
  return ms > 0 ? ms / 1000 : 0;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export const vapiRouter = router({
  status: adminProcedure.query(async () => {
    const { getVapiStatus } = await import("../services/vapi");
    return getVapiStatus();
  }),

  createAssistant: adminProcedure
    .input(z.object({ serverUrl: z.string().url().optional() }).optional())
    .mutation(async ({ input }) => {
      const { createProductionAssistant } = await import("../services/vapi");
      // Default the webhook to nickstire.org/api/webhooks/vapi if not provided
      const serverUrl = input?.serverUrl || "https://nickstire.org/api/webhooks/vapi";
      return createProductionAssistant(serverUrl);
    }),

  updateAssistant: adminProcedure
    .input(z.object({
      assistantId: z.string().min(1).max(100),
      serverUrl: z.string().url().optional(),
    }))
    .mutation(async ({ input }) => {
      const { updateAssistant } = await import("../services/vapi");
      const serverUrl = input.serverUrl || "https://nickstire.org/api/webhooks/vapi";
      return updateAssistant(input.assistantId, serverUrl);
    }),

  recentCalls: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
      const { getRecentCalls } = await import("../services/vapi");
      return getRecentCalls(input?.limit ?? 20);
    }),

  // ─── wave-86 additions ──────────────────────────────────

  /**
   * Today's call metrics — totals, breakdowns, durations. Returns
   * `ok: false` with zeros (not throws) when VAPI is unreachable, so
   * the dashboard renders gracefully.
   */
  todayMetrics: adminProcedure.query(async () => {
    return memoize("todayMetrics", async () => {
      const today = startOfDay(new Date());
      const iso = today.toISOString();
      try {
        const calls = await vapiApiFetch<VapiCallSummary[]>(
          `/call?createdAtGe=${encodeURIComponent(iso)}&limit=200`,
        );
        const total = calls.length;
        const inbound = calls.filter((c) => c.type === "inboundPhoneCall").length;
        const outbound = calls.filter((c) => c.type === "outboundPhoneCall").length;
        const web = calls.filter((c) => c.type === "webCall").length;

        const durations = calls.map(durationSeconds).filter((d) => d > 0);
        const totalSeconds = durations.reduce((s, d) => s + d, 0);
        const avgSeconds = durations.length > 0 ? totalSeconds / durations.length : 0;

        const endReasons: Record<string, number> = {};
        for (const c of calls) {
          const r = c.endedReason || "unknown";
          endReasons[r] = (endReasons[r] || 0) + 1;
        }

        const forwarded = endReasons["assistant-forwarded-call"] || 0;
        const customerEnded = endReasons["customer-ended-call"] || 0;
        const assistantEnded = endReasons["assistant-ended-call"] || 0;

        return {
          ok: true as const,
          total, inbound, outbound, web,
          forwarded, customerEnded, assistantEnded,
          totalSeconds: Math.round(totalSeconds),
          avgSeconds: Math.round(avgSeconds),
          endReasons,
        };
      } catch (err) {
        log.warn("todayMetrics failed", { error: err instanceof Error ? err.message : String(err) });
        return {
          ok: false as const, error: "VAPI API unreachable",
          total: 0, inbound: 0, outbound: 0, web: 0,
          forwarded: 0, customerEnded: 0, assistantEnded: 0,
          totalSeconds: 0, avgSeconds: 0,
          endReasons: {} as Record<string, number>,
        };
      }
    });
  }),

  /**
   * Today's call list (max 50, newest first) — used by the recent
   * calls table in the Voice Receptionist admin section.
   */
  todayCalls: adminProcedure.query(async () => {
    return memoize("todayCalls", async () => {
      const today = startOfDay(new Date());
      const iso = today.toISOString();
      try {
        const calls = await vapiApiFetch<VapiCallSummary[]>(
          `/call?createdAtGe=${encodeURIComponent(iso)}&limit=50`,
        );
        const sorted = [...calls].sort(
          (a, b) =>
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime(),
        );
        return sorted.map((c) => ({
          id: c.id,
          type: c.type || "unknown",
          createdAt: c.createdAt || null,
          startedAt: c.startedAt || null,
          endedAt: c.endedAt || null,
          durationSeconds: Math.round(durationSeconds(c)),
          endedReason: c.endedReason || "unknown",
          customerNumber: c.customer?.number || null,
          customerName: c.customer?.name || null,
          cost: c.cost ?? null,
          summary: c.summary || c.analysis?.summary || null,
          successEvaluation: c.analysis?.successEvaluation || null,
        }));
      } catch (err) {
        log.warn("todayCalls failed", { error: err instanceof Error ? err.message : String(err) });
        return [] as Array<{
          id: string; type: string; createdAt: string | null;
          startedAt: string | null; endedAt: string | null;
          durationSeconds: number; endedReason: string;
          customerNumber: string | null; customerName: string | null;
          cost: number | null; summary: string | null; successEvaluation: string | null;
        }>;
      }
    });
  }),

  /**
   * Single-call detail with messages + transcript + tool-call invocations.
   * For the call drawer.
   */
  callDetails: adminProcedure
    .input(z.object({ callId: z.string().min(8).max(64) }))
    .query(async ({ input }) => {
      return memoize(`call_${input.callId}`, async () => {
        const call = await vapiApiFetch<VapiCallDetail>(`/call/${input.callId}`);
        const toolCalls: Array<{ name: string; args: string; time?: number }> = [];
        if (call.messages) {
          for (const m of call.messages) {
            if (m.toolCalls) {
              for (const tc of m.toolCalls) {
                toolCalls.push({
                  name: tc.function.name,
                  args: tc.function.arguments,
                  time: m.secondsFromStart,
                });
              }
            }
          }
        }
        return {
          id: call.id,
          type: call.type ?? null,
          createdAt: call.createdAt || null,
          startedAt: call.startedAt || null,
          endedAt: call.endedAt || null,
          durationSeconds: Math.round(durationSeconds(call)),
          endedReason: call.endedReason || "unknown",
          customerNumber: call.customer?.number || null,
          customerName: call.customer?.name || null,
          cost: call.cost ?? null,
          summary: call.summary || call.analysis?.summary || null,
          successEvaluation: call.analysis?.successEvaluation || null,
          transcript: call.transcript || null,
          recordingUrl: call.recordingUrl || null,
          messages: (call.messages || []).map((m) => ({
            role: m.role,
            message: m.message || null,
            secondsFromStart: m.secondsFromStart ?? null,
          })),
          toolCalls,
        };
      });
    }),
});
