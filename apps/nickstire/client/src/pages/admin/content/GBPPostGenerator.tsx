/**
 * GBPPostGenerator — Google Business Profile post generator (4 archetypes).
 *
 * Extracted from ContentSection.tsx (1,515 lines) in the 2026-07-04
 * maintainability split — pure mechanical move, mirrors the ./today/
 * and ./customers/ extraction precedent. No behavior change.
 */
import React, { useState } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { toast } from "sonner";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { StatusDot, formatDate } from "../shared";
import { Loader2, Sparkles, Target, Zap, AlertTriangle, ShieldCheck, Settings, Link2, Copy, Check } from "lucide-react";

type Archetype = "proof" | "anti" | "math" | "seasonal";
type GBPPostResult = RouterOutputs["contentAdmin"]["generateGBPPost"];
type GBPHistoryRow = RouterOutputs["contentAdmin"]["gbpPostHistory"][number];

const ARCHETYPE_LABELS: Record<Archetype | "auto", string> = {
  auto: "AUTO",
  proof: "PROOF",
  anti: "ANTI",
  math: "MATH",
  seasonal: "SEASONAL",
};

export function GBPPostGenerator() {
  const [result, setResult] = useState<GBPPostResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPublishingDirectly, setIsPublishingDirectly] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [authUrlLoading, setAuthUrlLoading] = useState(false);

  const utils = trpc.useUtils();
  const { data: history } = trpc.contentAdmin.gbpPostHistory.useQuery();

  // New GBP tRPC endpoints
  const { data: authStatus, isLoading: authStatusLoading } = trpc.gbp.getAuthStatus.useQuery();
  const { data: locationsRes } = trpc.gbp.listLocations.useQuery(
    { accountName: authStatus?.accountId || "" },
    { enabled: !!authStatus?.connected && !!authStatus?.accountId }
  );

  const saveLocationMutation = trpc.gbp.saveLocation.useMutation({
    onSuccess: () => {
      toast.success("GBP location selection saved");
      void utils.gbp.getAuthStatus.invalidate();
    },
    onError: (err: any) => toast.error(`Failed to save location: ${err.message}`)
  });

  const publishDirectlyMutation = trpc.gbp.publishPost.useMutation({
    onSuccess: () => {
      setIsPublishingDirectly(false);
      toast.success("Successfully published to Google Business Profile!");
      void utils.contentAdmin.gbpPostHistory.invalidate();
    },
    onError: (err: any) => {
      setIsPublishingDirectly(false);
      toast.error(`Publishing Failed: ${err.message}`);
    }
  });

  // The OAuth code-exchange effect that used to live here moved to
  // GbpOAuthCatcher (mounted in the Admin shell): this component only mounts
  // inside the GBP sub-tab, so redirects landing on any other tab silently
  // expired the single-use code.

  const generate = trpc.contentAdmin.generateGBPPost.useMutation({
    onSuccess: (data) => {
      setResult(data);
      setCopied(false);
      void utils.contentAdmin.gbpPostHistory.invalidate();
      toast.success(`Generated ${data.archetype.toUpperCase()} post`);
    },
    onError: (err: { message: string }) => toast.error("Failed: " + err.message),
  });

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.text).then(() => {
      setCopied(true);
      toast.success("Post copied");
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => toast.error("Copy failed"));
  };

  const handleConnect = async () => {
    setAuthUrlLoading(true);
    try {
      const redirectUri = `${window.location.origin}/admin`;
      const res = await utils.client.gbp.getAuthUrl.query({ redirectUri });
      if (res && res.url) {
        window.location.href = res.url;
      } else {
        throw new Error("No URL returned from Google API client provider");
      }
    } catch (err: any) {
      toast.error(`Authentication generation failed: ${err.message}`);
    } finally {
      setAuthUrlLoading(false);
    }
  };

  const handleSaveLocation = () => {
    if (!selectedAccountId || !selectedLocationId) {
      toast.error("Please select both account and location");
      return;
    }
    saveLocationMutation.mutate({
      accountId: selectedAccountId,
      locationId: selectedLocationId
    });
  };

  const handlePublishDirectly = async () => {
    if (!result) return;

    if (!authStatus?.locationConfigured) {
      toast.error("Stated location must be configured prior to live publishing");
      return;
    }

    const confirmed = await confirmDialog({
      title: "Publish LIVE to Google?",
      message: "WARNING: This will instantly create a live post on your Google Business Profile page. Ensure all details are accurate.",
      confirmLabel: "Publish Live",
      tone: "danger"
    });

    if (!confirmed) return;

    setIsPublishingDirectly(true);

    let ctaType: any = undefined;
    if (result.callToAction) {
      const formattedCta = result.callToAction.toUpperCase().replace(/\s+/g, "_");
      if (["BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP", "CALL"].includes(formattedCta)) {
        ctaType = formattedCta;
      } else {
        ctaType = "LEARN_MORE";
      }
    }

    publishDirectlyMutation.mutate({
      summary: result.text,
      ctaType,
      ctaUrl: result.ctaUrl || undefined
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* LEFT PANEL: Connection settings */}
      <div className="bg-card border border-border/30 p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Settings className="w-5 h-5 text-primary" />
          <div>
            <h4 className="font-bold text-sm text-foreground tracking-wider uppercase">Google Connection Config</h4>
            <p className="text-[11px] text-foreground/40">Secure OAuth 2.0 API connection registry</p>
          </div>
        </div>

        {authStatusLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-4 text-xs">
            {/* Connection Status */}
            <div className="p-3 border border-border/30 bg-background/30 rounded flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusDot status={authStatus?.connected ? "completed" : "lost"} />
                <span className="font-bold uppercase tracking-wider">
                  {authStatus?.connected ? "Connected" : "Disconnected"}
                </span>
              </div>
              {authStatus?.connected ? (
                <span className="text-[10px] text-foreground/40 font-mono">
                  Client ID: {authStatus.clientIdFingerprint}
                </span>
              ) : (
                <button
                  onClick={handleConnect}
                  disabled={authUrlLoading}
                  className="flex items-center gap-1 bg-primary text-primary-foreground px-3 py-1 font-bold text-[10px] tracking-wider hover:bg-primary/95 transition-colors disabled:opacity-50"
                >
                  {authUrlLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                  CONNECT GBP
                </button>
              )}
            </div>

            {/* Account & Location Selection */}
            {authStatus?.connected && (
              <div className="space-y-3 p-4 border border-border/30 bg-background/25 rounded">
                <p className="font-bold uppercase tracking-wide text-foreground/50 text-[10px]">GBP Location Targets</p>

                {authStatus?.accountId ? (
                  <div className="space-y-1">
                    <span className="text-[10px] text-foreground/40">Active Account Name:</span>
                    <div className="font-mono bg-background/50 border border-border/20 p-2 rounded text-[11px] truncate">
                      {authStatus.accountId}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <span className="text-[10px] text-foreground/40">Account Name:</span>
                    <input
                      type="text"
                      placeholder="e.g., accounts/123456"
                      value={selectedAccountId}
                      onChange={(e) => setSelectedAccountId(e.target.value)}
                      className="w-full bg-background border border-border/40 text-foreground px-2 py-1.5 text-xs focus:outline-none"
                    />
                  </div>
                )}

                {authStatus?.locationId ? (
                  <div className="space-y-1">
                    <span className="text-[10px] text-foreground/40">Active Location ID:</span>
                    <div className="font-mono bg-background/50 border border-border/20 p-2 rounded text-[11px] truncate">
                      {authStatus.locationId}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <span className="text-[10px] text-foreground/40">Select Location Target:</span>
                      {locationsRes?.locations && locationsRes.locations.length > 0 ? (
                        <select
                          value={selectedLocationId}
                          onChange={(e) => setSelectedLocationId(e.target.value)}
                          className="w-full bg-background border border-border/40 text-foreground px-2 py-1.5 text-xs focus:outline-none"
                        >
                          <option value="">-- Choose GMB Location --</option>
                          {locationsRes.locations.map((loc: any) => (
                            <option key={loc.name} value={loc.name}>
                              {loc.title} ({loc.name})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          placeholder="e.g., locations/78910"
                          value={selectedLocationId}
                          onChange={(e) => setSelectedLocationId(e.target.value)}
                          className="w-full bg-background border border-border/40 text-foreground px-2 py-1.5 text-xs focus:outline-none"
                        />
                      )}
                    </div>
                    {(!authStatus?.accountId || !authStatus?.locationId) && (
                      <button
                        onClick={handleSaveLocation}
                        disabled={saveLocationMutation.isPending}
                        className="flex items-center gap-1 border border-primary text-primary px-3 py-1 font-bold text-[10px] tracking-wider hover:bg-primary/10 transition-colors"
                      >
                        {saveLocationMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        SAVE SELECTION
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Security Notice */}
            <div className="p-3 bg-background/40 border border-border/20 rounded space-y-1.5 text-[11px] text-foreground/60 leading-relaxed">
              <span className="font-bold flex items-center gap-1 text-foreground/80">
                <ShieldCheck className="w-3.5 h-3.5 text-primary" /> Connection Security Gating
              </span>
              <p>
                Credentials and access tokens are secured under standard database schemas on the Express server and refreshed automatically. No access tokens are sent to client dashboards.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT PANEL: Generator and Publisher */}
      <div className="bg-card border border-border/30 p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Target className="w-5 h-5 text-primary" />
            <div>
              <p className="font-bold text-sm text-foreground tracking-wider uppercase">GBP POST GENERATOR</p>
              <p className="text-[12px] text-foreground/40">Voice-graded post compiler & direct publisher</p>
            </div>
          </div>
        </div>

        {/* Safety warning */}
        <div className="p-3 border border-yellow-500/30 bg-yellow-500/5 text-yellow-600 dark:text-yellow-400 text-xs rounded space-y-1">
          <p className="font-bold flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> Google Business Profile Copy-Paste Safety Gate
          </p>
          <p>
            Generated posts default to dry-run previews. Manually review content details before pasting or executing live publishes. Auto-posting unchecked claims is forbidden.
          </p>
        </div>

        {/* Archetype buttons */}
        <div className="flex flex-wrap gap-2">
          {(["auto", "proof", "anti", "math", "seasonal"] as const).map((a) => (
            <button
              key={a}
              onClick={() => generate.mutate(a === "auto" ? undefined : { forceArchetype: a })}
              disabled={generate.isPending}
              className="flex items-center gap-1.5 border border-border/30 text-foreground/70 px-3 py-1.5 font-bold text-[10px] tracking-wide hover:bg-primary/10 hover:text-primary hover:border-primary/40 disabled:opacity-50"
            >
              {generate.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {ARCHETYPE_LABELS[a]}
            </button>
          ))}
        </div>

        {/* Result panel */}
        {result && (
          <div className="border border-border/30 bg-background/40 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold tracking-wider text-primary">
                ARCHETYPE: {result.archetype.toUpperCase()}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 bg-background border border-border/40 text-foreground/70 px-3 py-1 font-bold text-[10px] tracking-wide hover:bg-foreground/5"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copied ? "COPIED" : "COPY"}
                </button>
                {authStatus?.locationConfigured && (
                  <button
                    onClick={handlePublishDirectly}
                    disabled={isPublishingDirectly || publishDirectlyMutation.isPending}
                    className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1 font-bold text-[10px] tracking-wide hover:bg-primary/95 disabled:opacity-50"
                  >
                    {isPublishingDirectly ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                    {isPublishingDirectly ? "PUBLISHING..." : "PUBLISH LIVE"}
                  </button>
                )}
              </div>
            </div>
            <pre className="whitespace-pre-wrap text-[12px] text-foreground/80 font-mono leading-relaxed">{result.text}</pre>
            <div className="text-[11px] text-foreground/50 space-y-1 border-t border-border/20 pt-2">
              <div><span className="font-bold text-foreground/70">CTA:</span> {result.callToAction}</div>
              <div className="break-all"><span className="font-bold text-foreground/70">URL:</span> {result.ctaUrl}</div>
              <div><span className="font-bold text-foreground/70">IMAGE:</span> {result.imageHint}</div>
            </div>
          </div>
        )}

        {/* Post history (last 14 — variety guard window) */}
        {history && history.length > 0 && (
          <details className="border-t border-border/20 pt-3">
            <summary className="cursor-pointer text-[11px] font-bold tracking-wider text-foreground/50 hover:text-foreground/80">
              POST HISTORY · LAST {history.length} (variety window)
            </summary>
            <div className="mt-2 space-y-1.5">
              {history.map((row: GBPHistoryRow) => {
                const dayLabel = formatDate(row.postedAt);
                const archetypeColor =
                  row.archetype === "proof" ? "text-emerald-400" :
                  row.archetype === "anti" ? "text-amber-400" :
                  row.archetype === "math" ? "text-blue-400" :
                  "text-primary";
                return (
                  <div key={row.id} className="flex items-center gap-3 text-[11px] py-1 border-b border-border/10">
                    <span className="text-foreground/40 w-20 shrink-0">{dayLabel}</span>
                    <span className={`font-bold tracking-wider w-16 shrink-0 ${archetypeColor}`}>{row.archetype.toUpperCase()}</span>
                    <span className="text-foreground/30 text-[10px] w-12 shrink-0">{row.source}</span>
                    <span className="text-foreground/60 truncate flex-1">{row.postBody.split("\n")[0]}</span>
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

// ─── AI IDEAS ENGINE ──────────────────────────────────────
