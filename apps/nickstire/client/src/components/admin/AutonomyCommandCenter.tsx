/**
 * Autonomy command center — milestone 10. One screen answering: what policy
 * governs (and from WHERE), what the kill switches say, what today cost,
 * what is reserved, what was decided, and what the last renders look like.
 * Sections that depend on 0086 show "unavailable" honestly instead of zeros.
 */
import { useState } from "react";
import { Loader2, ShieldAlert, ShieldCheck, Gauge, CalendarClock, ScrollText, Film, Power, Compass } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

function SwitchRow({ label, on, scope, busy, onToggle }: { label: string; on: boolean; scope: "global" | "generation" | "publishing"; busy: boolean; onToggle: (scope: "global" | "generation" | "publishing", next: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/40 px-3 py-2">
      <span className="flex items-center gap-2 text-sm">
        {on ? <ShieldAlert className="h-4 w-4 text-destructive" /> : <ShieldCheck className="h-4 w-4 text-emerald-500" />}
        {label}
      </span>
      <Button size="sm" variant={on ? "destructive" : "outline"} disabled={busy} onClick={() => onToggle(scope, !on)}>
        <Power className="mr-1.5 h-3.5 w-3.5" />
        {on ? "ARMED — release" : "arm"}
      </Button>
    </div>
  );
}

export default function AutonomyCommandCenter() {
  const center = trpc.contentAdmin.getCommandCenter.useQuery(undefined, { refetchInterval: 30_000 });
  const shadow = trpc.contentAdmin.getShadowPlan.useQuery(undefined, { staleTime: 300_000 });
  /** Limit being edited, and its pending value. One at a time, on purpose. */
  const [editingLimit, setEditingLimit] = useState<string | null>(null);
  const [limitDraft, setLimitDraft] = useState<string>("");

  const publishPolicy = trpc.contentAdmin.publishAutonomyPolicy.useMutation({
    onSuccess: () => {
      toast.success("Policy updated", { description: "Published as a new version — the previous one stays in history." });
      setEditingLimit(null);
      center.refetch();
    },
    onError: (err) => toast.error("Policy not changed", { description: err.message }),
  });

  const killSwitch = trpc.contentAdmin.setAutonomyKillSwitch.useMutation({
    onSuccess: (r) => {
      toast.success(`Kill switch updated — policy v${r.version} published`);
      center.refetch();
    },
    onError: (e) => toast.error("Kill switch change failed", { description: e.message }),
  });

  if (center.isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading autonomy state...
      </div>
    );
  }
  const s = center.data;
  if (!s) return <p className="p-8 text-sm text-destructive">Command center unavailable — see server logs.</p>;

  const spendPct = s.spend.available && s.spend.todayUsd !== null ? Math.min(100, Math.round((s.spend.todayUsd / s.spend.capUsd) * 100)) : null;

  return (
    <div className="space-y-5">
      {s.policy.source !== "storage" && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <span className="font-bold">
            {s.policy.source === "fallback_unreachable" ? "POLICY STORAGE UNREACHABLE" : "NO POLICY VERSIONS PUBLISHED"}
          </span>{" "}
          — the code-default policy governs. Kill-switch changes cannot persist until migration 0086 is applied
          (<code>pnpm exec tsx scripts/apply-0086-autonomy-control.mts</code>).
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Gauge className="h-4 w-4 text-primary" /> Policy & spend</CardTitle>
            <CardDescription>
              v{s.policy.version} · mode <Badge variant="outline" className="ml-1 capitalize">{s.policy.operatingMode}</Badge>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {s.spend.available && s.spend.todayUsd !== null ? (
              <div>
                <div className="flex justify-between text-sm">
                  <span>Generation spend today (estimates)</span>
                  <span className="font-mono">${s.spend.todayUsd.toFixed(2)} / ${s.spend.capUsd.toFixed(2)}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded bg-muted">
                  <div className={`h-full ${spendPct! > 80 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${spendPct}%` }} />
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Spend ledger unavailable (0086 pending) — coarse fallback governs the budget check.</p>
            )}
            {/* EDITABLE. These were display-only while publishAutonomyPolicy sat
                with zero callers — so the operator could SEE a spend cap stop
                their work and had no way to change it from the phone they run
                the business on. The generation budget is listed FIRST because it
                is the one that actually blocks production. */}
            <div className="space-y-1">
              {([
                ["maxGenerationCostPerDayUsd", "Generation budget", "$/day", 0, 200],
                ["maxGenerationCostPerCampaignUsd", "Per campaign", "$", 0, 100],
                ["maxFeedPostsPerDay", "Feed posts", "/day", 0, 10],
                ["maxStoriesPerDay", "Stories", "/day", 0, 20],
                ["minimumFeedSpacingHours", "Spacing", "h", 0, 48],
                ["maxRepairAttemptsPerAsset", "Repairs", "/asset", 0, 10],
              ] as const).map(([key, label, unit, min, max]) => {
                const current = (s.policy.limits as Record<string, number>)[key];
                if (current === undefined) return null;
                const isEditing = editingLimit === key;
                return (
                  <div key={key} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    {!isEditing ? (
                      <button
                        type="button"
                        className="font-mono tabular-nums underline decoration-dotted underline-offset-2 hover:text-primary"
                        onClick={() => { setEditingLimit(key); setLimitDraft(String(current)); }}
                        title="Tap to change — publishes a new policy version"
                      >
                        {current}{unit}
                      </button>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Input
                          value={limitDraft}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLimitDraft(e.target.value)}
                          inputMode="decimal"
                          className="h-7 w-20 text-xs font-mono"
                          aria-label={`${label} (${unit})`}
                        />
                        <Button
                          size="sm" className="h-7 text-[11px]"
                          disabled={publishPolicy.isPending || !Number.isFinite(Number(limitDraft)) || Number(limitDraft) < min || Number(limitDraft) > max}
                          onClick={() => {
                            // Publish the WHOLE policy with one limit changed —
                            // publishPolicyVersion is versioned and audited, so
                            // this is reversible by publishing the prior version.
                            const next = {
                              ...s.policy,
                              limits: { ...s.policy.limits, [key]: Number(limitDraft) },
                            };
                            delete (next as Record<string, unknown>).source;
                            publishPolicy.mutate({ policy: next, note: `${label} ${current}${unit} -> ${limitDraft}${unit}` });
                          }}
                        >
                          {publishPolicy.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setEditingLimit(null)}>
                          Cancel
                        </Button>
                      </span>
                    )}
                  </div>
                );
              })}
              <p className="text-[11px] text-muted-foreground/70 pt-1">
                Each change publishes a new policy version. The previous version stays in history, so any change is reversible.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="h-4 w-4 text-primary" /> Emergency controls</CardTitle>
            <CardDescription>Arming publishes a new policy version — instant across boundaries (2s fresh reads).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <SwitchRow label="Global kill switch" scope="global" on={s.policy.emergencyControls.globalKillSwitch} busy={killSwitch.isPending} onToggle={(scope, next) => killSwitch.mutate({ scope, on: next })} />
            <SwitchRow label="Generation kill switch" scope="generation" on={s.policy.emergencyControls.generationKillSwitch} busy={killSwitch.isPending} onToggle={(scope, next) => killSwitch.mutate({ scope, on: next })} />
            <SwitchRow label="Publishing kill switch" scope="publishing" on={s.policy.emergencyControls.publishingKillSwitch} busy={killSwitch.isPending} onToggle={(scope, next) => killSwitch.mutate({ scope, on: next })} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4 text-primary" /> Content reservations (today)</CardTitle>
          </CardHeader>
          <CardContent>
            {!s.reservations.available ? (
              <p className="text-sm text-muted-foreground">Reservations unavailable (0086 pending).</p>
            ) : s.reservations.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No slots reserved today.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {s.reservations.rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="capitalize">{r.format}</Badge>
                    <span className="text-xs text-muted-foreground">{new Date(r.windowStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="truncate">{r.topic ?? "(no topic)"}</span>
                    <Badge variant={r.status === "consumed" ? "default" : "outline"}>{r.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Film className="h-4 w-4 text-primary" /> Recent renders</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Two different facts wore the same sentence. `available:false` means
                the table could not be read (0086 pending, DB down); zero rows
                means it was read and is empty. Telling the operator "no reel jobs
                yet" when the truth is "we could not look" is the same defect the
                publish gate, the HQ counter and the sidebar badge all had. */}
            {!s.recentJobs.available ? (
              <p className="text-sm text-amber-500">Recent renders unavailable — this is not zero.</p>
            ) : s.recentJobs.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reel jobs yet.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {s.recentJobs.rows.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">#{j.id}</span>
                    <Badge variant="outline" className="capitalize">{j.status}</Badge>
                    {j.qaDecision && <Badge variant={j.qaDecision === "approve" ? "default" : "destructive"}>QA: {j.qaDecision}</Badge>}
                    {j.repairs > 0 && <Badge variant="outline">{j.repairs} repair{j.repairs === 1 ? "" : "s"}</Badge>}
                    <span className="text-xs text-muted-foreground">{new Date(j.createdAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Compass className="h-4 w-4 text-primary" /> Shadow planner
            <Badge variant="outline">SHADOW — takes no action</Badge>
          </CardTitle>
          <CardDescription>
            Deterministic ranked recommendations from live signals (season, weather triggers, creative memory,
            repetition). Compare against your own instinct — nothing here spends or posts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!shadow.data ? (
            <p className="text-sm text-muted-foreground">{shadow.isLoading ? "Planning..." : "Plan unavailable."}</p>
          ) : (
            <>
            {/* The planner could never choose a FORM until now — every moment
                mapped to reel+carousel. It shows its confidence and which inputs
                were missing, so a thin recommendation reads as thin. */}
            {(shadow.data as any).format && (
              <div className="mb-3 rounded-md border border-primary/30 bg-primary/5 p-3 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">Suggested format today</span>
                  <span className="font-semibold capitalize">{(shadow.data as any).format.format}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                    (shadow.data as any).format.confidence === "high" ? "border-green-500/40 text-green-600"
                      : (shadow.data as any).format.confidence === "moderate" ? "border-amber-500/40 text-amber-600"
                      : "border-muted-foreground/40 text-muted-foreground"
                  }`}>
                    {(shadow.data as any).format.confidence} confidence
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{(shadow.data as any).format.reason}</p>
                {(shadow.data as any).format.signalsMissing?.length > 0 && (
                  <p className="text-[11px] text-amber-600/80">
                    Missing signals: {(shadow.data as any).format.signalsMissing.join(", ")} — this is a weaker call than it looks.
                  </p>
                )}
              </div>
            )}
            <ul className="space-y-2 text-sm">
              {shadow.data.recommendations.map((o) => (
                <li key={o.id} className="rounded-md border border-border/40 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{o.score}/100</Badge>
                    <span className="font-medium">{o.audienceMoment}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    DM "{o.campaignKeyword}" · {o.creativeTerritory} · {o.objective} ·{" "}
                    <span className="font-mono text-[10px]">{o.reasoningCodes.join(", ")}</span>
                  </p>
                </li>
              ))}
            </ul>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><ScrollText className="h-4 w-4 text-primary" /> Recent policy decisions</CardTitle>
          <CardDescription>Append-only audit trail — every boundary decision with its reasoning codes.</CardDescription>
        </CardHeader>
        <CardContent>
          {!s.auditTail.available ? (
            <p className="text-sm text-muted-foreground">Audit trail unavailable (0086 pending) — decisions are logged to the server console instead.</p>
          ) : s.auditTail.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No decisions recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr><th className="py-1 pr-3">When</th><th className="py-1 pr-3">Action</th><th className="py-1 pr-3">Decision</th><th className="py-1">Codes</th></tr>
                </thead>
                <tbody>
                  {s.auditTail.rows.map((e, i) => (
                    <tr key={i} className="border-t border-border/30">
                      <td className="py-1 pr-3 whitespace-nowrap">{new Date(e.occurredAt).toLocaleTimeString()}</td>
                      <td className="py-1 pr-3">{e.actionType}</td>
                      <td className="py-1 pr-3">
                        <Badge variant={e.decision === "DENY" ? "destructive" : "outline"}>{e.decision}</Badge>
                      </td>
                      <td className="py-1 font-mono text-[10px]">{e.reasoningCodes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
