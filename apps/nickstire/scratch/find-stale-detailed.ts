import "dotenv/config";
import mysql from "mysql2/promise";

const isFakePattern = (name: string, phone: string, problemOrMessage: string | null) => {
  const n = name.toLowerCase();
  const p = (problemOrMessage || "").toLowerCase();
  const ph = phone.replace(/\D/g, "");

  const reasons: string[] = [];

  // Test names/emails/problems
  if (n.includes("test")) reasons.push("Name contains 'test'");
  if (n.includes("asdf")) reasons.push("Name contains 'asdf'");
  if (n.includes("qwerty")) reasons.push("Name contains 'qwerty'");
  if (n.includes("dummy")) reasons.push("Name contains 'dummy'");
  if (n.includes("demo")) reasons.push("Name contains 'demo'");
  if (n.includes("foo bar") || n === "foo" || n === "bar") reasons.push("Name is foo/bar/foobar");
  if (n.includes("john doe") || n.includes("jane doe")) reasons.push("Name contains 'john doe' or 'jane doe'");
  if (n.includes("john smith") || n.includes("jane smith")) reasons.push("Name contains 'john smith' or 'jane smith'");
  if (p.includes("this is a test")) reasons.push("Problem contains 'this is a test'");
  if (p.includes("test message")) reasons.push("Problem contains 'test message'");

  // Fake/Test phone numbers
  if (ph.includes("555")) reasons.push("Phone contains '555'");
  if (ph.length < 7 && ph.length > 0) reasons.push("Phone length is too short (<7 digits)");
  if (/^(.)\1+$/.test(ph) && ph.length > 0) reasons.push("Phone has repeating digits");
  if (ph === "1234567890" || ph === "0123456789") reasons.push("Phone is sequential 1234567890/0123456789");

  // Generic names with no context or fake-looking characteristics
  if (n === "caller" && ph.length < 10) reasons.push("Name is generic 'caller' and phone is incomplete");
  if (n === "customer" && ph.length < 10) reasons.push("Name is generic 'customer' and phone is incomplete");

  return reasons.length > 0 ? reasons.join(", ") : null;
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not configured.");
    process.exit(1);
  }

  const conn = await mysql.createConnection(url);
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    console.log("==================================================");
    console.log("🔍 DETAILED DATABASE HYGIENE SCAN");
    console.log("==================================================");

    // ==========================================
    // 1. LEADS
    // ==========================================
    console.log("\n>>> Auditing 'leads' table");
    const [leadsRaw] = await conn.execute(
      "SELECT id, name, phone, email, problem, status, createdAt FROM leads"
    );
    const leads = leadsRaw as any[];
    
    const fakeLeads: any[] = [];
    const duplicateLeads: any[] = [];
    const staleLeads: any[] = [];
    const processedLeadIds = new Set<number>();

    for (const l of leads) {
      const fakeReason = isFakePattern(l.name, l.phone, l.problem);
      if (fakeReason) {
        fakeLeads.push({ ...l, reason: fakeReason });
      }
    }

    const sortedLeads = [...leads].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (let i = 0; i < sortedLeads.length; i++) {
      const leadA = sortedLeads[i];
      if (processedLeadIds.has(leadA.id) || fakeLeads.some(f => f.id === leadA.id)) continue;

      for (let j = i + 1; j < sortedLeads.length; j++) {
        const leadB = sortedLeads[j];
        if (processedLeadIds.has(leadB.id) || fakeLeads.some(f => f.id === leadB.id)) continue;

        const nameMatch = leadA.name.toLowerCase().trim() === leadB.name.toLowerCase().trim();
        const phoneMatch = leadA.phone.replace(/\D/g, "") === leadB.phone.replace(/\D/g, "");

        if (nameMatch && phoneMatch) {
          const timeDiffHours = Math.abs(leadA.createdAt.getTime() - leadB.createdAt.getTime()) / (1000 * 60 * 60);
          if (timeDiffHours <= 24) {
            duplicateLeads.push({ ...leadB, duplicateOf: leadA.id });
            processedLeadIds.add(leadB.id);
          }
        }
      }
    }

    for (const l of leads) {
      if (fakeLeads.some(f => f.id === l.id) || duplicateLeads.some(d => d.id === l.id)) continue;
      if (l.status === "new" && l.createdAt < thirtyDaysAgo) {
        staleLeads.push(l);
      }
    }

    console.log(`Summary: Total Leads = ${leads.length} | Fake = ${fakeLeads.length} | Duplicates = ${duplicateLeads.length} | Stale New (>30d) = ${staleLeads.length}`);
    for (const l of fakeLeads) {
      console.log(`  · [ID ${l.id}] FAKE: "${l.name}" (${l.phone}) - Reason: ${l.reason}`);
    }
    for (const l of duplicateLeads) {
      console.log(`  · [ID ${l.id}] DUPLICATE: "${l.name}" (${l.phone}) - Duplicate of ID ${l.duplicateOf}`);
    }
    for (const l of staleLeads) {
      console.log(`  · [ID ${l.id}] STALE (>30d): "${l.name}" (${l.phone}) - Created ${l.createdAt.toISOString()}`);
    }

    // ==========================================
    // 2. BOOKINGS
    // ==========================================
    console.log("\n>>> Auditing 'bookings' table");
    const [bookingsRaw] = await conn.execute(
      "SELECT id, name, phone, email, message, status, createdAt FROM bookings"
    );
    const bookings = bookingsRaw as any[];
    
    const fakeBookings: any[] = [];
    const duplicateBookings: any[] = [];
    const staleBookings: any[] = [];
    const processedBookingIds = new Set<number>();

    for (const b of bookings) {
      const fakeReason = isFakePattern(b.name, b.phone, b.message);
      if (fakeReason) {
        fakeBookings.push({ ...b, reason: fakeReason });
      }
    }

    const sortedBookings = [...bookings].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (let i = 0; i < sortedBookings.length; i++) {
      const bookingA = sortedBookings[i];
      if (processedBookingIds.has(bookingA.id) || fakeBookings.some(f => f.id === bookingA.id)) continue;

      for (let j = i + 1; j < sortedBookings.length; j++) {
        const bookingB = sortedBookings[j];
        if (processedBookingIds.has(bookingB.id) || fakeBookings.some(f => f.id === bookingB.id)) continue;

        const nameMatch = bookingA.name.toLowerCase().trim() === bookingB.name.toLowerCase().trim();
        const phoneMatch = bookingA.phone.replace(/\D/g, "") === bookingB.phone.replace(/\D/g, "");

        if (nameMatch && phoneMatch) {
          const timeDiffHours = Math.abs(bookingA.createdAt.getTime() - bookingB.createdAt.getTime()) / (1000 * 60 * 60);
          if (timeDiffHours <= 24) {
            duplicateBookings.push({ ...bookingB, duplicateOf: bookingA.id });
            processedBookingIds.add(bookingB.id);
          }
        }
      }
    }

    for (const b of bookings) {
      if (fakeBookings.some(f => f.id === b.id) || duplicateBookings.some(d => d.id === b.id)) continue;
      if (b.status === "new" && b.createdAt < thirtyDaysAgo) {
        staleBookings.push(b);
      }
    }

    console.log(`Summary: Total Bookings = ${bookings.length} | Fake = ${fakeBookings.length} | Duplicates = ${duplicateBookings.length} | Stale New (>30d) = ${staleBookings.length}`);
    for (const b of fakeBookings) {
      console.log(`  · [ID ${b.id}] FAKE: "${b.name}" (${b.phone}) - Reason: ${b.reason}`);
    }
    for (const b of duplicateBookings) {
      console.log(`  · [ID ${b.id}] DUPLICATE: "${b.name}" (${b.phone}) - Duplicate of ID ${b.duplicateOf}`);
    }
    for (const b of staleBookings) {
      console.log(`  · [ID ${b.id}] STALE (>30d): "${b.name}" (${b.phone}) - Created ${b.createdAt.toISOString()}`);
    }

    // ==========================================
    // 3. CALLBACK REQUESTS
    // ==========================================
    console.log("\n>>> Auditing 'callback_requests' table");
    const [callbacksRaw] = await conn.execute(
      "SELECT id, name, phone, context, status, createdAt FROM callback_requests"
    );
    const callbacks = callbacksRaw as any[];
    
    const fakeCallbacks: any[] = [];
    const duplicateCallbacks: any[] = [];
    const staleCallbacks: any[] = [];
    const processedCallbackIds = new Set<number>();

    for (const c of callbacks) {
      const fakeReason = isFakePattern(c.name, c.phone, c.context);
      if (fakeReason) {
        fakeCallbacks.push({ ...c, reason: fakeReason });
      }
    }

    const sortedCallbacks = [...callbacks].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (let i = 0; i < sortedCallbacks.length; i++) {
      const callbackA = sortedCallbacks[i];
      if (processedCallbackIds.has(callbackA.id) || fakeCallbacks.some(f => f.id === callbackA.id)) continue;

      for (let j = i + 1; j < sortedCallbacks.length; j++) {
        const callbackB = sortedCallbacks[j];
        if (processedCallbackIds.has(callbackB.id) || fakeCallbacks.some(f => f.id === callbackB.id)) continue;

        const nameMatch = callbackA.name.toLowerCase().trim() === callbackB.name.toLowerCase().trim();
        const phoneMatch = callbackA.phone.replace(/\D/g, "") === callbackB.phone.replace(/\D/g, "");

        if (nameMatch && phoneMatch) {
          const timeDiffHours = Math.abs(callbackA.createdAt.getTime() - callbackB.createdAt.getTime()) / (1000 * 60 * 60);
          if (timeDiffHours <= 24) {
            duplicateCallbacks.push({ ...callbackB, duplicateOf: callbackA.id });
            processedCallbackIds.add(callbackB.id);
          }
        }
      }
    }

    for (const c of callbacks) {
      if (fakeCallbacks.some(f => f.id === c.id) || duplicateCallbacks.some(d => d.id === c.id)) continue;
      // For callbacks, we check if they are 'new' or 'pending' and older than 30 days
      if ((c.status === "new" || c.status === "pending") && c.createdAt < thirtyDaysAgo) {
        staleCallbacks.push(c);
      }
    }

    console.log(`Summary: Total Callbacks = ${callbacks.length} | Fake = ${fakeCallbacks.length} | Duplicates = ${duplicateCallbacks.length} | Stale New/Pending (>30d) = ${staleCallbacks.length}`);
    for (const c of fakeCallbacks) {
      console.log(`  · [ID ${c.id}] FAKE: "${c.name}" (${c.phone}) - Reason: ${c.reason}`);
    }
    for (const c of duplicateCallbacks) {
      console.log(`  · [ID ${c.id}] DUPLICATE: "${c.name}" (${c.phone}) - Duplicate of ID ${c.duplicateOf}`);
    }
    for (const c of staleCallbacks) {
      console.log(`  · [ID ${c.id}] STALE (>30d): "${c.name}" (${c.phone}) - Created ${c.createdAt.toISOString()}`);
    }

  } finally {
    await conn.end();
  }
}

main().catch(console.error);
