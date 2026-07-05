/**
 * adminDashboardRouter — flat merge of the concern files in this folder.
 *
 * 2026-07-05 carve of the 1,133-line dashboard.ts. The router was ONE object
 * holding 17 procedures, three of which dwarfed the rest (drilldown ~460
 * lines, sectionInsight ~210, todaysBrief ~200). Split by reason-to-change
 * and spread-merged here — deliberately NOT nested sub-routers, which would
 * rename every client call path. adminDashboard.<proc> stays byte-identical.
 */
import { router } from "../../../_core/trpc";
import { healthProcedures } from "./health";
import { drilldownProcedures } from "./drilldown";
import { todaysBriefProcedures } from "./todaysBrief";
import { sectionInsightProcedures } from "./sectionInsight";
import { dbCleanupProcedures } from "./dbCleanup";

export const adminDashboardRouter = router({
  ...healthProcedures,
  ...drilldownProcedures,
  ...todaysBriefProcedures,
  ...sectionInsightProcedures,
  ...dbCleanupProcedures,
});
