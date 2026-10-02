"use client";

/**
 * PublishTab · the Publish section of the merged /content surface (Wave 2).
 *
 * Moved verbatim from the former app/(mastery)/social/page.tsx — the only
 * changes are: the outer <StandardPage> wrapper became a fragment (the
 * page-level chrome now lives on /content), the former StandardPage
 * `description` moved to an inline header, the former rhythm="comfortable"
 * spacing is preserved via a `space-y-4` wrapper, and the Suspense wrapper
 * was dropped (PageTabs already mounts tab content inside its own Suspense
 * boundary, which covers useSearchParams). Direct IG/FB publish + Buffer
 * scheduling, the connection ribbon, image picker, and the explicit-confirm
 * safety gates are unchanged.
 *
 * URL pre-fill bridge (now under /content?tab=publish):
 *   ?caption=… &imageUrl=… &platforms=instagram,facebook
 * The Drafts tab "Schedule →" deep-links here with ?caption=. Every publish/
 * schedule still requires an explicit confirm — this is the safe surface for
 * irreversible actions.
 */

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Panel } from "@/components/panel";
import { cn } from "@/lib/utils/cn";
import { Send, Calendar, Loader2, CheckCircle, AlertCircle, Image as ImageIcon, Globe, Video } from "lucide-react";

// misc-pages slice (2026-05-22) · the two mount reads + the publish /
// schedule actions moved off authedFetch onto trpc.operator.* —
// socialSchedule / socialRecentImages (queries) and socialPublish /
// scheduleSocialPost (mutations).
import { trpc } from "@/lib/trpc/client";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
interface BufferProfile {
  id: string;
  service: string;
  formatted_username: string;
  default: boolean;
}

interface BufferConnection {
  ok: boolean;
  email?: string;
  plan?: string;
  profileCount?: number;
  error?: string;
}

interface PublishResult {
  ok: boolean;
  platform: "instagram" | "facebook";
  postId?: string;
  permalink?: string;
  error?: string;
}

export function PublishTab() {
  // v10.0.265 · pre-fill from URL params · ?caption=... &imageUrl=...
  // &platforms=instagram,facebook  Defaults preserved when params are
  // missing so direct visits still work.
  const searchParams = useSearchParams();
  // iOS-PWA-safe confirm · window.confirm() is silently suppressed in
  // standalone mode · these are irreversible publish/schedule actions.
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const initialCaption = searchParams?.get("caption") ?? "";
  const initialImageUrl = searchParams?.get("imageUrl") ?? "";
  const platformsParam = searchParams?.get("platforms");
  const initialPlatforms = (() => {
    if (!platformsParam) return { instagram: true, facebook: true };
    const ps = platformsParam.split(",").map((s) => s.trim().toLowerCase());
    return {
      instagram: ps.includes("instagram") || ps.includes("ig"),
      facebook: ps.includes("facebook") || ps.includes("fb"),
    };
  })();

  const [caption, setCaption] = useState(initialCaption);
  const [imageUrl, setImageUrl] = useState(initialImageUrl);
  const [videoUrl, setVideoUrl] = useState("");
  const [platforms, setPlatforms] = useState(initialPlatforms);
  const [scheduleMode, setScheduleMode] = useState<"now" | "next-slot" | "datetime">("next-slot");
  const [scheduledAt, setScheduledAt] = useState("");
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [results, setResults] = useState<PublishResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Buffer connection + profiles · the legacy mount fetch is now a
  // query. A failure stays silent (UI shows "not connected") — that
  // matches the legacy try/catch that swallowed errors.
  const scheduleQuery = trpc.operator.socialSchedule.useQuery();
  const bufferConn: BufferConnection | null =
    scheduleQuery.data?.connection ?? null;
  const profiles: BufferProfile[] = scheduleQuery.data?.profiles ?? [];

  // Recent generated images for the picker.
  const recentImagesQuery = trpc.operator.socialRecentImages.useQuery();
  // D13 · `url` is server-minted (signed when IMAGES_REQUIRE_SIGNATURE=1).
  const recentImages: Array<{ id: string; url?: string; detail: string; createdAt: string }> =
    recentImagesQuery.data?.images ?? [];

  // Seed the default profile selection once the profiles land (the
  // legacy fetch set this inside its .then()).
  useEffect(() => {
    if (profiles.length === 0) return;
    setSelectedProfiles(
      profiles.filter((p) => p.default).map((p) => p.id),
    );
  }, [profiles]);

  const publishMutation = trpc.operator.socialPublish.useMutation();
  const scheduleMutation = trpc.operator.scheduleSocialPost.useMutation();

  const charCount = caption.length;
  const charLimit = 2200; // IG max
  const charsLeft = charLimit - charCount;

  const handlePublish = useCallback(async () => {
    setError(null);
    setSuccess(null);
    if (!caption.trim()) {
      setError("Caption is required");
      return;
    }
    const targets = Object.entries(platforms)
      .filter(([_, on]) => on)
      .map(([k]) => k as "instagram" | "facebook");
    if (targets.length === 0) {
      setError("Pick at least one platform");
      return;
    }
    if (targets.includes("instagram") && !imageUrl && !videoUrl) {
      setError("Instagram requires an image or video URL");
      return;
    }
    const ok = await confirm({
      title: `Publish to ${targets.join(" + ")}?`,
      body: "This is irreversible.",
      confirmLabel: "Publish",
      tone: "danger",
    });
    if (!ok) return;
    setPublishing(true);
    try {
      // tRPC surfaces a non-2xx as a thrown error (replacing the
      // v10.0.33 manual res.ok-before-.json() guard).
      const json = await publishMutation.mutateAsync({
        platforms: targets,
        imageUrl: imageUrl || undefined,
        videoUrl: videoUrl || undefined,
        caption,
        message: caption,
      });
      setResults(json.results ?? []);
      if (json.ok) {
        // `queued` means the durable worker has it and Meta has NOT been
        // contacted — saying "Published" here announced an outcome nobody had
        // observed yet.
        setSuccess(
          json.queued
            ? "Queued for publishing — the worker posts it and updates the queue row with the result."
            : `Published to ${json.succeeded} channel${json.succeeded === 1 ? "" : "s"}`,
        );
        setCaption("");
        setImageUrl("");
        setVideoUrl("");
      } else {
        setError(`${json.failed} failed · ${json.succeeded} succeeded`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishing(false);
    }
  }, [caption, imageUrl, videoUrl, platforms, publishMutation, confirm]);

  const handleSchedule = useCallback(async () => {
    setError(null);
    setSuccess(null);
    if (!caption.trim()) {
      setError("Caption is required");
      return;
    }
    if (selectedProfiles.length === 0) {
      setError("Pick at least one Buffer profile");
      return;
    }
    if (scheduleMode === "datetime" && !scheduledAt) {
      setError("Set a date/time for scheduled");
      return;
    }
    const summary = scheduleMode === "now"
      ? "Post NOW via Buffer"
      : scheduleMode === "datetime"
        ? `Schedule for ${scheduledAt}`
        : "Add to Buffer next-available slot";
    const ok = await confirm({
      title: `${summary}?`,
      body: `Will queue ${selectedProfiles.length} update(s).`,
      confirmLabel: "Schedule",
      tone: "danger",
    });
    if (!ok) return;
    setScheduling(true);
    try {
      // tRPC surfaces a non-2xx as a thrown error (same fix as
      // handlePublish above).
      const json = await scheduleMutation.mutateAsync({
        text: caption,
        imageUrl: imageUrl || undefined,
        videoUrl: videoUrl || undefined,
        profileIds: selectedProfiles,
        scheduledAt: scheduleMode === "datetime" ? scheduledAt : undefined,
        shareNow: scheduleMode === "now",
      });
      if (json.ok) {
        setSuccess(`Queued ${json.bufferUpdateIds.length} update(s) for ${json.scheduledFor}`);
        setCaption("");
        setImageUrl("");
        setVideoUrl("");
      } else {
        setError(json.error ?? "Schedule failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScheduling(false);
    }
  }, [caption, imageUrl, videoUrl, selectedProfiles, scheduleMode, scheduledAt, scheduleMutation, confirm]);

  return (
    <>
      <p className="text-sm text-fg-secondary mb-4" style={{ maxWidth: "60ch" }}>
        Direct IG/FB publish + Buffer scheduling. Every action is explicit.
      </p>

      <div className="space-y-4">
        {/* Connection ribbon */}
        <Panel>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-surface border border-edge-subtle bg-content p-2 text-xs">
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">Buffer</div>
              <div className={cn(
                "mt-1 font-mono",
                bufferConn?.ok ? "text-emerald-300" : "text-rose-300",
              )}>
                {bufferConn?.ok ? `connected · ${bufferConn.email} · ${bufferConn.profileCount} profiles` : (bufferConn?.error ?? "checking…")}
              </div>
            </div>
            <div className="rounded-surface border border-edge-subtle bg-content p-2 text-xs">
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">Meta IG</div>
              <div className={cn(
                "mt-1 font-mono",
                scheduleQuery.data?.meta?.instagram === "connected" ? "text-emerald-300" : "text-rose-300"
              )}>
                {scheduleQuery.data?.meta?.instagram ?? "checking…"}
              </div>
            </div>
            <div className="rounded-surface border border-edge-subtle bg-content p-2 text-xs">
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">Meta FB</div>
              <div className={cn(
                "mt-1 font-mono",
                scheduleQuery.data?.meta?.facebook === "connected" ? "text-emerald-300" : "text-rose-300"
              )}>
                {scheduleQuery.data?.meta?.facebook ?? "checking…"}
              </div>
            </div>
          </div>
        </Panel>

        {/* Caption editor */}
        <Panel>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">caption</h2>
            <span className={cn(
              "text-[11px] font-mono tabular-nums transition-colors duration-[var(--motion-state)]",
              charsLeft < 0 ? "text-rose-300" : charsLeft < 200 ? "text-amber-300" : "text-fg-tertiary",
            )}>
              {charCount} / {charLimit}
            </span>
          </div>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Paste or compose your post here…"
            className="w-full h-44 rounded-control border border-edge-default bg-content p-3 text-[13px] text-fg placeholder:text-fg-tertiary outline-none focus:border-accent font-mono"
          />
        </Panel>

        {/* Media Assets picker */}
        <Panel>
          <div className="space-y-4">
            <div>
              <h2 className="mb-2 text-sm font-semibold text-fg flex items-center gap-1">
                <ImageIcon className="h-4 w-4" /> Image URL (required for IG Image post, optional cover for Reels)
              </h2>
              <input
                type="text"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="/api/images/abc123 or https://..."
                className="w-full rounded-control border border-edge-default bg-content px-3 py-1.5 text-[13px] text-fg placeholder:text-fg-tertiary outline-none focus:border-accent font-mono"
              />
            </div>

            <div>
              <h2 className="mb-2 text-sm font-semibold text-fg flex items-center gap-1">
                <Video className="h-4 w-4" /> Video URL (for Instagram Reels) - must be a public HTTPS URL
              </h2>
              <input
                type="text"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-control border border-edge-default bg-content px-3 py-1.5 text-[13px] text-fg placeholder:text-fg-tertiary outline-none focus:border-accent font-mono"
              />
            </div>

            {recentImages.length > 0 && (
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mb-1">recent generated images</div>
                <div className="flex gap-1.5 flex-wrap">
                  {recentImages.slice(0, 8).map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => setImageUrl(img.url ?? `/api/images/${img.id}`)}
                      className={cn(
                        "h-12 w-12 rounded-control border overflow-hidden hover:opacity-80 transition-opacity",
                        imageUrl === (img.url ?? `/api/images/${img.id}`) ? "border-emerald-500" : "border-edge-default",
                      )}
                      title={img.detail.slice(0, 100)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url ?? `/api/images/${img.id}`} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-4">
              {imageUrl && (
                <div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mb-1">Image preview</div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl} alt="preview" className="rounded-control max-h-48 border border-edge-subtle" />
                </div>
              )}
              {videoUrl && (
                <div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mb-1">Video preview</div>
                  <video src={videoUrl} controls className="rounded-control max-h-48 border border-edge-subtle" />
                </div>
              )}
            </div>
          </div>
        </Panel>

        {/* Direct publish */}
        <Panel>
          <h2 className="mb-2 text-sm font-semibold text-fg flex items-center gap-1">
            <Send className="h-4 w-4" /> Direct publish
          </h2>
          {/* v10.0.529.106 · Wave 51 · mobile fix · iOS tap target standard
              is 44pt minimum · prev py-1 gave us ~22pt which is half the
              minimum. min-h-[44px] + larger checkbox sizing on touch
              devices · still compact (text-xs · px-2) so the chip
              aesthetic survives. */}
          <div className="flex gap-2 mb-3 flex-wrap">
            <label
              className={cn(
                "flex items-center gap-1.5 text-xs cursor-pointer rounded-control border px-3 min-h-[44px] transition-colors duration-[var(--motion-state)]",
                platforms.instagram
                  ? "border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-200"
                  : "border-edge-default bg-content text-fg-secondary hover:border-edge-strong",
              )}
            >
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-emerald-500"
                checked={platforms.instagram}
                onChange={(e) => setPlatforms((p) => ({ ...p, instagram: e.target.checked }))}
              />
              Instagram
            </label>
            <label
              className={cn(
                "flex items-center gap-1.5 text-xs cursor-pointer rounded-control border px-3 min-h-[44px] transition-colors duration-[var(--motion-state)]",
                platforms.facebook
                  ? "border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-200"
                  : "border-edge-default bg-content text-fg-secondary hover:border-edge-strong",
              )}
            >
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-emerald-500"
                checked={platforms.facebook}
                onChange={(e) => setPlatforms((p) => ({ ...p, facebook: e.target.checked }))}
              />
              Facebook Page
            </label>
          </div>
          <button
            type="button"
            onClick={handlePublish}
            disabled={publishing || !caption.trim()}
            className={cn(
              "rounded-control border px-4 py-2 text-[13px] font-medium transition-colors duration-[var(--motion-state)] w-full sm:w-auto",
              publishing
                ? "border-amber-500/40 bg-amber-500/10 text-amber-200 cursor-wait"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-50",
            )}
          >
            {publishing ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Publishing…
              </span>
            ) : "Publish now"}
          </button>
        </Panel>

        {/* Buffer schedule */}
        {bufferConn?.ok && (
          <Panel>
            <h2 className="mb-2 text-sm font-semibold text-fg flex items-center gap-1">
              <Calendar className="h-4 w-4" /> Schedule via Buffer
            </h2>
            <div className="space-y-2">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mb-1">when</div>
                <div className="flex gap-1 flex-wrap">
                  {(["now", "next-slot", "datetime"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setScheduleMode(m)}
                      className={cn(
                        "rounded-control px-2 py-1 text-[12px] font-medium transition-colors duration-[var(--motion-state)]",
                        scheduleMode === m ? "bg-accent-soft text-fg" : "bg-surface-interactive text-fg-tertiary hover:bg-surface-hover hover:text-fg-secondary",
                      )}
                    >
                      {m === "now" ? "post now" : m === "next-slot" ? "Next slot" : "Specific time"}
                    </button>
                  ))}
                </div>
                {scheduleMode === "datetime" && (
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="mt-2 rounded-control border border-edge-default bg-content px-2 py-1 text-[13px] text-fg focus:border-accent focus:outline-none"
                  />
                )}
              </div>
              {profiles.length > 0 && (
                <div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mb-1">channels</div>
                  <div className="flex gap-1 flex-wrap">
                    {profiles.map((p) => (
                      <label
                        key={p.id}
                        className="flex items-center gap-1.5 text-xs px-3 min-h-[44px] rounded-control border border-edge-default cursor-pointer hover:bg-surface-hover"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-sky-500"
                          checked={selectedProfiles.includes(p.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedProfiles((arr) => [...arr, p.id]);
                            } else {
                              setSelectedProfiles((arr) => arr.filter((x) => x !== p.id));
                            }
                          }}
                        />
                        <span className="font-mono text-[11px]">{p.service} · {p.formatted_username}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={handleSchedule}
                disabled={scheduling || !caption.trim()}
                className={cn(
                  "rounded-control border px-4 py-2 text-[13px] font-medium transition-colors duration-[var(--motion-state)] w-full sm:w-auto",
                  scheduling
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-200 cursor-wait"
                    : "border-sky-500/40 bg-sky-500/10 text-sky-200 hover:bg-sky-500/15 disabled:opacity-50",
                )}
              >
                {scheduling ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Scheduling…
                  </span>
                ) : "Schedule via Buffer"}
              </button>
            </div>
          </Panel>
        )}

        {/* Status */}
        {error && (
          <Panel className="border-rose-500/40 bg-rose-500/10">
            <div className="flex items-center gap-2 p-3 text-sm text-rose-200">
              <AlertCircle className="h-4 w-4" /> {error}
            </div>
          </Panel>
        )}
        {success && (
          <Panel className="border-emerald-500/40 bg-emerald-500/10">
            <div className="flex items-center gap-2 p-3 text-sm text-emerald-200">
              <CheckCircle className="h-4 w-4" /> {success}
            </div>
          </Panel>
        )}

        {/* Results log */}
        {results.length > 0 && (
          <Panel>
            <h2 className="mb-2 text-sm font-semibold text-fg">last publish</h2>
            <div className="space-y-1">
              {results.map((r, idx) => (
                <div
                  key={`${r.platform}-${idx}`}
                  className={cn(
                    "rounded-control border px-2 py-1.5 text-xs flex items-center justify-between",
                    r.ok
                      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-200"
                      : "border-rose-500/30 bg-rose-500/5 text-rose-200",
                  )}
                >
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em]">{r.platform}</span>
                  {r.ok && r.permalink ? (
                    <a href={r.permalink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:underline">
                      <Globe className="h-3 w-3" /> View post
                    </a>
                  ) : (
                    <span className="font-mono text-[11px]">{r.error ?? r.postId ?? "—"}</span>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        )}
        {/* iOS-PWA-safe confirm mount · renders null when idle. */}
        {confirmDialog}
      </div>
    </>
  );
}
