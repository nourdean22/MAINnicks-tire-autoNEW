/**
 * Admin router — dashboard stats, analytics, weekly reports, follow-ups.
 */
import { adminProcedure, router } from "../../_core/trpc";
import { desc } from "drizzle-orm";
import { bookings, leads, callbackRequests, callEvents } from "../../../drizzle/schema";
import { csvSafe } from "../../sanitize";

import { db } from "../../lib/db-helper";



// ─── DATA EXPORT ───────────────────────────────────────
export const exportRouter = router({
  bookings: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { csv: "", count: 0 };
    const rows = await d.select().from(bookings).orderBy(desc(bookings.createdAt)).limit(10000);
    const headers = ["ID", "Name", "Phone", "Email", "Service", "Vehicle", "Status", "Urgency", "UTM Source", "UTM Medium", "UTM Campaign", "Landing Page", "Referrer", "Created"];
    const csvRows = rows.map((r: typeof rows[number]) => [
      r.id, csvSafe(r.name), csvSafe(r.phone), csvSafe(r.email), csvSafe(r.service), csvSafe(r.vehicle), r.status, r.urgency || "",
      csvSafe(r.utmSource), csvSafe(r.utmMedium), csvSafe(r.utmCampaign), csvSafe(r.landingPage), csvSafe(r.referrer),
      new Date(r.createdAt).toISOString(),
    ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    return { csv: [headers.join(","), ...csvRows].join("\n"), count: rows.length };
  }),

  leads: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { csv: "", count: 0 };
    const rows = await d.select().from(leads).orderBy(desc(leads.createdAt)).limit(10000);
    const headers = ["ID", "Name", "Phone", "Email", "Source", "Problem", "Urgency Score", "Status", "UTM Source", "UTM Medium", "UTM Campaign", "Landing Page", "Referrer", "Created"];
    const csvRows = rows.map((r: typeof rows[number]) => [
      r.id, csvSafe(r.name), csvSafe(r.phone), csvSafe(r.email), r.source, csvSafe(r.problem), r.urgencyScore ?? "", r.status,
      csvSafe(r.utmSource), csvSafe(r.utmMedium), csvSafe(r.utmCampaign), csvSafe(r.landingPage), csvSafe(r.referrer),
      new Date(r.createdAt).toISOString(),
    ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    return { csv: [headers.join(","), ...csvRows].join("\n"), count: rows.length };
  }),

  calls: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { csv: "", count: 0 };
    const rows = await d.select().from(callEvents).orderBy(desc(callEvents.createdAt)).limit(10000);
    const headers = ["ID", "Phone Number", "Source Page", "Click Element", "UTM Source", "UTM Medium", "UTM Campaign", "Landing Page", "Referrer", "Created"];
    const csvRows = rows.map((r: typeof rows[number]) => [
      r.id, csvSafe(r.phoneNumber), csvSafe(r.sourcePage), csvSafe(r.clickElement),
      csvSafe(r.utmSource), csvSafe(r.utmMedium), csvSafe(r.utmCampaign), csvSafe(r.landingPage), csvSafe(r.referrer),
      new Date(r.createdAt).toISOString(),
    ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    return { csv: [headers.join(","), ...csvRows].join("\n"), count: rows.length };
  }),

  callbacks: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { csv: "", count: 0 };
    const rows = await d.select().from(callbackRequests).orderBy(desc(callbackRequests.createdAt)).limit(10000);
    const headers = ["ID", "Name", "Phone", "Context", "Source Page", "Status", "UTM Source", "UTM Medium", "UTM Campaign", "Landing Page", "Referrer", "Created"];
    const csvRows = rows.map((r: typeof rows[number]) => [
      r.id, csvSafe(r.name), csvSafe(r.phone), csvSafe(r.context), csvSafe(r.sourcePage), r.status,
      csvSafe(r.utmSource), csvSafe(r.utmMedium), csvSafe(r.utmCampaign), csvSafe(r.landingPage), csvSafe(r.referrer),
      new Date(r.createdAt).toISOString(),
    ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    return { csv: [headers.join(","), ...csvRows].join("\n"), count: rows.length };
  }),
});
