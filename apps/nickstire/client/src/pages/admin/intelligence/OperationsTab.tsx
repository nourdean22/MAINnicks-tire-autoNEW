// wave-181.x Intelligence Dispersal Wave 2 (2026-05-24) · all 7
// Operations panels deleted per dispersal plan §4.2 + operator
// decision §4.4 #2 "SINGLE STRIP on Today page".
//
// Deleted UI surfaces:
//   · Shop Load KPIs (Active WOs / Today's Bookings / Est. Wait)
//   · Tech Efficiency Rankings ($/hr · jobs/day · comeback · score)
//   · Bay Utilization (occupancy · peak/idle hours)
//   · Turnaround Times by Service
//   · Parts Cost Analysis (avg % · outliers · savings opp)
//   · Capacity Forecast (tomorrow + next week + staffing)
//   · Stage Bottlenecks
//
// All 7 tRPC procedures stay live (operator decision §4.4 #1 ·
// keep underlying sub-reports for future improvements):
//   · trpc.intelligence.shopLoad
//   · trpc.intelligence.techEfficiency
//   · trpc.intelligence.bayUtilization
//   · trpc.intelligence.turnaroundTime
//   · trpc.intelligence.partsCost
//   · trpc.intelligence.capacityForecast
//   · trpc.intelligence.bottlenecks
//
// Future inline absorption to a Today-page Operations strip is a
// separate task · the data is preserved · the UI duplication is
// what's retired here. Wave 3 deletes IntelligenceSection entirely
// from nickstire admin · this stub disappears at that point.

export default function OperationsTab() {
  return (
    <div className="p-8 text-center text-[12px] text-foreground/30">
      <p className="mb-2 tracking-wide">Operations signals are being dispersed to the canonical surfaces.</p>
      <p className="text-[11px] text-foreground/25">
        See <span className="font-mono">docs/2026-05-24-intelligence-dispersal-plan.md</span> §4.2 for the migration map.
      </p>
    </div>
  );
}
