/**
 * lib/ai/model-liveness.ts · 2026-08-01.
 *
 * Proof-of-life for the Ollama Cloud lanes.
 *
 * WHY THIS EXISTS: Ollama Cloud retires models with no warning and no
 * deprecation window, and this key has now lost TWO:
 *   · qwen3-vl:235b-instruct  — retired 2026-06-16 (the vision lane)
 *   · deepseek-v3.1:671b      — retired 2026-07-15 (the chat lane, 410
 *                               mid-day, took the whole lane down ~9h)
 *
 * Both were invisible until a human noticed output was wrong. The vision
 * one was worse: `config/ai-providers.ts` was corrected to gemma4:31b on
 * 2026-07-12, but Railway still pinned OLLAMA_VISION_MODEL to the retired
 * id, and an env override beats the registry — so the "fix" never reached
 * production and every image turn 410'd for ~6 more weeks (found and
 * corrected 2026-08-01).
 *
 * The lesson is that a model id being CONFIGURED says nothing about it
 * being ALIVE. So this probe deliberately does not re-derive model names:
 * it calls `resolveProviderModel`, the same function the app uses, so it
 * tests exactly what a real turn would get — env override included. A
 * probe that read the registry directly would have reported "healthy"
 * throughout the entire six-week vision outage.
 */

import { resolveProviderModel } from "@/lib/ai/provider";

/** The three Ollama lanes that resolve to independently-configurable ids. */
export type LaneName = "chat" | "fast" | "vision";

export type LaneState =
  /** Responded 200. The only good state. */
  | "alive"
  /** HTTP 410 — the model was retired out from under us. The killer. */
  | "retired"
  /** 401/403 — key revoked, expired, or out of quota. */
  | "unauthorized"
  /** Network error, timeout, or any other non-2xx. */
  | "unreachable"
  /** No API key configured at all — the whole lane is off. */
  | "unconfigured";

export interface LaneProbe {
  lane: LaneName;
  /** What `resolveProviderModel` actually returns for this lane. */
  model: string | null;
  state: LaneState;
  httpStatus: number | null;
  /** Provider-supplied reason, trimmed. Null when the call never landed. */
  detail: string | null;
  latencyMs: number | null;
}

export interface LivenessReport {
  ok: boolean;
  probes: LaneProbe[];
  /** Lanes in any state other than "alive". Empty === healthy. */
  failing: LaneProbe[];
}

const LANES: ReadonlyArray<{ lane: LaneName; taskType: "reason" | "fast" | "vision" }> = [
  { lane: "chat", taskType: "reason" },
  { lane: "fast", taskType: "fast" },
  { lane: "vision", taskType: "vision" },
];

const PROBE_TIMEOUT_MS = 20_000;

/** Cheapest call that still proves the model will actually serve a turn. */
function probeBody(model: string) {
  return JSON.stringify({
    model,
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 1,
    temperature: 0,
  });
}

function classify(status: number): LaneState {
  if (status >= 200 && status < 300) return "alive";
  // 410 Gone is precisely how Ollama Cloud signals a retirement, and it
  // is the one status that means "this will never work again" rather
  // than "try later". It must never be lumped in with generic failure.
  if (status === 410) return "retired";
  if (status === 401 || status === 403) return "unauthorized";
  return "unreachable";
}

/**
 * Probe every Ollama lane.
 *
 * `fetchImpl` is injectable so tests can assert the classification
 * without network access. Production passes nothing.
 */
export async function probeOllamaLanes(
  fetchImpl: typeof fetch = fetch,
): Promise<LivenessReport> {
  const key = process.env.OLLAMA_API_KEY?.trim();
  const base = process.env.OLLAMA_BASE_URL?.trim() || "https://ollama.com";

  // A missing key is an ALARM, not a reason to skip. Returning "ok" here
  // is how a probe becomes decorative — the silent-IDLE failure this repo
  // has hit repeatedly (a cron armed, completed, and asserting nothing).
  if (!key) {
    const probes: LaneProbe[] = LANES.map(({ lane }) => ({
      lane,
      model: null,
      state: "unconfigured" as const,
      httpStatus: null,
      detail: "OLLAMA_API_KEY is not set",
      latencyMs: null,
    }));
    return { ok: false, probes, failing: probes };
  }

  const probes = await Promise.all(
    LANES.map(async ({ lane, taskType }): Promise<LaneProbe> => {
      const model = resolveProviderModel("ollama", taskType);
      const t0 = Date.now();
      try {
        const res = await fetchImpl(`${base}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: probeBody(model),
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        const latencyMs = Date.now() - t0;
        const state = classify(res.status);
        let detail: string | null = null;
        if (state !== "alive") {
          // The 410 body carries the retirement date — the single most
          // useful line for the operator, so keep it rather than the
          // bare status.
          detail = await res.text().then(
            (t) => t.slice(0, 300).trim() || null,
            () => null,
          );
        }
        return { lane, model, state, httpStatus: res.status, detail, latencyMs };
      } catch (err) {
        return {
          lane,
          model,
          state: "unreachable",
          httpStatus: null,
          detail: err instanceof Error ? err.message : String(err),
          latencyMs: Date.now() - t0,
        };
      }
    }),
  );

  const failing = probes.filter((p) => p.state !== "alive");
  return { ok: failing.length === 0, probes, failing };
}

/** One-line-per-lane summary for a Telegram body or a log field. */
export function summarizeLanes(probes: LaneProbe[]): string {
  return probes
    .map((p) => {
      const model = p.model ?? "(unresolved)";
      const status = p.httpStatus != null ? ` HTTP ${p.httpStatus}` : "";
      const detail = p.detail ? ` — ${p.detail}` : "";
      return `${p.lane} [${model}]: ${p.state}${status}${detail}`;
    })
    .join("\n");
}
