/**
 * Reel voiceover (TTS) — Google Neural2 by default (free quota, commercial-clean,
 * no per-use key the operator must add), ElevenLabs as a richer fallback.
 * Ported from the proven scratch/gen-vo.ts.
 *
 * Failure policy: a brief WITHOUT a voiceoverScript is a deliberately silent
 * reel — null, assemble over music. A brief WITH a script is designed around
 * narration: its beats, captions, and CTA assume a voice, so losing TTS now
 * THROWS and fails the job (the pipeline retries, then surfaces it in the
 * failed-jobs counter) instead of silently publishing a narration-less reel
 * nobody reviewed. Set REEL_VO_OPTIONAL=true to restore degrade-to-silent.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("services:reel-voice");

export type VoiceProvider = "google" | "elevenlabs";
export interface VoiceAudio {
  buf: Buffer;
  ext: "wav" | "mp3";
  provider: VoiceProvider;
  alignment?: VoiceAlignment;
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

export interface VoiceAlignment {
  characters: string[];
  characterStartTimesSeconds: number[];
  characterEndTimesSeconds: number[];
}

async function elevenLabsVoice(script: string): Promise<{ buf: Buffer; alignment?: VoiceAlignment }> {
  const KEY = process.env.ELEVENLABS_API_KEY as string;
  // Operator-selectable brand voice; "Roger" stays the default so existing
  // deployments keep their sound until ELEVENLABS_VOICE_ID is set.
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "CwhRBWXzGAHq8TQ4Fs17"; // Roger
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: script,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true },
    }),
  });
  if (!r.ok) throw new Error(`elevenlabs HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  
  const j = await r.json() as {
    audio_base64: string;
    alignment?: {
      characters: string[];
      character_start_times_seconds: number[];
      character_end_times_seconds: number[];
    };
  };
  
  const buf = Buffer.from(j.audio_base64, "base64");
  const alignment = j.alignment ? {
    characters: j.alignment.characters,
    characterStartTimesSeconds: j.alignment.character_start_times_seconds,
    characterEndTimesSeconds: j.alignment.character_end_times_seconds,
  } : undefined;
  
  return { buf, alignment };
}

/** True when the operator has explicitly opted back into degrade-to-silent. */
function voiceoverOptional(): boolean {
  return process.env.REEL_VO_OPTIONAL === "true";
}

/**
 * Generate a voiceover for the reel. Null means "this reel is silent on
 * purpose" — either the brief carries no script, or REEL_VO_OPTIONAL=true
 * explicitly allows degrading. When a script exists and TTS cannot deliver,
 * this THROWS: the reel was designed around narration, and shipping it
 * narration-less used to happen silently (the operator approved a reel with a
 * voice; a different reel published). The assembly pipeline already retries
 * failed jobs and surfaces terminal failures in the Settings health counter.
 */
export async function generateVoiceover(script: string | undefined | null): Promise<VoiceAudio | null> {
  const text = (script ?? "").trim();
  if (!text) return null;
  const provider = pickVoiceProvider();
  if (!provider) {
    if (voiceoverOptional()) {
      log.warn("no TTS provider configured — REEL_VO_OPTIONAL=true, assembling without VO");
      return null;
    }
    throw new Error(
      "Reel brief has a voiceover script but no TTS provider is configured (set GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_KEY, or ELEVENLABS_API_KEY; or set REEL_VO_OPTIONAL=true to allow silent assembly)",
    );
  }
  try {
    if (provider === "google") {
      try {
        return { buf: await googleVoice(text), ext: "wav", provider };
      } catch (err) {
        // Runtime fallback (previously selection-time only): a Google failure
        // with ElevenLabs configured should degrade to the other provider, not
        // to a failed job. Google outages were burning whole reels.
        if (process.env.ELEVENLABS_API_KEY) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn("Google TTS failed - falling back to ElevenLabs", { err: msg });
          const { buf, alignment } = await elevenLabsVoice(text);
          return { buf, ext: "mp3", provider: "elevenlabs", alignment };
        }
        throw err;
      }
    }
    const { buf, alignment } = await elevenLabsVoice(text);
    return { buf, ext: "mp3", provider, alignment };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (voiceoverOptional()) {
      log.warn("voiceover generation failed — REEL_VO_OPTIONAL=true, degrading to no-VO", { provider, err: msg });
      return null;
    }
    throw new Error(`Voiceover generation failed (${provider}): ${msg} — the brief's narration is required; set REEL_VO_OPTIONAL=true to allow silent assembly`);
  }
}

export interface WordAlignment {
  word: string;
  startSec: number;
  endSec: number;
}

export function formatAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

export function generateAssSubtitles(alignment: VoiceAlignment): string {
  const words: WordAlignment[] = [];
  let currentWord = "";
  let currentStart = 0;
  
  for (let i = 0; i < alignment.characters.length; i++) {
    const char = alignment.characters[i];
    const isSpace = char === " " || char === "\n";
    
    if (currentWord.length === 0 && !isSpace) {
      currentStart = alignment.characterStartTimesSeconds[i];
      currentWord += char;
    } else if (!isSpace) {
      currentWord += char;
    }
    
    if ((isSpace || i === alignment.characters.length - 1) && currentWord.length > 0) {
      words.push({
        word: currentWord,
        startSec: currentStart,
        endSec: alignment.characterEndTimesSeconds[i]
      });
      currentWord = "";
    }
  }

  let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Anton,80,&H0013B9FD,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,3,6,0,2,20,20,500,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const chunkSize = 3;
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize);
    
    for (let j = 0; j < chunk.length; j++) {
      const activeWord = chunk[j];
      let text = "";
      for (let k = 0; k < chunk.length; k++) {
        if (k === j) {
          text += `{\\c&H13B9FD&}${chunk[k].word} `;
        } else {
          text += `{\\c&HFFFFFF&}${chunk[k].word} `;
        }
      }
      
      ass += `Dialogue: 0,${formatAssTime(activeWord.startSec)},${formatAssTime(activeWord.endSec)},Default,,0,0,0,,${text.trim()}\n`;
    }
  }
  return ass;
}

