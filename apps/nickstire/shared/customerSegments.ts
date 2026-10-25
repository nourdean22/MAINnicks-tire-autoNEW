/**
 * The Customers tab's two segment rules, in one place (2026-10-25). The server
 * renders them into SQL (server/lib/customer-segments.ts); the admin client
 * prints them. "Visits" are mirrored closed invoices (customers.totalVisits).
 * Changing a number here is Nour's call: the win-back campaign uses the same window.
 */
export const VIP_MIN_VISITS = 3;
export const LAPSED_MIN_DAYS = 90;
export const LAPSED_MAX_DAYS = 365;
export const LAPSED_REGULAR_RULE = `${VIP_MIN_VISITS}+ visits, last visit ${LAPSED_MIN_DAYS} to ${LAPSED_MAX_DAYS} days ago`;
