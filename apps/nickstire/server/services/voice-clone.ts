/**
 * XTTS-v2 Voice Clone Service
 *
 * Category 6 of docs/eval-rubrics/huggingface-model-strategy.md. Clones
 * operator's voice from a 6-second sample · generates audio for
 * personalized outbound voicemails ("Hey Linda, this is Nick — quick
 * follow-up on those brakes."). Conversion multiplier on declined-work
 * recovery + retention vs generic robot-voice baseline.
 *
 * Provider · Replicate (default) hosts the XTTS-v2 model at
 * `lucataco/xtts-v2` (community port of coqui-ai/XTTS-v2). The Replicate
 * synchronous API returns a publicly-accessible MP3 URL that Twilio
 * Voice's <Play> verb can fetch directly · no CDN setup needed for
 * MVP.
 *
 * Modal alternative · if you self-host XTTS-v2 on Modal (~$0.50/hr GPU
 * vs Replicate's per-second billing), set XTTS_PROVIDER=modal and
 * XTTS_MODAL_URL to your endpoint. Same input/output shape.
 *
 * Pipeline:
 *   1. cloneVoice({ text, voiceSampleUrl }) → MP3 URL
 *   2. Caller stores or directly passes to Twilio <Play>
 *   3. Twilio places the call (placeCall outbound) and plays the URL
 *
 * This module ONLY generates audio. It does NOT place calls. The
 * outbound voicemail delivery pipeline (Twilio Voice integration · TCPA
 * compliance · do-not-call list · time-window enforcement) is the
 * scope of docs/runbooks/outbound-voicemail.md.
 */

import { createLogger } from "../lib/logger";
import { withTimeout } from "@nour/utils";

const log = createLogger("voice-clone");

const REPLICATE_API_BASE = "https://api.replicate.com/v1";
const XTTS_REPLICATE_MODEL = "lucataco/xtts-v2";
const XTTS_REPLICATE_VERSION = "684bc3855b37866c0c65add2ff39c78f3dea3f4ff103a436465326e0f438d55e";
// ^ pinned XTTS-v2 version · check Replicate model page for newer hash if quality regresses
const DEFAULT_TIMEOUT_MS = 30_000; // XTTS inference: typically 2-8s, allow headroom

export interface CloneVoiceOptions {
  /** The text to speak. Keep under 320 chars for SMS-equivalent voicemails. */
  text: string;
  /**
   * URL to the operator's voice sample. Must be:
   *   - 6+ seconds clean recording, no background noise
   *   - publicly accessible (Replicate fetches it server-side)
   *   - WAV or MP3 format
   *
   * Recommended hosting: upload to S3/R2/static-asset bucket as
   * `voices/nour-2026.wav` · pin the URL in this env var below.
   * See docs/runbooks/voice-clone-setup.md.
   */
  voiceSampleUrl?: string;
  /** Language hint · "en" default, "es" supported (Spanish unlock). */
  language?: string;
  /** Override XTTS provider default · "replicate" | "modal" */
  provider?: "replicate" | "modal";
  /** Optional timeout override */
  timeoutMs?: number;
}

export interface CloneVoiceResult {
  ok: true;
  /** MP3 URL the caller can pass directly to Twilio <Play> */
  audioUrl: string;
  /** Provider that produced this audio · for cost attribution */
  source: "replicate" | "modal";
  /** Cloning latency · informational */
  latencyMs: number;
}

export interface CloneVoiceError {
  ok: false;
  error: string;
  /** Caller decides whether to retry, fall back to Cartesia generic-voice, or abort */
  reason: "disabled" | "no_provider" | "no_sample" | "timeout" | "http_error" | "parse_error";
}

export type CloneVoiceResponse = CloneVoiceResult | CloneVoiceError;

/**
 * Read feature flag. Voice clone is OFF by default · turning ON
 * commits to the outbound voicemail path (TCPA compliance applies ·
 * see runbook).
 */
async function isVoiceCloneEnabled(): Promise<boolean> {
  try {
    const { isEnabled } = await import("./featureFlags");
    return await isEnabled("outbound_voicemail_enabled");
  } catch (err) {
    log.warn("Feature-flag lookup failed · failing closed (disabled)", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Generate cloned-voice audio for the given text. Returns an MP3 URL
 * on success · null on failure. Caller decides fallback strategy.
 *
 * Defaults · provider Replicate, sample URL from XTTS_VOICE_SAMPLE_URL
 * env var, language en.
 */
export async function cloneVoice(opts: CloneVoiceOptions): Promise<CloneVoiceResponse> {
  const text = opts.text?.trim();
  if (!text) {
    return { ok: false, error: "empty_text", reason: "parse_error" };
  }

  if (!(await isVoiceCloneEnabled())) {
    return { ok: false, error: "feature flag off", reason: "disabled" };
  }

  const provider = opts.provider ?? (process.env.XTTS_PROVIDER as "replicate" | "modal" | undefined) ?? "replicate";
  const voiceSampleUrl = opts.voiceSampleUrl ?? process.env.XTTS_VOICE_SAMPLE_URL ?? "https://huggingface.co/coqui/XTTS-v2/resolve/v2.0.2/samples/en_sample.wav";
  if (!voiceSampleUrl) {
    return { ok: false, error: "XTTS_VOICE_SAMPLE_URL not set · cannot clone without sample", reason: "no_sample" };
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const language = opts.language ?? "en";

  if (provider === "modal") {
    return cloneViaModal({ text, voiceSampleUrl, language, timeoutMs });
  }
  return cloneViaReplicate({ text, voiceSampleUrl, language, timeoutMs });
}

// ─── Replicate backend ────────────────────────────────────────

async function cloneViaReplicate(args: {
  text: string;
  voiceSampleUrl: string;
  language: string;
  timeoutMs: number;
}): Promise<CloneVoiceResponse> {
  const apiKey = process.env.REPLICATE_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "REPLICATE_API_KEY not set", reason: "no_provider" };
  }

  const t0 = Date.now();

  try {
    // Replicate uses an async predict pattern · create prediction, then
    // poll OR use the `wait` query-param for synchronous-style response.
    // We use sync mode (preference=wait) up to 60s · most XTTS calls
    // return in 2-8s. If the model is cold, increase timeout to 60s.
    const createResp = await withTimeout(
      fetch(`${REPLICATE_API_BASE}/predictions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Prefer: "wait=60",
        },
        body: JSON.stringify({
          version: XTTS_REPLICATE_VERSION,
          input: {
            text: args.text,
            speaker: args.voiceSampleUrl,
            language: args.language,
            cleanup_voice: true,
          },
        }),
      }),
      args.timeoutMs,
      "replicate-xtts-create",
    );

    if (!createResp.ok) {
      const errText = await createResp.text().catch(() => "<no body>");
      return {
        ok: false,
        error: `Replicate HTTP ${createResp.status}: ${errText.slice(0, 200)}`,
        reason: "http_error",
      };
    }

    const data = (await createResp.json()) as {
      id: string;
      status: string;
      output?: string | string[];
      error?: string;
    };

    if (data.error) {
      return { ok: false, error: data.error, reason: "http_error" };
    }

    // With Prefer:wait, output is usually populated on first response
    let audioUrl = pickAudioUrl(data.output);
    if (audioUrl) {
      return {
        ok: true,
        audioUrl,
        source: "replicate",
        latencyMs: Date.now() - t0,
      };
    }

    // Fall through to polling if wait timed out
    if (!data.id) {
      return { ok: false, error: "Replicate returned no prediction id", reason: "parse_error" };
    }

    const pollDeadline = Date.now() + args.timeoutMs;
    while (Date.now() < pollDeadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const pollResp = await fetch(`${REPLICATE_API_BASE}/predictions/${data.id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!pollResp.ok) continue;
      const pollData = (await pollResp.json()) as {
        status: string;
        output?: string | string[];
        error?: string;
      };
      if (pollData.error) {
        return { ok: false, error: pollData.error, reason: "http_error" };
      }
      if (pollData.status === "succeeded") {
        audioUrl = pickAudioUrl(pollData.output);
        if (audioUrl) {
          return {
            ok: true,
            audioUrl,
            source: "replicate",
            latencyMs: Date.now() - t0,
          };
        }
      }
      if (pollData.status === "failed" || pollData.status === "canceled") {
        return { ok: false, error: `Replicate prediction ${pollData.status}`, reason: "http_error" };
      }
    }

    return { ok: false, error: "Replicate poll timeout", reason: "timeout" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.toLowerCase().includes("timeout");
    return { ok: false, error: msg, reason: isTimeout ? "timeout" : "http_error" };
  }
}

function pickAudioUrl(output: string | string[] | undefined): string | null {
  if (!output) return null;
  if (typeof output === "string") return output;
  if (Array.isArray(output) && output.length > 0) return output[0];
  return null;
}

// ─── Modal backend (self-hosted) ──────────────────────────────

async function cloneViaModal(args: {
  text: string;
  voiceSampleUrl: string;
  language: string;
  timeoutMs: number;
}): Promise<CloneVoiceResponse> {
  const url = process.env.XTTS_MODAL_URL;
  if (!url) {
    return { ok: false, error: "XTTS_MODAL_URL not set · cannot reach Modal endpoint", reason: "no_provider" };
  }
  const authToken = process.env.XTTS_MODAL_AUTH;
  const t0 = Date.now();
  try {
    const resp = await withTimeout(
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          text: args.text,
          speaker_url: args.voiceSampleUrl,
          language: args.language,
        }),
      }),
      args.timeoutMs,
      "modal-xtts",
    );
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "<no body>");
      return {
        ok: false,
        error: `Modal HTTP ${resp.status}: ${errText.slice(0, 200)}`,
        reason: "http_error",
      };
    }
    const data = (await resp.json()) as { audio_url?: string; url?: string };
    const audioUrl = data.audio_url ?? data.url;
    if (!audioUrl) {
      return { ok: false, error: "Modal returned no audio_url", reason: "parse_error" };
    }
    return {
      ok: true,
      audioUrl,
      source: "modal",
      latencyMs: Date.now() - t0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, reason: msg.toLowerCase().includes("timeout") ? "timeout" : "http_error" };
  }
}

// ─── Health probe ─────────────────────────────────────────────

/**
 * Health probe for /api/health surface. Confirms voice-clone provider
 * is reachable + the voice sample URL is fetchable. Light operation ·
 * doesn't actually run inference.
 */
export async function checkVoiceCloneHealth(): Promise<{
  enabled: boolean;
  provider: string;
  sampleReachable: boolean;
  providerReachable: boolean;
  error?: string;
}> {
  const enabled = await isVoiceCloneEnabled();
  const provider = (process.env.XTTS_PROVIDER as "replicate" | "modal" | undefined) ?? "replicate";
  const sampleUrl = process.env.XTTS_VOICE_SAMPLE_URL ?? "https://huggingface.co/coqui/XTTS-v2/resolve/v2.0.2/samples/en_sample.wav";

  let sampleReachable = false;
  if (sampleUrl) {
    try {
      const resp = await fetch(sampleUrl, { method: "HEAD", signal: AbortSignal.timeout(3000) });
      sampleReachable = resp.ok;
    } catch {
      sampleReachable = false;
    }
  }

  let providerReachable = false;
  let error: string | undefined;
  if (provider === "replicate") {
    providerReachable = Boolean(process.env.REPLICATE_API_KEY);
    if (!providerReachable) error = "REPLICATE_API_KEY not set";
  } else {
    providerReachable = Boolean(process.env.XTTS_MODAL_URL);
    if (!providerReachable) error = "XTTS_MODAL_URL not set";
  }

  return { enabled, provider, sampleReachable, providerReachable, error };
}
