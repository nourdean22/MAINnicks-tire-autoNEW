"use client";

import { useCallback, useState } from "react";
import { FileText, Loader2, RefreshCw } from "lucide-react";
import { formatTimestamp } from "@/lib/media/timestamp-refs";
import { videoIdForUrl } from "@/lib/media/video-registry";
import type { TranscriptSegment } from "@/lib/videodb/client";
import { useMediaDockStore } from "../stores/media-dock-store";

/**
 * MediaTranscriptPane (BDN-320) — the transcript half of media plan #3,
 * rendered inside the #6 focus panel.
 *
 * This was correctly withheld until BDN-318: `getTranscript` was
 * discarding the API's `word_timestamps` and returning a flat string, so
 * a pane could only have been an unclickable wall. With timings
 * preserved, each segment is a seek control driving the SAME token-based
 * `requestSeek` the timestamp bar uses — one seek path, not two.
 *
 * FIVE DISTINCT EMPTY STATES, DELIBERATELY NOT COLLAPSED
 * A transcript pane has more ways to be empty than to be full, and
 * flattening them into one "no transcript" line is what makes a feature
 * feel broken:
 *
 *   unknown-id  we never learned this media's videoId (see
 *               video-registry — session-scoped, empty after reload)
 *   loading     fetch in flight
 *   indexing    504 · VideoDB is still generating it — retryable
 *   no-timings  text came back but `segmentsUnavailable` — the clip HAS
 *               speech and none of it is seekable
 *   empty       genuinely no speech
 *
 * Only the last means "there is nothing here". The other four mean
 * "there is something here you cannot see yet", which is a different
 * sentence and earns a different one.
 *
 * STATE RESETS BY KEY, NOT BY EFFECT. The parent renders this with
 * `key={item.id}`, so switching media remounts and the state starts
 * clean. Resetting inside an effect instead would render clip A's
 * transcript under clip B for one frame, and trips
 * react-hooks/set-state-in-effect besides.
 *
 * NO AUTO-FETCH and NO RETRY LOOP — the operator presses the button. A
 * pane that silently re-polls a 504 burns quota against a key with 50
 * free uploads.
 */

type PaneState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "indexing"; hint: string }
  | { kind: "error"; message: string }
  | { kind: "ready"; segments: TranscriptSegment[]; text: string; segmentsUnavailable: boolean };

export function MediaTranscriptPane() {
  const item = useMediaDockStore((s) => s.item);
  const requestSeek = useMediaDockStore((s) => s.requestSeek);
  const [state, setState] = useState<PaneState>({ kind: "idle" });

  const videoId = videoIdForUrl(item?.url);

  const load = useCallback(async () => {
    if (!videoId) return;
    setState({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/ai/chat/media-transcript?videoId=${encodeURIComponent(videoId)}`,
      );
      const json = await res.json().catch(() => null);
      if (res.status === 504 && json?.retryable) {
        setState({ kind: "indexing", hint: json.hint ?? "Still transcribing." });
        return;
      }
      if (!res.ok) {
        setState({ kind: "error", message: json?.error ?? `Transcript failed (${res.status})` });
        return;
      }
      setState({
        kind: "ready",
        segments: json.segments ?? [],
        text: json.text ?? "",
        segmentsUnavailable: Boolean(json.segmentsUnavailable),
      });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Transcript failed" });
    }
  }, [videoId]);

  if (!item) return null;

  return (
    <section aria-label="Transcript" className="flex min-h-0 flex-1 flex-col border-t border-edge">
      <header className="flex items-center gap-2 px-3 py-2">
        <FileText size={12} className="text-fg-tertiary" />
        <span className="flex-1 text-[10px] uppercase tracking-wide text-fg-tertiary">
          Transcript
        </span>
        {videoId && state.kind !== "loading" ? (
          <button
            onClick={() => void load()}
            className="flex h-12 min-w-12 items-center justify-center rounded-md px-2 text-fg-tertiary transition-colors hover:text-fg"
            aria-label={state.kind === "ready" ? "Reload transcript" : "Load transcript"}
            title={state.kind === "ready" ? "Reload" : "Load transcript"}
          >
            <RefreshCw size={13} />
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {!videoId ? (
          <p className="text-[10px] leading-relaxed text-fg-tertiary">
            No transcript available — this media&apos;s VideoDB id isn&apos;t known in this
            session. Media attached before a reload loses that link.
          </p>
        ) : null}

        {videoId && state.kind === "idle" ? (
          <button
            onClick={() => void load()}
            className="text-[10px] text-fg-secondary underline underline-offset-2 hover:text-fg"
          >
            Load transcript
          </button>
        ) : null}

        {state.kind === "loading" ? (
          <p className="flex items-center gap-1.5 text-[10px] text-fg-tertiary">
            <Loader2 size={11} className="animate-spin" /> Fetching transcript…
          </p>
        ) : null}

        {state.kind === "indexing" ? (
          <p className="text-[10px] leading-relaxed text-fg-tertiary">
            {state.hint} This is not an error — reload in a moment.
          </p>
        ) : null}

        {state.kind === "error" ? (
          <p className="text-[10px] leading-relaxed text-amber-300">{state.message}</p>
        ) : null}

        {state.kind === "ready" && state.segments.length > 0 ? (
          <ol className="space-y-1">
            {state.segments.map((seg, i) => (
              <li key={`${seg.start}-${i}`}>
                <button
                  onClick={() => requestSeek(seg.start)}
                  className="flex w-full gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-elevated"
                  aria-label={`Jump to ${formatTimestamp(seg.start)}`}
                >
                  <span className="shrink-0 pt-px font-mono text-[9px] text-fg-tertiary">
                    {formatTimestamp(seg.start)}
                  </span>
                  <span className="text-[11px] leading-snug text-fg-secondary">{seg.text}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : null}

        {state.kind === "ready" && state.segments.length === 0 && state.segmentsUnavailable ? (
          <p className="text-[10px] leading-relaxed text-fg-tertiary">
            This media has speech, but no timings came back — nothing here is seekable.
            {state.text ? (
              <span className="mt-1.5 block text-fg-secondary">{state.text}</span>
            ) : null}
          </p>
        ) : null}

        {state.kind === "ready" && state.segments.length === 0 && !state.segmentsUnavailable ? (
          <p className="text-[10px] text-fg-tertiary">No speech detected in this media.</p>
        ) : null}
      </div>
    </section>
  );
}
