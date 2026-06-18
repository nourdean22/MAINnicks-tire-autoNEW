// ─── IG + FB AUTOPOST PANEL ───────────────────────────────
// Fires the autonomous content brain (server/services/igAutopost.ts).
// Default behavior is DRYRUN (Telegram preview, nothing posted) unless
// IG_AUTOPOST_DRYRUN=false on the server. iOS-PWA-safe: confirmDialog +
// toast, never window.confirm/alert/prompt.

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Instagram, Sparkles } from "lucide-react";
import { confirmDialog } from "@/components/admin/ConfirmDialog";

const IG_ARCHETYPES = [
  { id: undefined, label: "Auto (let the brain pick)" },
  { id: "proof" as const, label: "Customer outcome" },
  { id: "anti" as const, label: "Anti-promise" },
  { id: "math" as const, label: "Math-as-argument" },
  { id: "seasonal" as const, label: "Cleveland season" },
  { id: "question" as const, label: "Most-asked question" },
  { id: "process" as const, label: "Process transparency" },
];

type IgArchetypeId = "proof" | "anti" | "math" | "seasonal" | "question" | "process";

export default function IgAutopostPanel() {
  const utils = trpc.useUtils();
  const { data: status } = trpc.nickActions.socialStatus.useQuery(undefined, { staleTime: 60_000 });
  const { data: flags } = trpc.featureFlags.list.useQuery();
  const [archetype, setArchetype] = useState<IgArchetypeId | undefined>(undefined);

  const toggleMut = trpc.featureFlags.toggle.useMutation({
    onSuccess: () => {
      utils.featureFlags.list.invalidate();
      toast.success("Autopost mode updated successfully");
    },
    onError: (err) => toast.error("Failed to toggle autopost mode: " + err.message),
  });

  const fire = trpc.nickActions.fireIgAutopostNow.useMutation({
    onSuccess: (r) => {
      if (r.status === "dryrun") {
        toast.success(`Dry-run done — preview sent to Telegram (no post). Angle: ${r.archetype ?? "auto"} · score ${r.overall ?? "?"}`);
      } else if (r.status === "posted") {
        toast.success(`Posted live — IG:${r.igPostId ? "ok" : "—"} FB:${r.fbPostId ? "ok" : "—"} · angle ${r.archetype ?? "auto"}`);
      } else if (r.status === "aborted") {
        toast.error(`Aborted — no draft cleared the eval gate. ${r.details}`);
      } else {
        toast.error(`Did not post — ${r.details}`);
      }
    },
    onError: (err: { message: string }) => toast.error("Fire failed: " + err.message),
  });

  const igReady = status?.instagramReady ?? false;
  const fbReady = status?.facebookReady ?? false;
  const legacyLive = flags?.find((f) => f.key === "legacy_autopost_live")?.value ?? false;

  const onFire = async () => {
    const label = IG_ARCHETYPES.find((a) => a.id === archetype)?.label ?? "Auto";
    const ok = await confirmDialog({
      title: legacyLive ? "Fire an IG + FB post now?" : "Run dry-run preview now?",
      message: legacyLive
        ? `Angle: ${label}.\n\n` +
          `The server decides live-vs-preview from IG_AUTOPOST_DRYRUN. ` +
          `If dry-run is on (default), this only sends a Telegram preview — nothing is published. ` +
          `If dry-run is off, this posts to the live Instagram + Facebook accounts.`
        : `Angle: ${label}.\n\n` +
          `This will run a dry-run preview of the legacy autonomous poster.\n\n` +
          `It will generate the content, run it through the eval gates, and send a preview to Telegram. ` +
          `No live publishing will occur because legacy autopost is in dry-run only mode.`,
      confirmLabel: legacyLive ? "Generate now" : "Run Preview",
      tone: "default",
    });
    if (ok) fire.mutate({ forceArchetype: archetype });
  };

  return (
    <div className="bg-card border border-pink-500/30 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Instagram className="w-4 h-4 text-pink-400" />
          <h3 className="font-bold text-sm text-foreground tracking-wide">
            {legacyLive ? "IG + FB AUTOPOST" : "Legacy IG/FB Autopost"}
          </h3>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-[10px] uppercase font-bold tracking-wider text-foreground/50">Automation Mode:</span>
            <button
              onClick={async () => {
                const targetState = !legacyLive;
                const ok = await confirmDialog({
                  title: targetState ? "Enable Live Autoposting?" : "Switch to Dry-run only?",
                  message: targetState 
                    ? "Warning: The autonomous poster will publish content directly to Instagram and Facebook live feeds 3x a day if the eval score clears the gate."
                    : "Autopost will only generate drafts and send previews to Telegram. Live publishing will be disabled.",
                  confirmLabel: targetState ? "Enable Live" : "Switch to Dry-run",
                  tone: targetState ? "danger" : "default",
                });
                if (ok) {
                  toggleMut.mutate({ key: "legacy_autopost_live", value: targetState });
                }
              }}
              disabled={toggleMut.isPending}
              className={`px-2.5 py-1 text-[10px] font-bold rounded border transition-colors ${
                legacyLive 
                  ? "bg-pink-500/15 text-pink-400 border-pink-500/35 hover:bg-pink-500/25" 
                  : "bg-neutral-800 text-foreground/60 border-border/30 hover:text-foreground"
              }`}
            >
              {toggleMut.isPending ? "Updating..." : legacyLive ? "LIVE" : "DRY-RUN"}
            </button>
          </div>

          <div className="flex items-center gap-2 text-[10px] font-medium tracking-[0.12em]">
            <span className={`px-2 py-0.5 rounded ${igReady ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
              IG {igReady ? "READY" : "OFFLINE"}
            </span>
            <span className={`px-2 py-0.5 rounded ${fbReady ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
              FB {fbReady ? "READY" : "OFFLINE"}
            </span>
          </div>
        </div>
      </div>

      <p className="text-foreground/50 text-[11px] leading-relaxed max-w-2xl">
        {legacyLive ? (
          <>
            Auto-generates a source-grounded post (your reviews, declined work, top customer questions, season) 3× a day,
            scores it against a dual eval gate, and posts only if it clears the bar. Runs in dry-run by default — it sends a
            Telegram preview and posts nothing until <span className="font-mono">IG_AUTOPOST_DRYRUN=false</span> is set on the server.
          </>
        ) : (
          <>
            Older autopost workflow. Use Carousel Studio or Faceless Reel Studio for new content.
          </>
        )}
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-[10px] font-bold tracking-[0.15em] uppercase text-foreground/50">Angle</label>
        <select
          value={archetype ?? ""}
          onChange={(e) => setArchetype((e.target.value || undefined) as IgArchetypeId | undefined)}
          className="bg-background border border-border/30 text-foreground text-[11px] px-2 py-1.5 rounded"
        >
          {IG_ARCHETYPES.map((a) => (
            <option key={a.label} value={a.id ?? ""}>{a.label}</option>
          ))}
        </select>
        <button
          onClick={onFire}
          disabled={fire.isPending}
          className="flex items-center gap-2 bg-pink-500/90 text-white px-4 py-2 font-bold text-xs tracking-wide hover:bg-pink-500 disabled:opacity-50"
        >
          {fire.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {fire.isPending ? "GENERATING..." : legacyLive ? "FIRE IG POST NOW" : "Run Dry-Run Preview"}
        </button>
      </div>

      {legacyLive && !igReady && !fbReady && (
        <p className="text-[10px] text-amber-400/80">
          Connect Meta first (set the page token + IG user id) so posting can go live. The brain still dry-runs without it.
        </p>
      )}
    </div>
  );
}
