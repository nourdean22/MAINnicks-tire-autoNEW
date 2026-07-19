import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Loader2, Plus, AlertCircle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface HQProps {
  onNavigate: (tab: string) => void;
}

export function HQ({ onNavigate }: HQProps) {
  const { data: brief, isLoading } = trpc.instagramAdmin.getCreationBrief.useQuery();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-medium">Headquarters</h3>
        <Button onClick={() => onNavigate("studio")} className="gap-2">
          <Plus className="h-4 w-4" />
          Enter Studio
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="col-span-full">
          <CardHeader>
            <CardTitle>Current Creation Brief</CardTitle>
            <CardDescription>Performance-seeded guidance for your next post.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : brief ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">Top Archetype (30d)</span>
                    <p className="text-lg font-semibold capitalize">{brief.topArchetypeLast30Days}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">Optimal Posting Window</span>
                    <p className="text-lg font-semibold">{brief.optimalPostingWindow}</p>
                  </div>
                </div>
                
                <Alert variant="destructive" className="mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Topics to Avoid</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4 mt-2">
                      {brief.topicsToAvoid.map((topic, i) => (
                        <li key={i}>{topic}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>

                <div>
                  <h4 className="font-medium mt-4 mb-2">Recent Winners</h4>
                  <div className="grid gap-2">
                    {brief.recentWinners.map((w, i) => (
                      <div key={i} className="text-sm p-2 bg-muted rounded border">
                        {w.caption || "Media post (no text)"}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Failed to load brief.</div>
            )}
          </CardContent>
        </Card>

        {/* Pipeline Health Card */}
        <PipelineHealthCard onNavigate={onNavigate} />
      </div>
    </div>
  );
}

function PipelineHealthCard({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const { data: health, isLoading } = trpc.instagramAdmin.getPipelineHealth.useQuery(undefined, {
    refetchInterval: 5000,
  });

  const higgsfieldHealth = trpc.instagramAdmin.getHiggsfieldHealth.useQuery(undefined, { enabled: false });

  return (
    <Card className="col-span-full">
      <CardHeader>
        <CardTitle>Pipeline Health</CardTitle>
        <CardDescription>Status of the automated reel manufacturing pipeline.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : health ? (
          <div className="grid gap-4 md:grid-cols-4">
            <div className="p-4 rounded border bg-card">
              <div className="text-sm font-medium text-muted-foreground mb-1">Storage</div>
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${health.storage.configured ? "bg-green-500" : "bg-red-500"}`} />
                <span>{health.storage.configured ? "Configured" : "Missing S3/CF"}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {health.storage.permanentUrls ? "Permanent URLs Enabled" : "Ephemeral Only"}
              </div>
            </div>

            <div className="p-4 rounded border bg-card flex flex-col justify-between min-h-[110px]">
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="text-sm font-medium text-muted-foreground">Reel Generator</div>
                  <button
                    type="button"
                    onClick={() => higgsfieldHealth.refetch()}
                    disabled={higgsfieldHealth.isFetching}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-border/40 hover:bg-muted disabled:opacity-50 inline-flex items-center gap-1 cursor-pointer"
                  >
                    {higgsfieldHealth.isFetching ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
                    Check CLI
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${health.generator.configured ? "bg-green-500" : "bg-red-500"}`} />
                  <span>
                    {health.generator.provider ? `${health.generator.provider.toUpperCase()}: ` : ""}
                    {health.generator.configured ? "Configured" : "Missing API Key"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {health.generator.enabled ? "Generation Enabled" : "Generation Paused"}
                </div>
              </div>
              {higgsfieldHealth.data && (
                <div className="mt-2 pt-2 border-t text-[11px]">
                  {higgsfieldHealth.data.credsValid ? (
                    <div className="text-green-500 font-medium">
                      ✓ CLI valid {higgsfieldHealth.data.balanceCredits != null && `· ${higgsfieldHealth.data.balanceCredits} cr`}
                    </div>
                  ) : (
                    <div className="text-destructive font-medium text-[10px] leading-tight">
                      ⚠ CLI STALE. Run `hf auth login`
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-4 rounded border bg-card">
              <div className="text-sm font-medium text-muted-foreground mb-1">Meta API</div>
              {/*
                THREE STATES, NEVER TWO. This rendered green off `connected`,
                which is presence-only — credentials set, an IG id exists. A
                REVOKED or expired token leaves all of that true, so the card
                said "Connected" while every publish failed at the Graph call.
                `live` is Meta's own answer; `null` means we could not ask, which
                is its own state and must not borrow either of the other two.
              */}
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${
                  !health.meta.connected ? "bg-red-500"
                    : health.meta.live === true ? "bg-green-500"
                    : health.meta.live === false ? "bg-red-500"
                    : "bg-amber-500"
                }`} />
                <span>{
                  !health.meta.connected ? "Not configured"
                    : health.meta.live === true ? "Connected"
                    : health.meta.live === false ? "Rejected by Meta"
                    : "Unverified"
                }</span>
              </div>
              {health.meta.live !== true && health.meta.liveError && (
                <p className="mt-1 text-xs text-muted-foreground">{health.meta.liveError}</p>
              )}
            </div>

            {/* Was a dead count. Telling the operator something is stuck and giving
                no way to look at it is the pattern that let three reels sit for 32
                hours — the number is now the door into the Actions tab. */}
            <button
              type="button"
              onClick={() => onNavigate?.("actions")}
              disabled={!onNavigate}
              className="p-4 rounded border bg-card text-left transition-colors enabled:hover:bg-accent/50 enabled:cursor-pointer"
            >
              <div className="text-sm font-medium text-muted-foreground mb-1">Needs attention</div>
              <div className="flex items-center gap-2">
                {/* UNKNOWN IS NOT ZERO. When the count cannot be read the dot is
                    amber and the text says so — rendering a failed query as
                    "0 jobs" is a green light the system never actually gave. */}
                <div className={`h-2 w-2 rounded-full ${
                  health.failedJobs === null ? "bg-amber-500"
                    : health.failedJobs === 0 ? "bg-green-500" : "bg-destructive"
                }`} />
                <span>
                  {health.failedJobs === null
                    ? "Unable to determine — count unavailable"
                    : `${health.failedJobs} job${health.failedJobs === 1 ? "" : "s"} needing attention`}
                </span>
              </div>
              {(health.failedJobs === null || health.failedJobs > 0) && onNavigate && (
                <span className="text-[11px] text-primary mt-1 inline-block">Open the Action Center →</span>
              )}
            </button>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Failed to load pipeline health.</div>
        )}
      </CardContent>
    </Card>
  );
}
