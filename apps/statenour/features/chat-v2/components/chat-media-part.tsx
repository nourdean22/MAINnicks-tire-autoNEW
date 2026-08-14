"use client";

import { useRef } from "react";
import { Download, FileText, Film, ListPlus, Music, Paperclip, PictureInPicture2 } from "lucide-react";
import { useMediaDockStore, type DockedMedia } from "../stores/media-dock-store";

/**
 * ChatMediaPart — one renderer for every AI-SDK `file` message part.
 *
 * WHY THIS EXISTS
 * The chat-v2 renderer rendered `<img>` for image parts and a single
 * undifferentiated paperclip + filename for EVERYTHING else. A video,
 * a voice note, a PDF and a spreadsheet were visually identical, none
 * could be played, and none could be opened — the fallback had no
 * link. The backend meanwhile accepts and transcribes these, so the
 * capability existed and only the surface was missing.
 *
 * (An earlier draft of this comment claimed non-image parts rendered as
 * nothing. That was wrong — the paperclip branch existed at
 * chat-message-list.tsx:285. Recorded because the exaggeration would
 * have justified a larger rewrite than the defect warrants.)
 *
 * SCOPE — DELIBERATELY NO PLAYER LIBRARY
 * The originating plan proposed Vidstack or Media Chrome. Neither is
 * adopted here. Native `<video controls>` / `<audio controls>` already
 * provide play/pause, scrubbing, volume, fullscreen, Picture-in-Picture
 * and caption tracks in every browser this PWA targets, at zero bundle
 * cost. A player dependency belongs to the persistent-dock work (queue,
 * resume-across-navigation, chapters) where native controls genuinely
 * run out — not to "make files visible", which is this component's job.
 * Adding it now would be buying a dependency to solve a problem we have
 * not yet demonstrated.
 *
 * SAFETY
 * `url` on a file part is attacker-influenceable in principle (tool
 * output, scraped content, a poisoned attachment). `isRenderableUrl`
 * admits only http(s), data: and blob: — never javascript:, never
 * file:. An inadmissible URL degrades to the non-rendering card rather
 * than being dropped, so the operator still sees that something arrived.
 *
 * No autoplay, ever. `preload="metadata"` so a long video costs a
 * poster-frame, not the whole file, on a phone connection.
 */

export type MediaKind = "image" | "video" | "audio" | "pdf" | "other";

export interface ChatFilePart {
  url?: string;
  mediaType?: string;
  filename?: string;
}

/**
 * Classify a file part by mediaType, falling back to the filename
 * extension when mediaType is absent or generic.
 *
 * Uploads routinely arrive as application/octet-stream — the browser
 * guesses from extension and the server does not always correct it. A
 * classifier that trusted mediaType alone would push most real uploads
 * into "other", which is the bug this component exists to fix.
 */
export function classifyMediaPart(part: ChatFilePart): MediaKind {
  const type = (part.mediaType ?? "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf") return "pdf";

  const name = (part.filename ?? "").toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].includes(ext)) return "image";
  if (["mp4", "webm", "mov", "m4v", "ogv"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "aac", "ogg", "oga", "flac"].includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  return "other";
}

/**
 * Only schemes that can be safely placed in a src/href here.
 * Rejects javascript:, file:, and anything unparseable.
 */
export function isRenderableUrl(url: string | undefined): url is string {
  if (!url) return false;
  const trimmed = url.trim();
  if (trimmed.startsWith("/")) return true; // same-origin relative
  const scheme = trimmed.slice(0, trimmed.indexOf(":") + 1).toLowerCase();
  return scheme === "http:" || scheme === "https:" || scheme === "data:" || scheme === "blob:";
}

function humanKind(kind: MediaKind): string {
  switch (kind) {
    case "pdf":
      return "PDF";
    case "other":
      return "File";
    default:
      return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}

function KindIcon({ kind }: { kind: MediaKind }) {
  const props = { size: 14 } as const;
  if (kind === "video") return <Film {...props} />;
  if (kind === "audio") return <Music {...props} />;
  if (kind === "pdf") return <FileText {...props} />;
  return <Paperclip {...props} />;
}

/**
 * The fallback card. Used for unsupported types AND for any part whose
 * URL failed the scheme check — the operator always learns that a file
 * arrived, even when we decline to embed it.
 */
function FileCard({
  part,
  kind,
  reason,
}: {
  part: ChatFilePart;
  kind: MediaKind;
  reason?: string;
}) {
  const downloadable = isRenderableUrl(part.url);
  return (
    <div className="mt-2 flex items-center gap-2.5 rounded-lg border border-glass bg-[var(--bg-elevated)] px-3 py-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-glass text-[var(--text-tertiary)]">
        <KindIcon kind={kind} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] text-[var(--text-secondary)]">
          {part.filename || `${humanKind(kind)} attachment`}
        </div>
        <div className="text-[9px] text-[var(--text-tertiary)]">
          {reason ?? part.mediaType ?? "unknown type"}
        </div>
      </div>
      {downloadable ? (
        <a
          href={part.url}
          target="_blank"
          rel="noopener noreferrer"
          download={part.filename}
          className="flex h-12 min-w-12 items-center justify-center rounded px-2 text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
          aria-label={`Open ${part.filename || "attachment"}`}
          title="Open in a new tab"
        >
          <Download size={13} />
        </a>
      ) : null}
    </div>
  );
}

/**
 * Render one file part. Returns the fallback card rather than null for
 * anything it cannot embed — this component never renders nothing.
 */
export function ChatMediaPart({ part, id }: { part: ChatFilePart; id?: string }) {
  const kind = classifyMediaPart(part);
  const dock = useMediaDockStore((s) => s.dock);
  const enqueue = useMediaDockStore((s) => s.enqueue);
  const dockedItem = useMediaDockStore((s) => s.item);
  const rememberPosition = useMediaDockStore((s) => s.rememberPosition);

  /** The inline element, so pop-out can hand off its position. */
  const inlineRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  /**
   * BDN-311 · pop-out affordance.
   *
   * Deliberately an EXPLICIT button rather than hijacking the play event.
   * The originating plan said media should move to the dock "when a user
   * presses play", but silently relocating a player the moment someone
   * presses play steals the control they just used and is the kind of
   * cleverness that reads as a bug. Inline play keeps working for short
   * clips; the dock is opt-in for the ones worth keeping on screen.
   *
   * REVIEW FIX (2026-08-14, P2): the first version handed the dock only a
   * URL. The dock therefore opened a SECOND player at zero while the
   * inline one kept playing — two elements producing audio at once, and a
   * button labelled "Keep playing" that demonstrably did not. Now the
   * hand-off pauses the inline element and records its position first;
   * the dock's existing resume effect picks it up on mount, so the
   * mechanism was already there and simply was not being fed.
   */
  const isPlayable = (kind === "video" || kind === "audio") && !!id && isRenderableUrl(part.url);

  const asDocked = (): DockedMedia => ({
    id: id as string,
    url: part.url as string,
    kind: kind as "video" | "audio",
    title: part.filename || `${humanKind(kind)} attachment`,
  });

  const handOffPosition = () => {
    const el = inlineRef.current;
    if (!el || !id) return;
    if (Number.isFinite(el.currentTime) && el.currentTime > 0) {
      rememberPosition(id, el.currentTime);
    }
    el.pause();
  };

  // Something else is already docked — offer QUEUE as well as play-now.
  // Without this the store's enqueue() had no caller outside tests, so
  // the dock's queued-count and skip controls were unreachable (P2).
  const somethingElseDocked = !!dockedItem && dockedItem.id !== id;

  const popOut = isPlayable ? (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <button
        onClick={() => {
          handOffPosition();
          dock(asDocked());
        }}
        className="inline-flex h-12 min-w-12 items-center gap-1.5 rounded-md px-2.5 text-[10px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
        aria-label="Keep playing while you chat"
        title="Pop out to the player dock"
      >
        <PictureInPicture2 size={12} /> {somethingElseDocked ? "Play now" : "Keep playing"}
      </button>
      {somethingElseDocked ? (
        <button
          onClick={() => {
            handOffPosition();
            enqueue(asDocked());
          }}
          className="inline-flex h-12 min-w-12 items-center gap-1.5 rounded-md px-2.5 text-[10px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
          aria-label="Add to the player queue"
          title="Play after the current item"
        >
          <ListPlus size={12} /> Queue
        </button>
      ) : null}
    </div>
  ) : null;

  if (!isRenderableUrl(part.url)) {
    return <FileCard part={part} kind={kind} reason="unavailable — no usable link" />;
  }

  const label = part.filename || `${humanKind(kind)} attachment`;

  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={part.url}
        alt={label}
        className="mt-2 max-h-64 rounded-lg border border-glass"
      />
    );
  }

  if (kind === "video") {
    return (
      <div>
        <video
          ref={inlineRef as React.RefObject<HTMLVideoElement>}
          src={part.url}
          controls
          preload="metadata"
          playsInline
          className="mt-2 max-h-80 w-full rounded-lg border border-glass bg-black"
          aria-label={label}
        >
          {/* Native fallback for a codec the browser cannot decode. */}
          <FileCard part={part} kind="video" reason="video format not supported here" />
        </video>
        {popOut}
      </div>
    );
  }

  if (kind === "audio") {
    return (
      <div className="mt-2 rounded-lg border border-glass bg-[var(--bg-elevated)] px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]">
          <Music size={12} />
          <span className="truncate">{label}</span>
        </div>
        <audio
          ref={inlineRef as React.RefObject<HTMLAudioElement>}
          src={part.url}
          controls
          preload="metadata"
          className="w-full"
          aria-label={label}
        />
        {popOut}
      </div>
    );
  }

  if (kind === "pdf") {
    // Deliberately NOT an <iframe> embed. iOS Safari — the operator's
    // primary surface — does not render inline PDF iframes reliably and
    // silently shows a blank box, which is the exact failure this
    // component was built to remove. A card that opens in the system
    // viewer works everywhere.
    return <FileCard part={part} kind="pdf" reason={part.mediaType ?? "application/pdf"} />;
  }

  return <FileCard part={part} kind={kind} />;
}
