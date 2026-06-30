"use client";

/**
 * /photo-improver — storefront/car/shop photo improver.
 *
 * v6 · BATCH 7 · Apr 28. Upload a photo, vision model analyzes it,
 * returns a scorecard + specific improvements + a re-rendered Nick's
 * Tire branded variant. Closes the loop between "phone photo" and
 * "shippable marketing asset" without leaving Nour's chat OS.
 *
 * Flow:
 *   1. Drop image (drag/drop or click)
 *   2. Click "analyze" → vision model returns scores + improvements
 *   3. Click "rebrand" → recraft-v4 renders the same scene with brand
 *   4. Send to /social to publish, /chat to caption-gen
 */

import { useState, useCallback } from "react";
import { Panel } from "@/components/panel";
import { StandardPage } from "@/components/layout/standard-page";
import { cn } from "@/lib/utils/cn";
import { Upload, Loader2, AlertCircle, Sparkles, Send, Image as ImageIcon, Wand2 } from "lucide-react";
import Link from "next/link";

// misc-pages slice (2026-05-22) · the analyze/rebrand run moved off
// authedFetch onto trpc.operator.improvePhoto.
import { trpc } from "@/lib/trpc/client";
interface AnalysisResult {
  scores: {
    lighting: number;
    framing: number;
    brandPresence: number;
    cleanliness: number;
    professionalPolish: number;
    overall: number;
  };
  subject: string;
  currentMood: string;
  issues: string[];
  improvements: Array<{
    type: "crop" | "lighting" | "framing" | "brand" | "edit";
    instruction: string;
    priority: "high" | "medium" | "low";
  }>;
  marketingFit: {
    instagram: "good" | "ok" | "bad";
    facebook: "good" | "ok" | "bad";
    gbp: "good" | "ok" | "bad";
    billboard: "good" | "ok" | "bad";
    best: "instagram" | "facebook" | "gbp" | "billboard";
  };
  rebrandPrompt: string;
}

interface ImproveResponse {
  ok: boolean;
  mode: "analyze" | "rebrand" | "both";
  analysis: AnalysisResult | null;
  analysisModel: string;
  analysisDurationMs: number;
  rebrandedImageUrl?: string;
  rebrandedImageId?: string;
  rebrandModel?: string;
  rebrandDurationMs?: number;
}

function scoreTone(s: number): string {
  if (s >= 80) return "text-emerald-300";
  if (s >= 60) return "text-sky-300";
  if (s >= 40) return "text-amber-300";
  return "text-rose-300";
}

function fitTone(f: string): string {
  return {
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    ok: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    bad: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  }[f] ?? "";
}

export default function PhotoImproverPage() {
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string>("");
  const [data, setData] = useState<ImproveResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"analyze" | "rebrand" | "both">("both");

  const handleFile = (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      setError("Image too large (max 10MB)");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? result;
      setImageBase64(base64);
      setImageUrl("");
      setData(null);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file?.type.startsWith("image/")) handleFile(file);
  }, []);

  const onChoose = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const improvePhoto = trpc.operator.improvePhoto.useMutation();

  const run = async () => {
    if (!imageBase64 && !imageUrl) {
      setError("Drop or paste an image first");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // tRPC surfaces a non-2xx as a thrown error (replacing the
      // v10.0.33 manual res.ok-before-.json() guard).
      const json = (await improvePhoto.mutateAsync({
        imageBase64: imageBase64 ?? undefined,
        imageUrl: imageUrl || undefined,
        mode,
      })) as ImproveResponse;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <StandardPage
      eyebrow="NOUR OS · Imagery"
      title="photo improver"
      description="Drop a phone photo. Get a scorecard, specific fixes, and a Nick's Tire branded re-render."
      width="lg"
      rhythm="comfortable"
    >

      {/* Drop zone */}
      <Panel>
        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          className={cn(
            "rounded-lg border-2 border-dashed p-6 text-center transition-colors",
            imageBase64 || imageUrl
              ? "border-emerald-500/40 bg-emerald-500/[0.03]"
              : "border-white/15 hover:border-white/30 hover:bg-white/[0.02]",
          )}
        >
          {(imageBase64 || imageUrl) ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageBase64 ? `data:image/png;base64,${imageBase64}` : imageUrl}
                alt="upload"
                className="rounded max-h-72 mx-auto border border-white/10"
              />
              <button
                onClick={() => {
                  setImageBase64(null);
                  setImageUrl("");
                  setData(null);
                }}
                className="text-xs text-zinc-400 hover:text-zinc-200"
              >
                replace
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <Upload className="h-10 w-10 text-zinc-500 mx-auto" />
              <div className="text-sm text-zinc-400">
                Drag a photo here, or
              </div>
              <label className="inline-block cursor-pointer rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/[0.06]">
                <Upload className="h-3 w-3 inline mr-1" /> choose file
                <input type="file" accept="image/*" onChange={onChoose} className="hidden" />
              </label>
              <div className="text-xs text-zinc-500">— or paste a URL —</div>
              <input
                type="text"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://... or /api/images/abc"
                className="w-full max-w-md rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 outline-none focus:border-white/25"
              />
            </div>
          )}
        </div>
      </Panel>

      {/* Mode + run */}
      {(imageBase64 || imageUrl) && (
        <Panel>
          <div className="space-y-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">mode</div>
              <div className="flex gap-1">
                {(["analyze", "rebrand", "both"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs transition-colors",
                      mode === m
                        ? "bg-violet-500/15 text-violet-200 border border-violet-500/40"
                        : "bg-white/[0.02] text-zinc-400 hover:bg-white/[0.06] border border-white/10",
                    )}
                  >
                    {m === "analyze" ? "analyze only" : m === "rebrand" ? "rebrand only" : "analyze + rebrand"}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={run}
              disabled={loading}
              className={cn(
                "rounded-lg border px-4 py-2 text-sm font-medium transition w-full sm:w-auto",
                loading
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-200 cursor-wait"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15",
              )}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {mode === "both" ? "analyzing + rebranding…" : mode === "rebrand" ? "rebranding…" : "analyzing…"}
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  Run
                </span>
              )}
            </button>
          </div>
        </Panel>
      )}

      {error && (
        <Panel className="border-rose-500/40 bg-rose-500/10">
          <div className="flex items-center gap-2 p-3 text-sm text-rose-200">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        </Panel>
      )}

      {/* Analysis */}
      {data?.analysis && (
        <>
          <Panel>
            <div className="space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">subject</div>
                <div className="text-sm text-zinc-200">{data.analysis.subject}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">current mood</div>
                <div className="text-sm text-amber-300">{data.analysis.currentMood}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">scores</div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
                  {Object.entries(data.analysis.scores).map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-white/10 bg-white/[0.02] p-1.5 text-center">
                      <div className="text-[8px] uppercase tracking-wider text-zinc-500">{k.replace(/([A-Z])/g, " $1").trim()}</div>
                      <div className={cn("font-mono text-base font-bold tabular-nums", scoreTone(v))}>
                        {v}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">marketing fit</div>
                <div className="flex gap-1 flex-wrap">
                  {Object.entries(data.analysis.marketingFit).filter(([k]) => k !== "best").map(([k, v]) => (
                    <span
                      key={k}
                      className={cn(
                        "rounded px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider border",
                        fitTone(v as string),
                        k === data.analysis!.marketingFit.best && "ring-2 ring-emerald-500/30",
                      )}
                    >
                      {k} · {v}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Panel>

          {/* Issues */}
          {data.analysis.issues.length > 0 && (
            <Panel className="border-amber-500/30 bg-amber-500/[0.03]">
              <h2 className="text-sm font-semibold text-amber-300 mb-2">issues</h2>
              <ul className="space-y-1">
                {data.analysis.issues.map((iss, idx) => (
                  <li key={idx} className="text-xs text-amber-200/80 flex items-start gap-1.5">
                    <span className="text-amber-400 flex-shrink-0">·</span>
                    <span>{iss}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {/* Improvements */}
          {data.analysis.improvements.length > 0 && (
            <Panel>
              <h2 className="text-sm font-semibold text-white mb-2">specific improvements</h2>
              <div className="space-y-1.5">
                {data.analysis.improvements.map((imp, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "rounded-md border px-2 py-1.5 text-xs flex items-start gap-2",
                      imp.priority === "high"
                        ? "border-rose-500/30 bg-rose-500/[0.04] text-rose-200"
                        : imp.priority === "medium"
                          ? "border-amber-500/30 bg-amber-500/[0.04] text-amber-200"
                          : "border-zinc-500/30 bg-zinc-500/[0.04] text-zinc-300",
                    )}
                  >
                    <span className="font-mono text-[9px] uppercase tracking-wider opacity-70 flex-shrink-0">
                      [{imp.type}]
                    </span>
                    <span className="flex-1">{imp.instruction}</span>
                    <span className="text-[9px] uppercase opacity-60">{imp.priority}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </>
      )}

      {/* Rebranded image */}
      {data?.rebrandedImageUrl && (
        <Panel className="border-emerald-500/30 bg-emerald-500/[0.04]">
          <h2 className="text-sm font-semibold text-emerald-300 mb-2 flex items-center gap-1">
            <Wand2 className="h-4 w-4" /> Branded variant
          </h2>
          <a href={data.rebrandedImageUrl} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.rebrandedImageUrl}
              alt="rebranded"
              className="rounded-lg max-w-full max-h-96 mx-auto border border-emerald-500/30 cursor-pointer hover:opacity-90 transition-opacity"
            />
          </a>
          <div className="flex gap-1 flex-wrap mt-3">
            <Link
              href={`/content?tab=publish&imageUrl=${encodeURIComponent(`/api/images/${data.rebrandedImageId}`)}`}
              className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-[10px] text-violet-200 hover:bg-violet-500/15 inline-flex items-center gap-1"
            >
              <Send className="h-3 w-3" /> publish
            </Link>
            <Link
              href={`/chat?prompt=${encodeURIComponent(`Caption this image at /api/images/${data.rebrandedImageId} for Instagram. Use Nick's Tire voice + Cleveland tags + CTA.`)}`}
              className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200 hover:bg-emerald-500/15 inline-flex items-center gap-1"
            >
              <ImageIcon className="h-3 w-3" /> caption
            </Link>
          </div>
          <div className="mt-2 text-[10px] text-zinc-500 tabular-nums">
            {data.rebrandModel} · {data.rebrandDurationMs}ms
          </div>
        </Panel>
      )}

      {data && (
        <p className="text-center text-[10px] text-zinc-600">
          analysis: {data.analysisModel} · {data.analysisDurationMs}ms
          {data.rebrandedImageUrl && ` · rebrand: ${data.rebrandModel} · ${data.rebrandDurationMs}ms`}
        </p>
      )}
    </StandardPage>
  );
}
