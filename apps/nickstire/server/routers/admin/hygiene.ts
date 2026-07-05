/**
 * Admin router — dashboard stats, analytics, weekly reports, follow-ups.
 */
import { TRPCError } from "@trpc/server";
import { bookings, leads, callbackRequests } from "../../../drizzle/schema";

import { db } from "../../lib/db-helper";



export async function runHygieneScan() {
  const d = await db();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  const { eq, and, or, gte, lt } = await import("drizzle-orm");

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const oneEightyDaysAgo = new Date();
  oneEightyDaysAgo.setDate(oneEightyDaysAgo.getDate() - 180);

  const maskPhoneNum = (numString: string) => {
    const digits = numString.replace(/\D/g, "");
    return digits.length > 4 ? `***-***-${digits.slice(-4)}` : numString;
  };

  const maskPersonName = (fullName: string) => {
    const parts = fullName.split(" ");
    return parts.map(p => p.slice(0, 1) + ".").join(" ");
  };

  const isFakePattern = (name: string, phone: string, problemOrMessage: string | null) => {
    const n = name.toLowerCase();
    const p = (problemOrMessage || "").toLowerCase();
    const ph = phone.replace(/\D/g, "");

    // Exclude Vapi AI receptionist logs
    if (p.includes("[voice-agent]")) {
      return false;
    }

    if (
      n.includes("test") ||
      n.includes("asdf") ||
      n.includes("qwerty") ||
      n.includes("dummy") ||
      n.includes("demo") ||
      n.includes("foo bar") ||
      n === "foo" ||
      n === "bar" ||
      n.includes("john doe") ||
      n.includes("jane doe") ||
      n.includes("john smith") ||
      n.includes("jane smith") ||
      p.includes("this is a test") ||
      p.includes("test message")
    ) {
      return true;
    }

    if (
      ph.includes("555") ||
      ph.length < 7 ||
      /^(.)\1+$/.test(ph) ||
      ph === "1234567890" ||
      ph === "0123456789"
    ) {
      return true;
    }

    if ((n === "caller" || n === "customer") && ph.length < 10) {
      return true;
    }

    return false;
  };

  // Perform database-level filtering
  const dbLeads = await d
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      problem: leads.problem,
      status: leads.status,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .where(
      or(
        gte(leads.createdAt, oneEightyDaysAgo),
        and(eq(leads.status, "new"), lt(leads.createdAt, ninetyDaysAgo))
      )
    );

  const dbBookings = await d
    .select({
      id: bookings.id,
      name: bookings.name,
      phone: bookings.phone,
      message: bookings.message,
      service: bookings.service,
      status: bookings.status,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .where(
      or(
        gte(bookings.createdAt, oneEightyDaysAgo),
        and(eq(bookings.status, "new"), lt(bookings.createdAt, ninetyDaysAgo))
      )
    );

  const dbCallbacks = await d
    .select({
      id: callbackRequests.id,
      name: callbackRequests.name,
      phone: callbackRequests.phone,
      context: callbackRequests.context,
      status: callbackRequests.status,
      createdAt: callbackRequests.createdAt,
    })
    .from(callbackRequests)
    .where(
      or(
        gte(callbackRequests.createdAt, oneEightyDaysAgo),
        and(
          eq(callbackRequests.status, "new"),
          lt(callbackRequests.createdAt, ninetyDaysAgo)
        )
      )
    );

  const fakeLeads: any[] = [];
  const duplicateLeads: any[] = [];
  const staleLeads: any[] = [];
  const processedLeadIds = new Set<number>();

  for (const l of dbLeads) {
    if (l.createdAt < oneEightyDaysAgo) continue;
    const isVoiceAgent = (l.problem || "").toLowerCase().includes("[voice-agent]");
    if (!isVoiceAgent && isFakePattern(l.name, l.phone, l.problem)) {
      fakeLeads.push({
        id: l.id,
        name: maskPersonName(l.name),
        phone: maskPhoneNum(l.phone),
        createdAt: l.createdAt,
        details: l.problem ? l.problem.slice(0, 100) : "",
        table: "leads"
      });
    }
  }

  const sortedLeads = dbLeads
    .filter((l: any) => l.createdAt >= oneEightyDaysAgo)
    .sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime());
  for (let i = 0; i < sortedLeads.length; i++) {
    const leadA = sortedLeads[i];
    const pA = leadA.phone.replace(/\D/g, "");
    if (processedLeadIds.has(leadA.id) || fakeLeads.some(f => f.id === leadA.id) || pA.length < 7) continue;

    for (let j = i + 1; j < sortedLeads.length; j++) {
      const leadB = sortedLeads[j];
      const pB = leadB.phone.replace(/\D/g, "");
      if (processedLeadIds.has(leadB.id) || fakeLeads.some(f => f.id === leadB.id) || pB.length < 7) continue;

      if (pA === pB) {
        const timeDiffHours = Math.abs(leadA.createdAt.getTime() - leadB.createdAt.getTime()) / (1000 * 60 * 60);
        if (timeDiffHours <= 24) {
          duplicateLeads.push({
            id: leadB.id,
            name: maskPersonName(leadB.name),
            phone: maskPhoneNum(leadB.phone),
            createdAt: leadB.createdAt,
            details: `Duplicate of Lead #${leadA.id} within 24h`,
            table: "leads"
          });
          processedLeadIds.add(leadB.id);
        }
      }
    }
  }

  for (const l of dbLeads) {
    if (l.createdAt >= ninetyDaysAgo) continue;
    if (fakeLeads.some(f => f.id === l.id) || duplicateLeads.some(d => d.id === l.id)) continue;
    if (l.status === "new") {
      staleLeads.push({
        id: l.id,
        name: maskPersonName(l.name),
        phone: maskPhoneNum(l.phone),
        createdAt: l.createdAt,
        details: `New lead older than 90 days`,
        table: "leads"
      });
    }
  }

  const fakeBookings: any[] = [];
  const duplicateBookings: any[] = [];
  const staleBookings: any[] = [];
  const processedBookingIds = new Set<number>();

  for (const b of dbBookings) {
    if (b.createdAt < oneEightyDaysAgo) continue;
    const isVoiceAgent = (b.message || "").toLowerCase().includes("[voice-agent]");
    if (!isVoiceAgent && (isFakePattern(b.name, b.phone, b.message) || (b.phone.replace(/\D/g, "").length < 10 && b.phone.replace(/\D/g, "").length > 0))) {
      fakeBookings.push({
        id: b.id,
        name: maskPersonName(b.name),
        phone: maskPhoneNum(b.phone),
        createdAt: b.createdAt,
        details: b.service || "",
        table: "bookings"
      });
    }
  }

  const sortedBookings = dbBookings
    .filter((b: any) => b.createdAt >= oneEightyDaysAgo)
    .sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime());
  for (let i = 0; i < sortedBookings.length; i++) {
    const bookingA = sortedBookings[i];
    const pA = bookingA.phone.replace(/\D/g, "");
    if (processedBookingIds.has(bookingA.id) || fakeBookings.some(f => f.id === bookingA.id) || pA.length < 7) continue;

    for (let j = i + 1; j < sortedBookings.length; j++) {
      const bookingB = sortedBookings[j];
      const pB = bookingB.phone.replace(/\D/g, "");
      if (processedBookingIds.has(bookingB.id) || fakeBookings.some(f => f.id === bookingB.id) || pB.length < 7) continue;

      if (pA === pB) {
        const timeDiffHours = Math.abs(bookingA.createdAt.getTime() - bookingB.createdAt.getTime()) / (1000 * 60 * 60);
        if (timeDiffHours <= 24) {
          duplicateBookings.push({
            id: bookingB.id,
            name: maskPersonName(bookingB.name),
            phone: maskPhoneNum(bookingB.phone),
            createdAt: bookingB.createdAt,
            details: `Duplicate booking for phone within 24h`,
            table: "bookings"
          });
          processedBookingIds.add(bookingB.id);
        }
      }
    }
  }

  for (const b of dbBookings) {
    if (b.createdAt >= ninetyDaysAgo) continue;
    if (fakeBookings.some(f => f.id === b.id) || duplicateBookings.some(d => d.id === b.id)) continue;
    if (b.status === "new") {
      staleBookings.push({
        id: b.id,
        name: maskPersonName(b.name),
        phone: maskPhoneNum(b.phone),
        createdAt: b.createdAt,
        details: `New booking older than 90 days`,
        table: "bookings"
      });
    }
  }

  const fakeCallbacks: any[] = [];
  const duplicateCallbacks: any[] = [];
  const staleCallbacks: any[] = [];
  const processedCallbackIds = new Set<number>();

  for (const c of dbCallbacks) {
    if (c.createdAt < oneEightyDaysAgo) continue;
    const isVoiceAgent = (c.context || "").toLowerCase().includes("[voice-agent]");
    if (!isVoiceAgent && isFakePattern(c.name, c.phone, c.context)) {
      fakeCallbacks.push({
        id: c.id,
        name: maskPersonName(c.name),
        phone: maskPhoneNum(c.phone),
        createdAt: c.createdAt,
        details: c.context || "",
        table: "callbacks"
      });
    }
  }

  const sortedCallbacks = dbCallbacks
    .filter((c: any) => c.createdAt >= oneEightyDaysAgo)
    .sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime());
  for (let i = 0; i < sortedCallbacks.length; i++) {
    const callbackA = sortedCallbacks[i];
    const pA = callbackA.phone.replace(/\D/g, "");
    if (processedCallbackIds.has(callbackA.id) || fakeCallbacks.some(f => f.id === callbackA.id) || pA.length < 7) continue;

    for (let j = i + 1; j < sortedCallbacks.length; j++) {
      const callbackB = sortedCallbacks[j];
      const pB = callbackB.phone.replace(/\D/g, "");
      if (processedCallbackIds.has(callbackB.id) || fakeCallbacks.some(f => f.id === callbackB.id) || pB.length < 7) continue;

      if (pA === pB) {
        const timeDiffHours = Math.abs(callbackA.createdAt.getTime() - callbackB.createdAt.getTime()) / (1000 * 60 * 60);
        if (timeDiffHours <= 24) {
          duplicateCallbacks.push({
            id: callbackB.id,
            name: maskPersonName(callbackB.name),
            phone: maskPhoneNum(callbackB.phone),
            createdAt: callbackB.createdAt,
            details: `Duplicate callback within 24h`,
            table: "callbacks"
          });
          processedCallbackIds.add(callbackB.id);
        }
      }
    }
  }

  for (const c of dbCallbacks) {
    if (c.createdAt >= ninetyDaysAgo) continue;
    if (fakeCallbacks.some(f => f.id === c.id) || duplicateCallbacks.some(d => d.id === c.id)) continue;
    if (c.status === "new") {
      staleCallbacks.push({
        id: c.id,
        name: maskPersonName(c.name),
        phone: maskPhoneNum(c.phone),
        createdAt: c.createdAt,
        details: `New/pending callback older than 90 days`,
        table: "callbacks"
      });
    }
  }

  return {
    fake: [...fakeLeads, ...fakeBookings, ...fakeCallbacks],
    duplicates: [...duplicateLeads, ...duplicateBookings, ...duplicateCallbacks],
    stale: [...staleLeads, ...staleBookings, ...staleCallbacks],
  };
}
