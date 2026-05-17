// /api/cron/provider-ping — synthetic uptime check on each provider.
//
// v7 · BATCH 6 · Apr 28. Every 15min, pings each configured provider
// with a tiny "ping" prompt. Tracks uptime + p50 latency to brain_memory
// category=provider_ping. Surfaces in /system/costs as availability
// percentage and trend.
//
// Vercel cron schedule: "*/15 * * * *"

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/provider-ping");

export const maxDuration = 60;

interface PingResult {
  provider: string;
  available: boolean;
  latencyMs: number;
  error?: string;
}

async function pingProvider(name: string, key: string | undefined, baseUrl: string, model: string): Promise<PingResult> {
  if (!key || key.length < 10 || key.startsWith("YOUR_")) {
    return { provider: name, available: false, latencyMs: 0, error: "no key" };
  }
  const t0 = Date.now();
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping — reply with single word ok" }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      return { provider: name, available: false, latencyMs, error: `${res.status}` };
    }
    return { provider: name, available: true, latencyMs };
  } catch (err) {
    return {
      provider: name,
      available: false,
      latencyMs: Date.now() - t0,
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}

export const GET = cronHandler(async () => {
  const results = await Promise.all([
    pingProvider("venice", process.env.VENICE_API_KEY, "https://api.venice.ai/api/v1", "venice-uncensored"),
    pingProvider("ollama", process.env.OLLAMA_API_KEY, `${process.env.OLLAMA_BASE_URL ?? "https://ollama.com"}/v1`, process.env.OLLAMA_MODEL ?? "qwen3-vl:235b-instruct"),
    pingProvider("openai", process.env.OPENAI_API_KEY, "https://api.openai.com/v1", "gpt-4o-mini"),
  ]);

  // v10.0.196 → v10.0.529.106 Wave 53 · Phase 3 cutover · the
  // BrainMemory(category="provider_ping") dual-write from v10.0.196
  // has been removed. /system/costs and the brain insights filter
  // both treat provider_ping as NOISE_CATEGORIES, so zero readers
  // depended on the BrainMemory copy. The typed ProviderPing table
  // is the canonical record · data-cleanup cron purges rows >7d.
  for (const r of results) {
    await prisma.providerPing.create({
      data: {
        provider: r.provider,
        available: r.available,
        latencyMs: r.latencyMs,
        errorClass: r.error ?? null,
      },
    }).catch((err) => {
      log.warn("provider_ping_persist_failed", {
        provider: r.provider,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  const summary = results
    .map((r) => `${r.provider}=${r.available ? "✓" : "✗"} ${r.latencyMs}ms`)
    .join(" · ");

  return {
    ok: true,
    pings: results,
    summary,
  };
});

export const POST = GET;
