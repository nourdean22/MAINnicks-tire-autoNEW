import { useEffect, useState } from "react";
import { CheckCircle2, Database, Image as ImageIcon, KeyRound, Loader2, RefreshCw, Save, Server, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

function StatusCard({ label, ok, detail, icon: Icon }: { label: string; ok: boolean; detail: string; icon: typeof Server }) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <div className={`rounded-lg p-2 ${ok ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}><Icon className="h-5 w-5" /></div>
        <div><div className="flex items-center gap-2"><span className="font-semibold">{label}</span><Badge variant="outline" className={ok ? "border-emerald-500/40 text-emerald-400" : "border-red-500/40 text-red-400"}>{ok ? "READY" : "NEEDS ATTENTION"}</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p></div>
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

  const metaReady = Boolean(connection.data?.configured && (connection.data?.facebookReady || connection.data?.instagramReady));
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
        <StatusCard label="Meta connection" ok={metaReady} detail={metaReady ? "Facebook or Instagram Graph access is configured." : "Meta identifiers or access token are incomplete."} icon={Server} />
        <StatusCard label="Access token" ok={tokenReady} detail={tokenReady ? "A persisted token is present. Its raw value is hidden." : "No persisted Meta access token is available."} icon={KeyRound} />
        <StatusCard label="Permanent media" ok={storageReady} detail={storageReady ? "S3 and CloudFront are configured for Meta-readable permanent URLs." : "S3_BUCKET and CLOUDFRONT_DOMAIN must both be configured."} icon={Database} />
        <StatusCard label="Media generation" ok={generatorReady} detail={generatorReady ? "The configured media provider has credentials." : "The Reel/media generation provider is not fully configured."} icon={ImageIcon} />
      </div>

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
