import { cronHandler } from "@/lib/utils/http";
import { syncGoalsFromShop } from "@/lib/services/goal-shop-sync";

export const maxDuration = 60;

/**
 * GET /api/cron/goal-shop-sync · nightly via the mega-evening fan-out (03:00Z, after the shop's day).
 *
 * Sets revenue / cars business goals from the shop through the bridge, a value only (lib/services/goal-shop-sync.ts).
 * Each goal's skip reason is in the result and the info log; a bridge miss or a failed write files the run
 * "partial" with its reason in cron_job_logs. A thrown goal-list read propagates, so the run files FAILED
 * instead of a green run that read nothing.
 */
export const GET = cronHandler(async () => syncGoalsFromShop());
