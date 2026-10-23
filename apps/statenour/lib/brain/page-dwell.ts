/**
 * Shared contract for the page_leave event (2026-10-23, usage telemetry). Imported by the client
 * (components/brain/page-tracker.tsx) and the server (recordPageLeave, POST /api/brain/page-leave), so
 * the endpoint, the reasons and the cap cannot drift apart. No imports: safe in both bundles.
 */

/** Where the tracker sends a leave. A keepalive fetch, because a tRPC mutation cannot run on pagehide. */
export const PAGE_LEAVE_URL = "/api/brain/page-leave";

/** route = pathname change or unmount, hidden = tab/app hidden, pagehide = page closing or leaving. */
export const LEAVE_REASONS = ["route", "hidden", "pagehide"] as const;
export type LeaveReason = (typeof LEAVE_REASONS)[number];

/** A sleeping laptop must not record a week on one page: the server stores at most this, marked capped. */
export const MAX_DWELL_MS = 4 * 60 * 60 * 1000;
