"use client";

import { useState } from "react";
import { Loader2, Maximize2, Shuffle } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

// v6 · BATCH 2 · Apr 28 — Image render with hover upscale overlay.
// Renders the generated image with a hover-revealed 2x/4x button strip.
// On click, POSTs to /api/images/upscale and hot-swaps the src to the
// upscaled image when it returns. Stays fully functional for non-
// upscalable URLs (no imageId) — the buttons just don't render.
interface ImageWithUpscaleProps {
  srcStr: string;
  alt: string;
  imageId?: string;
}

export function ImageWithUpscale({ srcStr, alt, imageId }: ImageWithUpscaleProps) {
  const [currentSrc, setCurrentSrc] = useState(srcStr);
  const [upscaling, setUpscaling] = useState<2 | 4 | null>(null);
  const [varying, setVarying] = useState(false);
  const [variants, setVariants] = useState<Array<{ imageUrl: string; imageId: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  // Phase II · 2 mutation procedures replace the legacy authedFetch
  // POSTs · same useMutation().mutateAsync() pattern HH established.
  // The local upscaling/varying flags stay because the UI tracks
  // WHICH scale is in flight (mutation.isPending alone can't tell
  // "2x vs 4x").
  const upscaleMutation = trpc.chat.upscaleImage.useMutation();
  const varyMutation = trpc.chat.varyImage.useMutation();

  const handleUpscale = async (scale: 2 | 4) => {
    if (!imageId || upscaling) return;
    setUpscaling(scale);
    setError(null);
    try {
      const result = await upscaleMutation.mutateAsync({
        sourceImageId: imageId,
        scale,
        enhance: true,
      });
      setCurrentSrc(result.imageUrl);
      setImgFailed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpscaling(null);
    }
  };

  // v6 · BATCH 3 · Apr 28 — Variation button.
  // Generates N variants of the same prompt with a different seed.
  // Variants render below the source as a strip.
  const handleVary = async () => {
    if (!imageId || varying) return;
    setVarying(true);
    setError(null);
    try {
      const result = await varyMutation.mutateAsync({
        sourceImageId: imageId,
        count: 2,
        speed: "fast",
      });
      setVariants(result.images);
      // Notification toast — reuses native browser notification API when
      // the page isn't focused. Falls back to silent when permission isn't granted.
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
        new Notification("Image variations ready", {
          body: `${result.count} variants generated · tap to view`,
          icon: currentSrc,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVarying(false);
    }
  };

  // v6 · Apr 28 hotfix · The wrapper MUST be a <span> (inline element)
  // because react-markdown renders images inside <p> tags. A <div>
  // descendant of <p> is invalid HTML and breaks hydration. We give the
  // span `display: inline-block` via class so the absolute-positioned
  // overlay buttons still anchor correctly. The inner action overlay
  // also became <span> for the same reason.
  return (
    <span className="relative group inline-block">
      {imgFailed ? (
        <span className="inline-block rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2.5 mt-2 mb-1 text-[11px] text-rose-300 font-mono">
          image failed to load ({currentSrc.slice(-12)})
        </span>
      ) : (
        <a href={currentSrc} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentSrc}
            alt={alt}
            loading="lazy"
            className="rounded-lg max-w-full max-h-[400px] border border-[var(--border)] mt-2 mb-1 cursor-pointer hover:opacity-90 transition-opacity"
            onError={() => setImgFailed(true)}
          />
        </a>
      )}
      {imageId && (
        // 2026-07-11 review · on touch devices (no hover) these buttons were
        // opacity-0 yet still tappable ON TOP of the image link — a blind tap
        // near the top-right fired a paid Venice vary/upscale mutation the
        // operator couldn't see. Make them visible when hover is unavailable.
        <span className="absolute top-3 right-1 inline-flex gap-1 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={handleVary}
            disabled={varying || !!upscaling}
            className={cn(
              "rounded-md border border-white/15 bg-black/70 backdrop-blur-sm px-2 py-1 text-[10px] font-mono uppercase tracking-wider transition",
              varying
                ? "text-violet-300 border-violet-500/40"
                : "text-white hover:bg-black/85",
            )}
            title="Variations (2× turbo, ~$0.02 each)"
          >
            {varying ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <span className="flex items-center gap-1">
                <Shuffle className="h-3 w-3" /> vary
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => handleUpscale(2)}
            disabled={!!upscaling || varying}
            className={cn(
              "rounded-md border border-white/15 bg-black/70 backdrop-blur-sm px-2 py-1 text-[10px] font-mono uppercase tracking-wider transition",
              upscaling === 2
                ? "text-amber-300 border-amber-500/40"
                : "text-white hover:bg-black/85",
            )}
            title="Upscale 2× (~$0.02, 30s)"
          >
            {upscaling === 2 ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <span className="flex items-center gap-1">
                <Maximize2 className="h-3 w-3" /> 2x
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => handleUpscale(4)}
            disabled={!!upscaling || varying}
            className={cn(
              "rounded-md border border-white/15 bg-black/70 backdrop-blur-sm px-2 py-1 text-[10px] font-mono uppercase tracking-wider transition",
              upscaling === 4
                ? "text-amber-300 border-amber-500/40"
                : "text-white hover:bg-black/85",
            )}
            title="Upscale 4× (~$0.04, 60s) — billboard/print quality"
          >
            {upscaling === 4 ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <span className="flex items-center gap-1">
                <Maximize2 className="h-3 w-3" /> 4x
              </span>
            )}
          </button>
        </span>
      )}
      {/* v6 · BATCH 3 · Apr 28 — Variants strip below the source.
          All <span> not <div> because the parent is <p> via markdown. */}
      {variants.length > 0 && (
        <span className="mt-2 inline-flex gap-1.5 flex-wrap">
          <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider self-center">variants:</span>
          {variants.map((v) => (
            <a key={v.imageId} href={v.imageUrl} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={v.imageUrl}
                alt="variant"
                className="h-16 w-16 rounded border border-violet-500/30 cursor-pointer hover:opacity-80 transition-opacity object-cover"
              />
            </a>
          ))}
        </span>
      )}
      {error && (
        <span className="mt-1 inline-block rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1 text-[10px] text-rose-300 font-mono">
          {error}
        </span>
      )}
    </span>
  );
}
