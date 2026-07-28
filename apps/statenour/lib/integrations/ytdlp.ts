/**
 * yt-dlp transcript lane (NL-4, 2026-07-28).
 *
 * A COMPONENT, not a platform: policy-guarded metadata + caption
 * extraction feeding the existing research pipeline (last30days already
 * sweeps YouTube by metadata; this adds what it lacked — transcripts).
 *
 * Controls, per the ingestion policy:
 *   - strict URL allowlist (youtube.com / youtu.be, https only, no
 *     embedded credentials) — validateVideoUrl is pure + tested
 *   - duration cap (60 min) — refuse before fetching captions
 *   - --skip-download ALWAYS: this lane never stores media files
 *   - process timeout 45s, caption fetch 20s, transcript capped 60k chars
 *   - graceful degrade when the binary is absent (firecrawl pattern):
 *     { available: false, reason } — never a throw into the caller
 *
 * Chat-tool registration is deliberately NOT here — exposing this to
 * the model means catalog entry + quota + injection-fencing review,
 * which is its own change.
 */
import { execFile } from "node:child_process";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("integrations/ytdlp");

const ALLOWED_HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "m.youtube.com",
  "youtu.be",
]);
const MAX_DURATION_S = 3600;
const MAX_TRANSCRIPT_CHARS = 60_000;
const PROCESS_TIMEOUT_MS = 45_000;
const CAPTION_FETCH_TIMEOUT_MS = 20_000;

/** Pure allowlist gate — exported for tests. */
export function validateVideoUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "https only" };
  if (url.username || url.password) return { ok: false, reason: "credentials in URL refused" };
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, reason: `host ${url.hostname} not in allowlist` };
  }
  return { ok: true, url };
}

/** Pure WebVTT → plain text — exported for tests. Drops headers, cue
 *  timings, positioning junk and inline tags; dedupes the rolling
 *  repeat lines auto-captions love. */
export function vttToPlainText(vtt: string): string {
  const lines = vtt.split(/\r?\n/);
  const out: string[] = [];
  let prev = "";
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t === "WEBVTT" || t.startsWith("Kind:") || t.startsWith("Language:")) continue;
    if (/-->/.test(t)) continue;
    if (/^\d+$/.test(t)) continue;
    const clean = t.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
    if (!clean || clean === prev) continue;
    prev = clean;
    out.push(clean);
  }
  return out.join(" ").slice(0, MAX_TRANSCRIPT_CHARS);
}

export interface VideoTranscriptResult {
  available: boolean;
  reason?: string;
  title?: string;
  channel?: string;
  durationS?: number;
  transcript?: string;
  transcriptSource?: "manual" | "auto";
  url?: string;
}

interface DumpJson {
  title?: string;
  channel?: string;
  uploader?: string;
  duration?: number;
  subtitles?: Record<string, Array<{ url?: string; ext?: string }>>;
  automatic_captions?: Record<string, Array<{ url?: string; ext?: string }>>;
}

function runYtDlp(args: string[]): Promise<{ ok: true; stdout: string } | { ok: false; reason: string }> {
  const bin = process.env.YTDLP_PATH || "yt-dlp";
  return new Promise((resolvePromise) => {
    execFile(
      bin,
      args,
      { timeout: PROCESS_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            resolvePromise({ ok: false, reason: "yt-dlp binary not installed (set YTDLP_PATH or add to image)" });
          } else {
            resolvePromise({ ok: false, reason: `yt-dlp failed: ${String(err.message).slice(0, 200)}` });
          }
          return;
        }
        resolvePromise({ ok: true, stdout });
      },
    );
  });
}

function pickCaptionUrl(meta: DumpJson): { url: string; source: "manual" | "auto" } | null {
  const pick = (m?: Record<string, Array<{ url?: string; ext?: string }>>) => {
    if (!m) return null;
    const lang = Object.keys(m).find((k) => k === "en" || k.startsWith("en"));
    if (!lang) return null;
    const vtt = m[lang].find((v) => v.ext === "vtt" && v.url) ?? m[lang].find((v) => v.url);
    return vtt?.url ?? null;
  };
  const manual = pick(meta.subtitles);
  if (manual) return { url: manual, source: "manual" };
  const auto = pick(meta.automatic_captions);
  if (auto) return { url: auto, source: "auto" };
  return null;
}

/**
 * Fetch metadata + English transcript for one allowlisted video.
 * Never throws — every failure mode returns { available: false, reason }.
 */
export async function fetchVideoTranscript(rawUrl: string): Promise<VideoTranscriptResult> {
  const gate = validateVideoUrl(rawUrl);
  if (!gate.ok) return { available: false, reason: gate.reason };
  const url = gate.url.toString();

  const dump = await runYtDlp(["--dump-json", "--skip-download", "--no-warnings", "--no-playlist", url]);
  if (!dump.ok) {
    log.warn("ytdlp_metadata_failed", { reason: dump.reason });
    return { available: false, reason: dump.reason, url };
  }

  let meta: DumpJson;
  try {
    meta = JSON.parse(dump.stdout) as DumpJson;
  } catch {
    return { available: false, reason: "yt-dlp returned non-JSON metadata", url };
  }

  const durationS = Math.round(Number(meta.duration ?? 0));
  if (durationS > MAX_DURATION_S) {
    return {
      available: false,
      reason: `duration ${durationS}s exceeds the ${MAX_DURATION_S}s ingestion cap`,
      title: meta.title,
      durationS,
      url,
    };
  }

  const caption = pickCaptionUrl(meta);
  if (!caption) {
    return {
      available: false,
      reason: "no English captions (manual or auto) on this video",
      title: meta.title,
      channel: meta.channel ?? meta.uploader,
      durationS,
      url,
    };
  }

  try {
    const res = await fetch(caption.url, { signal: AbortSignal.timeout(CAPTION_FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      return { available: false, reason: `caption fetch HTTP ${res.status}`, title: meta.title, durationS, url };
    }
    const vtt = await res.text();
    const transcript = vttToPlainText(vtt);
    if (!transcript) {
      return { available: false, reason: "caption track empty after normalization", title: meta.title, durationS, url };
    }
    return {
      available: true,
      title: meta.title,
      channel: meta.channel ?? meta.uploader,
      durationS,
      transcript,
      transcriptSource: caption.source,
      url,
    };
  } catch (e) {
    return {
      available: false,
      reason: `caption fetch failed: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`,
      title: meta.title,
      durationS,
      url,
    };
  }
}
