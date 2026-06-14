/**
 * Database maintenance script to audit and prune stale/fake leads, bookings, and callback requests.
 *
 * It classifies stale data into:
 *   - CLASS 1: Test / Fake entries (name/phone containing "test", "asdf", "555", repeating digits, etc.)
 *   - CLASS 2: Duplicate entries (identical name+phone created within 24h of each other)
 *   - CLASS 3: Stale "New" entries (status is "new" and older than 90 days)
 *
 * SAFETY: dry-run by default. Pass --commit to mutate.
 *
 * Usage:
 *   pnpm tsx scripts/maintenance/cleanup-stale-leads.ts          # dry run
 *   pnpm tsx scripts/maintenance/cleanup-stale-leads.ts --commit # mutate
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const COMMIT = process.argv.includes("--commit");

interface Row {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  status: string;
  createdAt: Date;
  details?: string | null;
}

// Masking helpers to prevent PII leakage in logs
const maskPhoneNum = (numString: string) => {
  const digits = numString.replace(/\D/g, "");
  return digits.length > 4 ? `***-***-${digits.slice(-4)}` : numString;
};

const maskPersonName = (fullName: string) => {
  const parts = fullName.split(" ");
  return parts.map(p => p.slice(0, 1) + ".").join(" ");
};

// Helper to identify obviously fake/test patterns
const isFakePattern = (name: string, phone: string, problemOrMessage: string | null) => {
  const n = name.toLowerCase();
  const p = (problemOrMessage || "").toLowerCase();
  const ph = phone.replace(/\D/g, "");

  // Test names/emails/problems
  if (
    n.includes("test") ||
    n.includes("asdf") ||
    n.includes("qwerty") ||
    n.includes("dummy") ||
    n.includes("demo") ||
    n.includes("foo bar") ||
    n === "foo" ||
    n === "bar" ||
    p.includes("this is a test") ||
    p.includes("test message")
  ) {
    return true;
  }

  // Fake/Test phone numbers
  if (
    ph.includes("5550100") ||
    ph.includes("5551234") ||
    ph.startsWith("555") ||
    ph.length < 7 ||
    /^(.)\1+$/.test(ph) || // repeating digits e.g. 1111111
    ph === "1234567890" ||
    ph === "0123456789"
  ) {
    return true;
  }

  return false;
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not configured.");
    process.exit(1);
  }

  console.log(`\n═══ Database Administration Cleanup & Pruning Audit ═══`);
  console.log(`Mode: ${COMMIT ? "🔴 COMMIT (mutating database)" : "🟢 DRY RUN (safe — pass --commit to mutate)"}\n`);

  const conn = await mysql.createConnection(url);
  try {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    // ==========================================
    // 1. LEADS CLEANUP
    // ==========================================
    console.log(`\n==========================================`);
    console.log(`>>> auditing 'leads' table`);
    console.log(`==========================================`);
    const [leadsRaw] = await conn.execute(
      `SELECT id, name, phone, email, problem as details, status, createdAt FROM leads`
    );
    const leads = leadsRaw as Row[];
    
    const fakeLeads: Row[] = [];
    const duplicateLeads: Row[] = [];
    const staleNewLeads: Row[] = [];
    const processedLeadIds = new Set<number>();

    for (const l of leads) {
      if (isFakePattern(l.name, l.phone, l.details)) fakeLeads.push(l);
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
            duplicateLeads.push(leadB);
            processedLeadIds.add(leadB.id);
          }
        }
      }
    }

    for (const l of leads) {
      if (fakeLeads.some(f => f.id === l.id) || duplicateLeads.some(d => d.id === l.id)) continue;
      if (l.status === "new" && l.createdAt < ninetyDaysAgo) staleNewLeads.push(l);
    }

    console.log(`[Leads] Fake: ${fakeLeads.length} | Duplicate: ${duplicateLeads.length} | Stale New: ${staleNewLeads.length}`);
    for (const l of fakeLeads) {
      const pText = maskPhoneNum(l.phone);
      const nText = maskPersonName(l.name);
      console.log(`  · DELETE fake lead [ID:${l.id}]: ${nText} (${pText})`);
      if (COMMIT) await conn.execute(`DELETE FROM leads WHERE id = ?`, [l.id]);
    }
    for (const l of duplicateLeads) {
      const pText = maskPhoneNum(l.phone);
      const nText = maskPersonName(l.name);
      console.log(`  · DELETE duplicate lead [ID:${l.id}]: ${nText} (${pText})`);
      if (COMMIT) await conn.execute(`DELETE FROM leads WHERE id = ?`, [l.id]);
    }
    for (const l of staleNewLeads) {
      const pText = maskPhoneNum(l.phone);
      const nText = maskPersonName(l.name);
      console.log(`  · ARCHIVE (status->closed) stale lead [ID:${l.id}]: ${nText} (${pText}) - ${l.createdAt.toISOString().slice(0, 10)}`);
      if (COMMIT) {
        await conn.execute(
          `UPDATE leads SET status = 'closed', contacted = 0, contactNotes = '[SYSTEM: Closed as stale after 90d]' WHERE id = ?`,
          [l.id]
        );
      }
    }

    // ==========================================
    // 2. BOOKINGS CLEANUP
    // ==========================================
    console.log(`\n==========================================`);
    console.log(`>>> auditing 'bookings' table`);
    console.log(`==========================================`);
    const [bookingsRaw] = await conn.execute(
      `SELECT id, name, phone, email, message as details, status, createdAt FROM bookings`
    );
    const bookings = bookingsRaw as Row[];

    const fakeBookings: Row[] = [];
    const duplicateBookings: Row[] = [];
    const staleNewBookings: Row[] = [];
    const processedBookingIds = new Set<number>();

    for (const b of bookings) {
      if (isFakePattern(b.name, b.phone, b.details)) fakeBookings.push(b);
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
            duplicateBookings.push(bookingB);
            processedBookingIds.add(bookingB.id);
          }
        }
      }
    }

    for (const b of bookings) {
      if (fakeBookings.some(f => f.id === b.id) || duplicateBookings.some(d => d.id === b.id)) continue;
      if (b.status === "new" && b.createdAt < ninetyDaysAgo) staleNewBookings.push(b);
    }

    console.log(`[Bookings] Fake: ${fakeBookings.length} | Duplicate: ${duplicateBookings.length} | Stale New: ${staleNewBookings.length}`);
    for (const b of fakeBookings) {
      const pText = maskPhoneNum(b.phone);
      const nText = maskPersonName(b.name);
      console.log(`  · DELETE fake booking [ID:${b.id}]: ${nText} (${pText})`);
      if (COMMIT) await conn.execute(`DELETE FROM bookings WHERE id = ?`, [b.id]);
    }
    for (const b of duplicateBookings) {
      const pText = maskPhoneNum(b.phone);
      const nText = maskPersonName(b.name);
      console.log(`  · DELETE duplicate booking [ID:${b.id}]: ${nText} (${pText})`);
      if (COMMIT) await conn.execute(`DELETE FROM bookings WHERE id = ?`, [b.id]);
    }
    for (const b of staleNewBookings) {
      const pText = maskPhoneNum(b.phone);
      const nText = maskPersonName(b.name);
      console.log(`  · CANCEL stale booking [ID:${b.id}]: ${nText} (${pText}) - ${b.createdAt.toISOString().slice(0, 10)}`);
      if (COMMIT) {
        await conn.execute(
          `UPDATE bookings SET status = 'cancelled', adminNotes = '[SYSTEM: Cancelled as stale after 90d]' WHERE id = ?`,
          [b.id]
        );
      }
    }

    // ==========================================
    // 3. CALLBACK REQUESTS CLEANUP
    // ==========================================
    console.log(`\n==========================================`);
    console.log(`>>> auditing 'callback_requests' table`);
    console.log(`==========================================`);
    const [callbacksRaw] = await conn.execute(
      `SELECT id, name, phone, null as email, context as details, status, createdAt FROM callback_requests`
    );
    const callbacks = callbacksRaw as Row[];

    const fakeCallbacks: Row[] = [];
    const duplicateCallbacks: Row[] = [];
    const staleNewCallbacks: Row[] = [];
    const processedCallbackIds = new Set<number>();

    for (const c of callbacks) {
      if (isFakePattern(c.name, c.phone, c.details)) fakeCallbacks.push(c);
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
            duplicateCallbacks.push(callbackB);
            processedCallbackIds.add(callbackB.id);
          }
        }
      }
    }

    for (const c of callbacks) {
      if (fakeCallbacks.some(f => f.id === c.id) || duplicateCallbacks.some(d => d.id === c.id)) continue;
      if (c.status === "new" && c.createdAt < ninetyDaysAgo) staleNewCallbacks.push(c);
    }

    console.log(`[Callbacks] Fake: ${fakeCallbacks.length} | Duplicate: ${duplicateCallbacks.length} | Stale New: ${staleNewCallbacks.length}`);
    for (const c of fakeCallbacks) {
      const pText = maskPhoneNum(c.phone);
      const nText = maskPersonName(c.name);
      console.log(`  · DELETE fake callback [ID:${c.id}]: ${nText} (${pText})`);
      if (COMMIT) await conn.execute(`DELETE FROM callback_requests WHERE id = ?`, [c.id]);
    }
    for (const c of duplicateCallbacks) {
      const pText = maskPhoneNum(c.phone);
      const nText = maskPersonName(c.name);
      console.log(`  · DELETE duplicate callback [ID:${c.id}]: ${nText} (${pText})`);
      if (COMMIT) await conn.execute(`DELETE FROM callback_requests WHERE id = ?`, [c.id]);
    }
    for (const c of staleNewCallbacks) {
      const pText = maskPhoneNum(c.phone);
      const nText = maskPersonName(c.name);
      console.log(`  · UPDATE stale callback (status->no-answer) [ID:${c.id}]: ${nText} (${pText}) - ${c.createdAt.toISOString().slice(0, 10)}`);
      if (COMMIT) {
        await conn.execute(
          `UPDATE callback_requests SET status = 'no-answer', notes = '[SYSTEM: Closed as stale after 90d]' WHERE id = ?`,
          [c.id]
        );
      }
    }

    // ==========================================
    // SUMMARY
    // ==========================================
    console.log(`\n==========================================`);
    console.log(`═══ SUMMARY OF ACTIONS ═══`);
    console.log(`==========================================`);
    console.log(`Leads Table:`);
    console.log(`  · Fake Leads Deleted: ${fakeLeads.length}`);
    console.log(`  · Duplicate Leads Deleted: ${duplicateLeads.length}`);
    console.log(`  · Stale Leads Archived: ${staleNewLeads.length}`);
    console.log(`Bookings Table:`);
    console.log(`  · Fake Bookings Deleted: ${fakeBookings.length}`);
    console.log(`  · Duplicate Bookings Deleted: ${duplicateBookings.length}`);
    console.log(`  · Stale Bookings Cancelled: ${staleNewBookings.length}`);
    console.log(`Callback Requests Table:`);
    console.log(`  · Fake Callbacks Deleted: ${fakeCallbacks.length}`);
    console.log(`  · Duplicate Callbacks Deleted: ${duplicateCallbacks.length}`);
    console.log(`  · Stale Callbacks Completed/Closed: ${staleNewCallbacks.length}`);

    const totalDels = fakeLeads.length + duplicateLeads.length + fakeBookings.length + duplicateBookings.length + fakeCallbacks.length + duplicateCallbacks.length;
    const totalUpdates = staleNewLeads.length + staleNewBookings.length + staleNewCallbacks.length;

    console.log(`\nTotal Records Deleted: ${totalDels}`);
    console.log(`Total Records Updated/Archived: ${totalUpdates}`);

    if (!COMMIT) {
      console.log(`\n🟢 Dry run completed. Re-run this script with the --commit flag to apply the changes.`);
    } else {
      console.log(`\n✅ Database successfully updated and cleaned.`);
    }

  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("Crashed:", err);
  process.exit(1);
});
