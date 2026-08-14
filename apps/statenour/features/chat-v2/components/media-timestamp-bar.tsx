"use client";

import { useMemo } from "react";
import { Crosshair } from "lucide-react";
import { formatTimestamp, parseTimestampRefs } from "@/lib/media/timestamp-refs";
import { useMediaDockStore } from "../stores/media-dock-store";

/**
 * MediaTimestampBar (BDN-312) — media plan item #3, the seek half.
 *
 * The plan's design rule: "when Nick answers a question about a video,
 * show the exact time range used… then the timestamp becomes clickable
 * and seeks the player." This renders that strip beneath an assistant
 * reply and drives the dock's seek API — the token-based one built in
 * BDN-311 specifically so re-clicking the same timestamp still fires.
 *
 * WHY A STRIP AND NOT INLINE LINKS
 * Inline would require rewriting the markdown pipeline (NickMessage →
 * Streamdown), which is an operator-approved composition and the highest-
 * traffic render path in the app. A separate strip gets the same seek
 * behavior with none of that blast radius, and it arguably serves the
 * EVIDENCE goal better: the cited ranges are collected in one place
 * instead of scattered through prose, so "what did Nick actually watch"
 * is answerable at a glance.
 *
 * RENDERS ONLY WHEN A PLAYER IS DOCKED.
 * A seek control with nothing to seek is a dead button that teaches the
 * operator the timestamps do not work. No dock, no strip — the prose
 * still reads fine on its own.
 *
 * HONEST LABELLING
 * The strip says "mentioned", never "sources" or "evidence". These are
 * times the model WROTE, parsed out of prose — not citations the
 * pipeline verified against a transcript. Until `getTranscript` returns
 * timed segments (it currently returns a flat string, so nothing can be
 * verified against), calling these evidence would be a receipt with no
 * evidence behind it.
 */
export function MediaTimestampBar({ text }: { text: string }) {
  const item = useMediaDockStore((s) => s.item);
  const requestSeek = useMediaDockStore((s) => s.requestSeek);

  const refs = useMemo(() => parseTimestampRefs(text), [text]);

  if (!item || refs.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wide text-fg-tertiary">
        <Crosshair size={10} /> mentioned
      </span>
      {refs.map((ref) => {
        const label =
          ref.end !== undefined
            ? `${formatTimestamp(ref.start)}–${formatTimestamp(ref.end)}`
            : formatTimestamp(ref.start);
        return (
          <button
            key={`${ref.start}-${ref.end ?? ""}`}
            onClick={() => requestSeek(ref.start)}
            className="inline-flex h-11 items-center rounded-md border border-glass px-2.5 font-mono text-[10px] text-fg-secondary transition-colors hover:border-fg-tertiary hover:text-fg"
            aria-label={
              ref.end !== undefined
                ? `Jump to ${label} in ${item.title}`
                : `Jump to ${label} in ${item.title}`
            }
            title={`Seek ${item.title} to ${formatTimestamp(ref.start)}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
