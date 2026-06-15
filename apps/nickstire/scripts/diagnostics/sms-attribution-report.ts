/**
 * sms-attribution-report.ts — wave-181.51 (backfill / historical mode)
 *
 * BACKFILL TOOL. The going-forward attribution path is the schema +
 * tRPC + admin widget shipped in wave-181.51:
 *   - sms_messages.{convertedCount,attributedBookingId,attributedAt}
 *   - server/services/smsInstrumentation.ts
 *   - server/routers/smsPerformance.ts
 *   - admin /admin → SmsPerformanceSection
 *
 * This standalone script does retrospective attribution by body-keyword
 * sniffing instead of by the new column data. Useful for:
 *   - Reporting on PRE wave-181.51 sends (columns didn't exist then)
 *   - Quick ad-hoc terminal queries without using the admin UI
 *   - One-shot re-attribution after manual data cleanup
 *
 * For ongoing/realtime SMS performance use the admin widget, not this.
 *
 * Tier classification is body-keyword based. wave-181.46+ copy has
 * distinctive phrases per tier. Pre-181.46 sends fall into "legacy" buckets.
 *
 * Run from repo root:
 *   DOTENV_CONFIG_PATH=.env node \
 *     node_modules/.pnpm/tsx@4.22.1/node_modules/tsx/dist/cli.mjs \
 *     apps/nickstire/scripts/sms-attribution-report.ts
 *
 * Env:
 *   SMS_ATTRIBUTION_DAYS=30   window size to scan (default 30)
 *   SMS_ATTRIBUTION_LOOKAHEAD=14   conversion window per SMS (default 14)
 */
import "dotenv/config";
import { getDb } from "../../server/db";
import { smsMessages, smsConversations, bookings, leads } from "../../drizzle/schema";
import { and, gte, lt, eq, sql } from "drizzle-orm";

const WINDOW_DAYS = parseInt(process.env.SMS_ATTRIBUTION_DAYS || "30", 10);
const LOOKAHEAD_DAYS = parseInt(process.env.SMS_ATTRIBUTION_LOOKAHEAD || "14", 10);

interface TierClassifier {
  key: string;
  label: string;
  match: (body: string) => boolean;
}

// Order matters — first match wins. More specific patterns first.
const CLASSIFIERS: TierClassifier[] = [
  { key: "declined_d7",  label: "Declined-recovery · 7-day",  match: (b) => /still good this week/i.test(b) },
  { key: "declined_d30", label: "Declined-recovery · 30-day", match: (b) => /been a month since we quoted/i.test(b) },
  { key: "retention_d7",   label: "Retention · D7 check-in",         match: (b) => /quick check-in.*after the work/i.test(b) },
  { key: "retention_d14",  label: "Retention · D14 reactivation",    match: (b) => /2 weeks since your/i.test(b) },
  { key: "retention_d45",  label: "Retention · D45 maintenance",     match: (b) => /is about due for an oil change/i.test(b) },
  { key: "retention_d90",  label: "Retention · D90 check-up",        match: (b) => /haven't seen your.*in 3 months/i.test(b) },
  { key: "retention_d180", label: "Retention · D180 reactivation",   match: (b) => /6 months since your/i.test(b) },
  { key: "retention_d365", label: "Retention · D365 anniversary",    match: (b) => /earned a check-up/i.test(b) },
  { key: "cross_sell",     label: "Cross-sell · service-due",        match: (b) => /based on your last check-up/i.test(b) },
  // Legacy buckets (pre wave-181.46 copy)
  { key: "legacy_retention",      label: "Retention · legacy copy",  match: (b) => /it's been a while|been .* months|deserves some attention/i.test(b) },
  { key: "legacy_declined",       label: "Declined · legacy copy",   match: (b) => /still on the fence|honor the quote/i.test(b) },
  { key: "legacy_cross_sell",     label: "Cross-sell · legacy copy", match: (b) => /might be time for/i.test(b) },
];

function classify(body: string): { key: string; label: string } {
  for (const c of CLASSIFIERS) {
    if (c.match(body)) return { key: c.key, label: c.label };
  }
  return { key: "unclassified", label: "Unclassified" };
}

interface TierStats {
  label: string;
  sent: number;
  converted: number;
}

async function main(): Promise<void> {
  const db = await getDb();
  if (!db) { console.error("DB unavailable"); process.exit(1); }

  const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const windowEnd = new Date();

  console.log("═══ SMS ATTRIBUTION REPORT ═══");
  console.log(`Window: last ${WINDOW_DAYS} days · conversion lookahead: ${LOOKAHEAD_DAYS} days post-send\n`);

  // 1. Pull all outbound SMS in the window with the customer phone
  type Row = { id: number; body: string; createdAt: Date; phone: string };
  const outboundRows: Row[] = await db
    .select({
      id: smsMessages.id,
      body: smsMessages.body,
      createdAt: smsMessages.createdAt,
      phone: smsConversations.phone,
    })
    .from(smsMessages)
    .innerJoin(smsConversations, eq(smsMessages.conversationId, smsConversations.id))
    .where(and(
      eq(smsMessages.direction, "outbound"),
      gte(smsMessages.createdAt, windowStart),
      lt(smsMessages.createdAt, windowEnd),
    ));

  console.log(`Outbound sends found: ${outboundRows.length}`);

  if (outboundRows.length === 0) {
    console.log("No sends in window. Nothing to attribute.");
    process.exit(0);
  }

  // 2. Get every distinct phone we sent to + every booking/lead created
  // in the broader window (sent_at to now + lookahead). Bulk-fetch beats
  // per-row queries.
  const phones = [...new Set(outboundRows.map((r) => normalizePhone(r.phone)).filter(Boolean))];
  if (phones.length === 0) { console.log("No usable phones."); process.exit(0); }

  // bookings — keyed by phone
  const bookingRows = await db
    .select({ phone: bookings.phone, createdAt: bookings.createdAt })
    .from(bookings)
    .where(gte(bookings.createdAt, windowStart));
  const bookingsByPhone = new Map<string, Date[]>();
  for (const b of bookingRows) {
    const k = normalizePhone(b.phone);
    if (!k) continue;
    if (!bookingsByPhone.has(k)) bookingsByPhone.set(k, []);
    bookingsByPhone.get(k)!.push(b.createdAt);
  }

  // leads — keyed by phone (using the phone column on leads)
  const leadRows = await db
    .select({ phone: leads.phone, createdAt: leads.createdAt })
    .from(leads)
    .where(gte(leads.createdAt, windowStart));
  const leadsByPhone = new Map<string, Date[]>();
  for (const l of leadRows) {
    const k = normalizePhone(l.phone);
    if (!k) continue;
    if (!leadsByPhone.has(k)) leadsByPhone.set(k, []);
    leadsByPhone.get(k)!.push(l.createdAt);
  }

  // 3. For each send, check if any booking OR lead exists in the
  // [sent_at, sent_at + lookahead] window for the same phone.
  const stats = new Map<string, TierStats>();

  for (const r of outboundRows) {
    const c = classify(r.body);
    if (!stats.has(c.key)) stats.set(c.key, { label: c.label, sent: 0, converted: 0 });
    const s = stats.get(c.key)!;
    s.sent++;

    const phone = normalizePhone(r.phone);
    if (!phone) continue;

    const lookaheadEnd = new Date(r.createdAt.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const bookingsForPhone = bookingsByPhone.get(phone) || [];
    const leadsForPhone = leadsByPhone.get(phone) || [];

    const converted = [...bookingsForPhone, ...leadsForPhone].some(
      (t) => t > r.createdAt && t <= lookaheadEnd,
    );
    if (converted) s.converted++;
  }

  // 4. Render
  console.log("\n─── BY TIER ────────────────────────────────────────────────");
  const sorted = [...stats.entries()].sort((a, b) => b[1].sent - a[1].sent);
  let totalSent = 0;
  let totalConverted = 0;
  for (const [, s] of sorted) {
    const rate = s.sent > 0 ? Math.round((s.converted / s.sent) * 1000) / 10 : 0;
    const rateStr = `${rate}%`.padStart(6);
    console.log(`${s.label.padEnd(40)}  sent=${s.sent.toString().padStart(4)}  converted=${s.converted.toString().padStart(3)}  rate=${rateStr}`);
    totalSent += s.sent;
    totalConverted += s.converted;
  }
  console.log("─".repeat(60));
  const overallRate = totalSent > 0 ? Math.round((totalConverted / totalSent) * 1000) / 10 : 0;
  console.log(`${"TOTAL".padEnd(40)}  sent=${totalSent.toString().padStart(4)}  converted=${totalConverted.toString().padStart(3)}  rate=${overallRate.toString().padStart(5)}%`);

  // 5. Caveats footer
  console.log("\n─── NOTES ─────────────────────────────────────────────────");
  console.log("• 'converted' = any booking OR lead created from the same phone within");
  console.log(`  ${LOOKAHEAD_DAYS} days after the SMS was sent. NOT proof of causation; the customer`);
  console.log("  might have come in regardless. But a sustained lift over baseline IS");
  console.log("  signal that the SMS is contributing.");
  console.log("• Tier classification is body-keyword based. Pre-wave-181.46 sends fall");
  console.log("  into 'legacy_*' buckets. Compare new vs legacy tiers carefully — the");
  console.log("  copy changed, so the conversion rate may differ for that reason alone.");
  console.log("• 0 conversions in a tier might mean (a) the tier isn't actually sending");
  console.log("  (Twilio dead pre-wave-181.46; feature flags off), (b) the copy isn't");
  console.log("  driving visits, or (c) genuinely low send volume.");
}

function normalizePhone(p: string | null | undefined): string {
  if (!p) return "";
  return p.replace(/\D/g, "").slice(-10);
}

main().catch((err) => { console.error("FAIL:", err); process.exit(1); });
