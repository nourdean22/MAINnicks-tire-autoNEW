import { trpc } from "@/lib/trpc";
import { StatCard } from "../shared";
import { Spinner, NoData, EngineCard, Badge, STALE_TIME } from "./utils";
import {
  Shield, AlertTriangle, CheckCircle2, XCircle,
} from "lucide-react";

const CATEGORIES = ["financial", "reputation", "operational", "data", "compliance"] as const;

export default function SafetyTab() {
  const { data, isLoading, error } = trpc.intelligence.safetyCheck.useQuery(undefined, {
    staleTime: STALE_TIME,
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <NoData label="Safety check unavailable" />;

  const score = data.score;
  const scoreColor = score >= 80 ? "text-emerald-400" : score >= 50 ? "text-amber-400" : "text-red-400";
  const statusColor = data.overallStatus === "safe" ? "text-emerald-400" : data.overallStatus === "warning" ? "text-amber-400" : "text-red-400";

  // Collect all alerts from all categories
  const allAlerts = CATEGORIES.flatMap((cat) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tRPC returns any from untyped db
    const check = data[cat] as any;
    return (check?.alerts || []).map((a: any) => ({ ...a, category: cat }));
  });

  return (
    <div className="space-y-6">
      {/* Overall Score */}
      <div className="bg-card border border-border/30 p-6 flex items-center gap-6">
        <div className="flex-shrink-0">
          <div className={`text-5xl font-bold font-mono ${scoreColor}`}>{score}</div>
          <div className="text-[10px] text-foreground/40 tracking-wide mt-1">SAFETY SCORE</div>
        </div>
        <div className="flex-1 space-y-2">
          <div className="w-full h-3 bg-background rounded-sm overflow-hidden">
            <div
              className={`h-full transition-all duration-700 rounded-sm ${score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : "bg-red-500"}`}
              style={{ width: `${Math.min(100, score)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className={statusColor}>Status: {data.overallStatus.toUpperCase()}</span>
            <span className="text-foreground/30 text-[10px]">Checked: {data.checkedAt}</span>
          </div>
        </div>
      </div>

      {/* Alert Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          label="TOTAL ALERTS"
          value={data.totalAlerts}
          icon={<AlertTriangle className="w-4 h-4" />}
          color={data.totalAlerts > 0 ? "text-amber-400" : "text-emerald-400"}
        />
        <StatCard
          label="CRITICAL"
          value={data.criticalAlerts}
          icon={<XCircle className="w-4 h-4" />}
          color={data.criticalAlerts > 0 ? "text-red-400" : "text-emerald-400"}
        />
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tRPC returns any from untyped db
        {CATEGORIES.slice(0, 3).map((cat) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tRPC returns any from untyped db
          const check = data[cat] as any;
          const alertCount = check?.alerts?.length ?? 0;
          return (
            <StatCard
              key={cat}
              label={cat.toUpperCase()}
              value={alertCount === 0 ? "OK" : `${alertCount} alerts`}
              icon={alertCount === 0 ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              color={alertCount === 0 ? "text-emerald-400" : "text-amber-400"}
            />
          );
        })}
      </div>

      {/* All Alerts */}
      {allAlerts.length > 0 && (
        <EngineCard title="DETECTED ALERTS" icon={<AlertTriangle className="w-4 h-4 text-red-400" />}
          border={allAlerts.some((a: any) => a.severity === "critical") ? "border-red-500/20" : "border-amber-500/20"}>
          <div className="space-y-2">
            {allAlerts.map((alert: any, i: number) => (
              <div key={i} className="flex items-start gap-3 py-2.5 border-b border-border/10 last:border-0">
                <Badge label={alert.severity?.toUpperCase() || "WARNING"} level={alert.severity || "warning"} />
                <div className="flex-1 text-[12px] text-foreground">{alert.message}</div>
                <span className="text-[10px] text-foreground/30 shrink-0 capitalize">{alert.category}</span>
              </div>
            ))}
          </div>
        </EngineCard>
      )}

      {/* Category Details */}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tRPC returns any from untyped db
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {CATEGORIES.map((cat) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tRPC returns any from untyped db
          const check = data[cat] as any;
          if (!check) return null;
          const alertCount = check.alerts?.length ?? 0;
          return (
            <EngineCard
              key={cat}
              title={`${cat.toUpperCase()} METRICS`}
              icon={alertCount === 0 ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-amber-400" />}
              border={alertCount > 0 ? "border-amber-500/20" : "border-border/30"}
            >
              {check.metrics ? (
                <div className="space-y-1">
                  {Object.entries(check.metrics).map(([key, val]: any) => (
                    <div key={key} className="flex items-center justify-between py-1 text-[12px]">
                      <span className="text-foreground/60">{key.replace(/([A-Z])/g, " $1").trim()}</span>
                      <span className="font-mono text-foreground/80">
                        {typeof val === "number" ? (Number.isInteger(val) ? val.toLocaleString() : val.toFixed(1)) : String(val)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : <NoData />}
            </EngineCard>
          );
        })}
      </div>

      {/* All clear message */}
      {allAlerts.length === 0 && (
        <div className="bg-emerald-500/5 border border-emerald-500/20 p-6 text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
          <div className="text-[13px] text-emerald-400 font-medium">All systems healthy. No safety alerts.</div>
        </div>
      )}
    </div>
  );
}
