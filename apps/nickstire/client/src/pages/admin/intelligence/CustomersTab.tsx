// wave-181.x Intelligence Dispersal Wave 2 (2026-05-24) · 4 panels
// dispersed per dispersal plan §4.2 + operator decision §4.4 #3
// "Risk + Churn merge into ONE column on Customers roster":
//   · CHURN PREDICTION → CustomersSection StatusBadge (already
//     renders "AT RISK" for churnRisk === "high" + daysSinceLastVisit
//     > 90). The canonical risk surface · don't duplicate.
//   · UNIFIED RISK SCORES → same · StatusBadge covers the signal.
//   · DUE-BACK PREDICTIONS → same · the existing roster column
//     "Last Service" with the daysAgo derivation covers the
//     "predict who's due back" signal. The intelligence.repeatVisit
//     procedure stays on the server for future enrichment work.
//   · CUSTOMER VALUE TREND → migrates to statenour /brain (Wave 3).
//
// The intelligence.churnPrediction · intelligence.riskScores ·
// intelligence.repeatVisit · intelligence.valueTrend tRPC procedures
// stay on the server (operator decision §4.4 #1 · keep underlying
// sub-reports for future improvements · only retire UI surfaces).
//
// Remaining panels on this tab AFTER Wave 2:
//   · SERVICE PREFERENCES (Service Affinity) · its own v2 design ·
//     migrating to statenour /brain via the SA v2 plan
//   · FIRST VISIT CONVERSION · migrating to statenour /funnel (Wave 3)
//
// Both will be deleted from this file in Wave 3 · this tab will be
// empty and the entire Intelligence section retired from nickstire.
import { trpc } from "@/lib/trpc";
import { SectionSpinner, NoData, EngineCard, MiniTable, INTELLIGENCE_QUERY_OPTS } from "./utils";
import { Heart, UserCheck } from "lucide-react";

export default function CustomersTab() {
  const affinity = trpc.intelligence.serviceAffinity.useQuery(undefined, INTELLIGENCE_QUERY_OPTS);
  const firstVisit = trpc.intelligence.firstVisitConversion.useQuery(undefined, INTELLIGENCE_QUERY_OPTS);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Service Affinity — affinities: {customerId, name, topServices, predictedNext}[]
         * To be retired in Wave 3 · v2 design lives in docs/2026-05-24-service-affinity-v2.md ·
         * pending operator verify-before-build (task #75). */}
        {affinity.isLoading ? <SectionSpinner /> : affinity.data ? (
          <EngineCard title="SERVICE PREFERENCES" icon={<Heart className="w-4 h-4 text-primary" />}>
            {affinity.data.affinities?.length > 0 ? (
              <MiniTable
                headers={["CUSTOMER", "TOP SERVICES", "PREDICTED NEXT"]}
                rows={affinity.data.affinities.slice(0, 6).map((a) => [
                  <span className="text-foreground font-medium">{a.name}</span>,
                  <span className="text-[10px] text-foreground/50">{(a.topServices || []).join(", ")}</span>,
                  <span className="text-primary font-medium capitalize">{a.predictedNext}</span>,
                ])}
              />
            ) : <NoData />}
          </EngineCard>
        ) : null}

        {/* First Visit Conversion — {overallRate, bySource, avgDaysToRepeat}
         * To be retired in Wave 3 · migrating to statenour /funnel page. */}
        {firstVisit.isLoading ? <SectionSpinner /> : firstVisit.data ? (
          <EngineCard title="FIRST VISIT CONVERSION" icon={<UserCheck className="w-4 h-4 text-emerald-400" />}>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="text-center">
                <div className="text-xl font-bold text-primary font-mono">{firstVisit.data.overallRate}%</div>
                <div className="text-[10px] text-foreground/40">CONVERSION RATE</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-foreground font-mono">{firstVisit.data.avgDaysToRepeat}d</div>
                <div className="text-[10px] text-foreground/40">AVG DAYS TO REPEAT</div>
              </div>
            </div>
            {firstVisit.data.bySource?.length > 0 && (
              <MiniTable
                headers={["SOURCE", "FIRST", "REPEATED", "RATE"]}
                rows={firstVisit.data.bySource.slice(0, 5).map((s) => [
                  <span className="text-foreground capitalize font-medium">{s.source}</span>,
                  <span className="font-mono">{s.firstVisits}</span>,
                  <span className="font-mono text-emerald-400">{s.repeated}</span>,
                  <span className="font-mono font-semibold">{s.rate}%</span>,
                ])}
              />
            )}
          </EngineCard>
        ) : null}
      </div>
    </div>
  );
}
