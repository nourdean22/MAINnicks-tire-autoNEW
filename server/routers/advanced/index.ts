/**
 * Advanced routers — sharded from the old monolithic advanced.ts.
 * Re-exports the 4 sub-routers so consumers can keep importing from
 * "./advanced" unchanged.
 */
export { jobAssignmentsRouter } from "./jobs";
export { invoicesRouter } from "./invoices";
export { kpiRouter } from "./kpi";
export { portalRouter } from "./portal";
