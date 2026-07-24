import { useEffect, useState } from "react";
import { CheckCircle2, Database, Image as ImageIcon, KeyRound, Loader2, RefreshCw, Save, Server, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

/**
 * THREE STATES, NEVER TWO — same rule HQ's Meta card already follows. "We
 * could not verify" is neither READY nor NEEDS ATTENTION: forcing it into
 * either lies in one direction or the other (a two-state card here showed a
 * revoked-token UNKNOWN as green READY).
 */
type HealthState = "ready" | "attention" | "unknown";
const STATE_STYLE: Record<HealthState, { chip: string; badge: string; label: string }> = {
  ready: { chip: "bg-emerald-500/10 text-emerald-400", badge: "border-emerald-500/40 text-emerald-400", label: "READY" },
  attention: { chip: "bg-red-500/10 text-red-400", badge: "border-red-500/40 text-red-400", label: "NEEDS ATTENTION" },
  unknown: { chip: "bg-amber-500/10 text-amber-400", badge: "border-amber-500/40 text-amber-400", label: "UNVERIFIED" },
};

function StatusCard({ label, state, detail, icon: Icon }: { label: string; state: HealthState; detail: string; icon: typeof Server }) {
  const style = STATE_STYLE[state];
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <div className={`rounded-lg p-2 ${style.chip}`}><Icon className="h-5 w-5" /></div>
        <div><div className="flex items-center gap-2"><span className="font-semibold">{label}</span><Badge variant="outline" className={style.badge}>{style.label}</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p></div>
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const utils = trpc.useUtils();
  const connection = trpc.instagramAdmin.getConnectionStatus.useQuery();
  const health = trpc.instagramAdmin.getPipelineHealth.useQuery();
  const config = trpc.instagramAdmin.getMetaConfig.useQuery();
  const [appId, setAppId] = useState("");
  const [pageId, setPageId] = useState("");
  const [igUserId, setIgUserId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [imageProvider, setImageProvider] = useState<"openai" | "gemini" | "higgsfield">("gemini");
  const [higgsfieldCredentialsJson, setHiggsfieldCredentialsJson] = useState("");

  useEffect(() => {
    if (!config.data) return;
    setAppId(config.data.appId || "");
    setPageId(config.data.pageId || "");
    setIgUserId(config.data.igUserId || "");
    const provider = config.data.imageProvider;
    setImageProvider(provider === "openai" || provider === "higgsfield" ? provider : "gemini");
  }, [config.data]);

  const update = trpc.instagramAdmin.updateMetaConfig.useMutation({
    onSuccess: async () => {
      setAppSecret("");
      setHiggsfieldCredentialsJson("");
      await Promise.all([
        utils.instagramAdmin.getMetaConfig.invalidate(),
        utils.instagramAdmin.getConnectionStatus.invalidate(),
        utils.instagramAdmin.getPipelineHealth.invalidate(),
      ]);
      toast.success("Instagram configuration saved");
    },
    onError: (error) => toast.error("Configuration failed", { description: error.message }),
  });

  const refresh = async () => {
    await Promise.all([connection.refetch(), health.refetch(), config.refetch()]);
    toast.success("Health status refreshed");
  };

  const isLoading = connection.isLoading || health.isLoading || config.isLoading;
  if (isLoading) return <div className="flex min-h-96 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  // "Configured" (presence), "alive" (Graph accepted the token just now), and
  // "could not ask" are THREE different facts. `live?.ok !== false` previously
  // rendered the unknown case as READY — the exact defect this card's comment
  // said it fixed.
  const live = connection.data?.live;
  const metaConfigured = Boolean(connection.data?.configured && (connection.data?.facebookReady || connection.data?.instagramReady));
  const metaState: HealthState = !metaConfigured
    ? "attention"
    : live?.ok === true
      ? "ready"
      : live?.ok === false && !live?.unknown
        ? "attention"
        : "unknown";
  const metaDetail = !metaConfigured
    ? "Meta identifiers or access token are incomplete."
    : live?.ok === true
      ? `Live check passed${live.igUsername ? ` as @${live.igUsername}` : ""}${live.pageName ? ` · Page "${live.pageName}"` : ""}.`
      : live?.unknown
        ? `Configured, but Meta could not be reached to verify: ${live.error ?? "transport error"}. This is unknown, not a dead token.`
        : live?.ok === false
          ? `Configured, but the Graph API rejected the token: ${live.error ?? "unknown error"}`
          : "Configured — no live verification result is available yet.";
  const tokenReady = Boolean(connection.data?.token?.present);
  const storageReady = Boolean(health.data?.storage?.configured && health.data?.storage?.permanentUrls);
  const generatorReady = Boolean(health.data?.generator?.configured);

  return (
    <div className="space-y-7 pb-12">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><h3 className="text-2xl font-bold">Instagram Configuration</h3><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Connection state, permanent media hosting, generation providers, and Meta identifiers in one place. Existing secrets are never displayed.</p></div>
        <Button variant="outline" onClick={refresh}><RefreshCw className="mr-2 h-4 w-4" /> Refresh health</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatusCard label="Meta connection" state={metaState} detail={metaDetail} icon={Server} />
        <StatusCard label="Access token" state={tokenReady ? "ready" : "attention"} detail={tokenReady ? "A persisted token is present. Its raw value is hidden." : "No persisted Meta access token is available."} icon={KeyRound} />
        <StatusCard label="Permanent media" state={storageReady ? "ready" : "attention"} detail={storageReady ? "S3 and CloudFront are configured for Meta-readable permanent URLs." : "S3_BUCKET and CLOUDFRONT_DOMAIN must both be configured."} icon={Database} />
        <StatusCard label="Media generation" state={generatorReady ? "ready" : "attention"} detail={generatorReady ? "The configured media provider has credentials." : "The Reel/media generation provider is not fully configured."} icon={ImageIcon} />
      </div>

      {/* null means the count FAILED, and `?? 0` turned that into an all-clear —
          the banner simply never rendered. A held-reel count that cannot be read
          is exactly when the operator most needs to know. */}
      {health.data?.failedJobs === null && (
        <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" /><div><strong>Unable to determine held Reel jobs.</strong><div className="mt-1 text-xs text-amber-200/70">This is not zero — the count could not be read. Do not enable autonomous publishing on this reading.</div></div></div>
      )}

      {(health.data?.failedJobs ?? 0) > 0 && (
        <div className="flex gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" /><div><strong>{health.data?.failedJobs} failed Reel job(s).</strong><div className="mt-1 text-xs text-red-200/70">Review the Reel queue before enabling any autonomous publishing.</div></div></div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Meta IDs</CardTitle><CardDescription>Database overrides take precedence over environment defaults.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1"><label className="text-xs font-semibold uppercase text-muted-foreground">Meta App ID</label><Input value={appId} onChange={(event) => setAppId(event.target.value)} /></div>
            <div className="space-y-1"><label className="text-xs font-semibold uppercase text-muted-foreground">Facebook Page ID</label><Input value={pageId} onChange={(event) => setPageId(event.target.value)} /></div>
            <div className="space-y-1"><label className="text-xs font-semibold uppercase text-muted-foreground">Instagram Business User ID</label><Input value={igUserId} onChange={(event) => setIgUserId(event.target.value)} /></div>
            <div className="space-y-1"><label className="text-xs font-semibold uppercase text-muted-foreground">Replace App Secret</label><Input type="password" value={appSecret} onChange={(event) => setAppSecret(event.target.value)} placeholder={config.data?.hasSecret ? "Secret already stored — leave blank to keep it" : "Enter Meta app secret"} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Generation Provider</CardTitle><CardDescription>Studio V2 static cards render deterministically. This provider remains available for autonomous imagery and Reel assets.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1"><label className="text-xs font-semibold uppercase text-muted-foreground">Image provider</label><select value={imageProvider} onChange={(event) => setImageProvider(event.target.value as typeof imageProvider)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="gemini">Gemini</option><option value="openai">OpenAI-compatible</option><option value="higgsfield">Higgsfield</option></select></div>
            <div className="space-y-1"><label className="text-xs font-semibold uppercase text-muted-foreground">Replace Higgsfield credentials JSON</label><Textarea value={higgsfieldCredentialsJson} onChange={(event) => setHiggsfieldCredentialsJson(event.target.value)} className="min-h-40 font-mono text-xs" placeholder={config.data?.hasHiggsfieldCreds ? "Credentials already stored — leave blank to keep them" : "Paste credentials JSON only when rotating credentials"} /></div>
            <div className="rounded-lg border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground"><CheckCircle2 className="mr-2 inline h-4 w-4 text-emerald-400" />Studio V2 post, ad, carousel, and Story layouts do not depend on generative text rendering, preventing the garbled lettering shown in the old poster.</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button disabled={update.isPending || !appId.trim() || !pageId.trim() || !igUserId.trim()} onClick={() => update.mutate({
          appId: appId.trim(),
          pageId: pageId.trim(),
          igUserId: igUserId.trim(),
          appSecret: appSecret.trim() || undefined,
          imageProvider,
          higgsfieldCredentialsJson: higgsfieldCredentialsJson.trim() || undefined,
        })}>{update.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save configuration</Button>
      </div>
    </div>
  );
}
