"use client";

import { PanelRightClose, SkipForward, X } from "lucide-react";
import { useMediaDockStore } from "../stores/media-dock-store";
import { MediaPlayerSurface } from "./chat-media-surface";
import { SaveMomentButton } from "./media-save-moment";
import { MediaTranscriptPane } from "./media-transcript-pane";

/**
 * ChatMediaFocusPanel (BDN-315) — media plan item #6, desktop half.
 *
 * A right-side panel for watching something properly while the
 * conversation stays live beside it. Follows the house side-panel
 * pattern verbatim (MemoryInspectorSidebar): `fixed inset-y-0 right-0
 * z-50 w-80 md:w-96`, null when closed.
 *
 * WHAT THE PLAN ASKED NOT TO BUILD
 * "Do not permanently force a three-column dashboard. It will make the
 * chat feel like an admin panel instead of a powerful conversational
 * tool." So this is opt-in, dismissible, and renders nothing until the
 * operator asks for it. The chat column is not resized or re-laid-out;
 * the panel overlays, exactly as the memory inspector already does.
 *
 * DESKTOP ONLY — `hidden md:flex`. On a phone a 384px side panel would
 * cover the conversation it is supposed to sit beside, which is why the
 * plan specifies the persistent dock for mobile. The dock (BDN-311)
 * already IS the mobile answer, so there is nothing extra to build there.
 *
 * ONE PLAYER: the dock hides its surface whenever `focused` is true, and
 * this panel only renders when it is. See MediaPlayerSurface's header.
 */
export function ChatMediaFocusPanel() {
  const item = useMediaDockStore((s) => s.item);
  const focused = useMediaDockStore((s) => s.focused);
  const queue = useMediaDockStore((s) => s.queue);
  const setFocused = useMediaDockStore((s) => s.setFocused);
  const playNext = useMediaDockStore((s) => s.playNext);
  const close = useMediaDockStore((s) => s.close);

  if (!item || !focused) return null;

  return (
    <aside
      aria-label={`Media focus — ${item.title}`}
      className="fixed inset-y-0 right-0 z-50 hidden w-80 flex-col border-l border-edge overflow-hidden bg-void shadow-2xl md:flex md:w-96"
    >
      <header className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] text-fg-secondary">{item.title}</div>
          {queue.length > 0 ? (
            <div className="text-[9px] text-fg-tertiary">{queue.length} queued</div>
          ) : null}
        </div>

        {queue.length > 0 ? (
          <button
            onClick={playNext}
            className="flex h-12 w-12 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:text-fg"
            aria-label="Play next in queue"
            title="Next"
          >
            <SkipForward size={16} />
          </button>
        ) : null}

        {/* BDN-316 · explicit save. Never an effect. */}
        <SaveMomentButton />

        <button
          onClick={() => setFocused(false)}
          className="flex h-12 w-12 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:text-fg"
          aria-label="Return player to the dock"
          title="Back to dock"
        >
          <PanelRightClose size={16} />
        </button>

        <button
          onClick={close}
          className="flex h-12 w-12 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:text-red-400"
          aria-label="Close player"
          title="Close"
        >
          <X size={16} />
        </button>
      </header>

      <div className="shrink-0 p-3">
        <MediaPlayerSurface className="w-full rounded-lg border border-glass bg-black" />
      </div>

      {/* BDN-320 · the transcript pane the split-screen sketch called
          for. Correctly withheld until BDN-318 made getTranscript
          preserve `word_timestamps` — before that it could only have
          been an unclickable wall. Now every segment seeks the player
          through the same requestSeek the timestamp bar uses. */}
      {/* key: remount on media change so transcript state cannot leak
          from one clip to the next. */}
      <MediaTranscriptPane key={item.id} />
    </aside>
  );
}
