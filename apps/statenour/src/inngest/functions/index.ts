/**
 * Inngest function registry · Wave-200 Phase 3 (2026-05-17)
 *
 * Every function exported here is mounted by the serve endpoint at
 * `/api/inngest`. Add new functions by exporting them here · the
 * serve endpoint picks them up automatically.
 *
 * See: src/inngest/client.ts · app/api/inngest/route.ts
 */

export { megaFanoutMorning, megaFanoutEvening } from "./mega-fanout";
export { operatorMorningBrief } from "./morning-brief";
