// wave-181.x Intelligence Dispersal Wave 2 (2026-05-24) · remaining
// Revenue panels deleted per dispersal plan §4.2 + §4.3.
//
// Deleted UI surfaces:
//   · Revenue Anomalies → statenour /scoreboard NickHealthSection
//     (Wave 1.5 already shipped · master_report.revenue.anomalies
//     is in the synthesized payload statenour consumes)
//   · Cash Flow Forecast → Money page inline (pending Wave 2 add)
//   · Profit Margins by Service → Money page inline (pending Wave 2 add)
//   · Payment Trends → Money page inline (pending Wave 2 add)
//   · Revenue Concentration → statenour /brain (pending Wave 3)
//
// All 5 tRPC procedures stay live (operator decision §4.4 #1 ·
// keep underlying sub-reports for future improvements):
//   · trpc.intelligence.revenueAnomaly
//   · trpc.intelligence.cashFlow
//   · trpc.intelligence.profitMargins
//   · trpc.intelligence.paymentTrends
//   · trpc.intelligence.revenueConcentration
//
// Future inline absorption to the Money page is a separate task ·
// data is preserved · only the duplicate UI surface is retired.
// Wave 3 deletes IntelligenceSection entirely from nickstire admin ·
// this stub disappears at that point.

export default function RevenueTab() {
  return (
    <div className="p-8 text-center text-[12px] text-foreground/30">
      <p className="mb-2 tracking-wide">Revenue signals are being dispersed to canonical surfaces.</p>
      <p className="text-[11px] text-foreground/25">
        See <span className="font-mono">docs/2026-05-24-intelligence-dispersal-plan.md</span> §4.2-4.3 for the migration map.
      </p>
    </div>
  );
}
