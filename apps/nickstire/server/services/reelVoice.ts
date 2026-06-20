/**
 * Reel voiceover (TTS) — Google Neural2 by default (free quota, commercial-clean,
 * no per-use key the operator must add), ElevenLabs as a richer fallback.
 * Ported from the proven scratch/gen-vo.ts. Returns null (never throws) when no
 * script or no provider is configured, so assembly degrades to music/silent.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("services:reel-voice");

export type VoiceProvider = "google" | "elevenlabs";
export interface VoiceAudio {
  buf: Buffer;
  ext: "wav" | "mp3";
  provider: VoiceProvider;
}

/** Google Neural2 preferred (free/commercial-clean); ElevenLabs if only its key is set. */
export function pickVoiceProvider(env: NodeJS.ProcessEnv = process.env): VoiceProvider | null {
  if (env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_KEY) return "google";
  if (env.ELEVENLABS_API_KEY) return "elevenlabs";
  return null;
}

/**
 * Wrap a plain VO script in lightweight SSML for a more natural, less monotone
 * read: a short pause between sentences (so the VO breathes and lands on the
 * cuts) and strong emphasis on the opening hook line. XML-escaped; degrades to a
 * bare <speak> wrapper when there are no sentence boundaries. Pure + testable.
 * Deliberately conservative — the deeper Neural2-J pitch/rate stays in audioConfig.
 */
export function buildReelSsml(script: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const sentences = (script ?? "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return `<speak>${esc((script ?? "").trim())}</speak>`;
  const parts = sentences.map((s, i) =>
    i === 0 ? `<emphasis level="strong">${esc(s)}</emphasis>` : esc(s),
  );
  return `<speak>${parts.join('<break time="350ms"/> ')}</speak>`;
}

/** Pure request shape for Google Cloud TTS (Neural2-J, LINEAR16 → WAV container). SSML for natural pacing. */
export function googleTtsRequest(script: string): { url: string; body: Record<string, unknown> } {
  return {
    url: "https://texttospeech.googleapis.com/v1/text:synthesize",
    body: {
      input: { ssml: buildReelSsml(script) },
      voice: { languageCode: "en-US", name: "en-US-Neural2-J" },
      audioConfig: { audioEncoding: "LINEAR16", speakingRate: 0.97, pitch: -1.5 },
    },
  };
}

async function googleVoice(script: string): Promise<Buffer> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "").replace(/\\n/g, "\n").replace(/^"|"$/g, "");
  const { google } = await import("googleapis");
  const jwt = new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const { token } = await jwt.getAccessToken();
  const { url, body } = googleTtsRequest(script);
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`google TTS HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { audioContent: string };
  return Buffer.from(j.audioContent, "base64");
}

async function elevenLabsVoice(script: string): Promise<Buffer> {
  const KEY = process.env.ELEVENLABS_API_KEY as string;
  const voiceId = "CwhRBWXzGAHq8TQ4Fs17"; // Roger
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: script,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true },
    }),
  });
  if (!r.ok) throw new Error(`elevenlabs HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}

/**
 * Generate a voiceover for the reel, or null when there's no script or no
 * provider configured. Never throws — a failed/absent VO just means the reel
 * assembles over music (or silent), it doesn't fail the whole job.
 */
export async function generateVoiceover(script: string | undefined | null): Promise<VoiceAudio | null> {
  const text = (script ?? "").trim();
  if (!text) return null;
  const provider = pickVoiceProvider();
  if (!provider) {
    log.warn("no TTS provider configured — reel will assemble without VO");
    return null;
  }
  try {
    if (provider === "google") return { buf: await googleVoice(text), ext: "wav", provider };
    return { buf: await elevenLabsVoice(text), ext: "mp3", provider };
  } catch (err) {
    log.warn("voiceover generation failed — degrading to no-VO", {
      provider,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
