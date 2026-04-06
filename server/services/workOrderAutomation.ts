/**
 * Work Order Automation — Eliminates manual status management.
 *
 * Auto-close: Stale WOs in picked_up/invoiced > 7 days → closed
 * Overdue detection: WOs past promisedAt without completion → Telegram alert
 * Booking → WO: Auto-create draft WOs from confirmed bookings
 * Estimate follow-up: Auto-SMS customers with unconverted estimates
 * Campaign auto-retry: Auto-send SMS campaign to eligible customers
 */

import { createLogger } from "../lib/logger";

const log = createLogger("wo-automation");

// ─── AUTO-CLOSE STALE WORK ORDERS ──────────────────────
// WOs in picked_up/invoiced for >7 days → auto-close
export async function autoCloseStaleWorkOrders(): Promise<{ recordsProcessed: number; details: string }> {
  try {
    const { getDb } = await import("../db");
    const { workOrders } = await import("../../drizzle/schema");
    const { sql, and, inArray } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0, details: "No DB" };

    // Find WOs in terminal-ish states for >7 days
    const stale = await db.select({
      id: workOrders.id,
      orderNumber: workOrders.orderNumber,
      status: workOrders.status,
    }).from(workOrders)
      .where(and(
        sql`${workOrders.status} IN ('picked_up', 'invoiced')`,
        sql`${workOrders.updatedAt} < DATE_SUB(NOW(), INTERVAL 7 DAY)`
      ))
      .limit(20);

    if (stale.length === 0) return { recordsProcessed: 0, details: "No stale WOs" };

    const { updateStatus } = await import("./workOrderService");
    let closed = 0;

    for (const wo of stale) {
      try {
        await updateStatus(wo.id, "closed", "system", {
          note: `Auto-closed: ${wo.status} for >7 days`,
        });
        closed++;
      } catch (err: any) {
        log.warn(`Auto-close failed for WO ${wo.orderNumber}: ${err.message}`);
      }
    }

    if (closed > 0) {
      const { sendTelegram } = await import("./telegram");
      await sendTelegram(
        `🔄 AUTO-CLOSE: ${closed} work orders auto-closed (${stale.map((w: any) => `WO#${w.orderNumber}`).join(", ")})`
      );
    }

    return { recordsProcessed: closed, details: `${closed} WOs auto-closed` };
  } catch (err: any) {
    log.error("Auto-close failed:", { error: err.message });
    return { recordsProcessed: 0, details: `Failed: ${err.message}` };
  }
}

// ─── OVERDUE WORK ORDER DETECTION ──────────────────────
// WOs past promisedAt that aren't completed → alert
export async function detectOverdueWorkOrders(): Promise<{ recordsProcessed: number; details: string }> {
  try {
    const { getDb } = await import("../db");
    const { workOrders } = await import("../../drizzle/schema");
    const { sql, and, notInArray } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0, details: "No DB" };

    const overdue = await db.select({
      id: workOrders.id,
      orderNumber: workOrders.orderNumber,
      status: workOrders.status,
      serviceDescription: workOrders.serviceDescription,
      promisedAt: workOrders.promisedAt,
      assignedTech: workOrders.assignedTech,
    }).from(workOrders)
      .where(and(
        sql`${workOrders.promisedAt} IS NOT NULL`,
        sql`${workOrders.promisedAt} < NOW()`,
        sql`${workOrders.status} NOT IN ('ready_for_pickup', 'customer_notified', 'picked_up', 'invoiced', 'closed', 'cancelled')`
      ))
      .limit(10);

    if (overdue.length === 0) return { recordsProcessed: 0, details: "No overdue WOs" };

    const { sendTelegram } = await import("./telegram");
    await sendTelegram(
      `⏰ OVERDUE WORK ORDERS: ${overdue.length}\n\n` +
      overdue.map((wo: any) => {
        const hrs = Math.round((Date.now() - new Date(wo.promisedAt!).getTime()) / 3600000);
        return `WO#${wo.orderNumber} — ${wo.serviceDescription?.slice(0, 40) || "N/A"} (${hrs}h late) [${wo.status}]${wo.assignedTech ? ` — Tech: ${wo.assignedTech}` : ""}`;
      }).join("\n") +
      `\n\n⚡ Call these customers or update promise times.`
    );

    return { recordsProcessed: overdue.length, details: `${overdue.length} overdue WOs alerted` };
  } catch (err: any) {
    log.error("Overdue detection failed:", { error: err.message });
    return { recordsProcessed: 0, details: `Failed: ${err.message}` };
  }
}

// ─── AUTO-CREATE WORK ORDER FROM BOOKING ───────────────
// Called from event bus when booking_created fires
export async function autoCreateWorkOrderFromBooking(data: {
  id: number;
  name: string;
  phone: string;
  service: string;
  vehicle?: string;
  urgency?: string;
}): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const { customers } = await import("../../drizzle/schema");
    const { like } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return;

    // Find or default customer
    let customerId = "walk-in";
    const phone10 = data.phone.replace(/\D/g, "").slice(-10);
    if (phone10.length === 10) {
      const [cust] = await db.select({ id: customers.id })
        .from(customers).where(like(customers.phone, `%${phone10}%`)).limit(1);
      if (cust) customerId = String(cust.id);
    }

    // Parse vehicle info
    let vehicleYear: number | undefined;
    let vehicleMake: string | undefined;
    let vehicleModel: string | undefined;
    if (data.vehicle) {
      const parts = data.vehicle.split(" ");
      const yearMatch = parts[0]?.match(/^\d{4}$/);
      if (yearMatch) {
        vehicleYear = parseInt(yearMatch[0], 10);
        vehicleMake = parts[1];
        vehicleModel = parts.slice(2).join(" ");
      }
    }

    const { createWorkOrder } = await import("./workOrderService");
    const wo = await createWorkOrder({
      customerId,
      vehicleYear,
      vehicleMake,
      vehicleModel,
      serviceDescription: data.service,
      customerComplaint: data.service,
      priority: data.urgency === "emergency" ? "urgent" : data.urgency === "this-week" ? "high" : "normal",
      source: "booking_auto",
      bookingId: data.id,
    });

    log.info(`Auto-created WO#${wo.orderNumber} from booking #${data.id}`);
  } catch (err: any) {
    // Don't throw — this is fire-and-forget from event bus
    log.warn(`Auto WO creation failed for booking #${data.id}: ${err.message}`);
  }
}

// ─── ESTIMATE FOLLOW-UP ────────────────────────────────
// Follow up on estimates not converted to work orders after 2 days
export async function processEstimateFollowUp(): Promise<{ recordsProcessed: number; details: string }> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0, details: "No DB" };

    // Find estimates from 2-3 days ago that don't have a linked work order
    const [rows] = await db.execute(sql`
      SELECT e.id, e.customerName, e.customerPhone, e.vehicleInfo, e.serviceType, e.totalEstimate
      FROM estimates e
      LEFT JOIN work_orders wo ON wo.estimateId = e.id
      WHERE wo.id IS NULL
        AND e.createdAt BETWEEN DATE_SUB(NOW(), INTERVAL 3 DAY) AND DATE_SUB(NOW(), INTERVAL 2 DAY)
        AND e.customerPhone IS NOT NULL
        AND e.followUpSent = 0
      LIMIT 10
    `);

    const estimates = rows as any[];
    if (!estimates || estimates.length === 0) return { recordsProcessed: 0, details: "No estimates to follow up" };

    const { sendSms } = await import("../sms");
    let sent = 0;

    for (const est of estimates) {
      try {
        await sendSms(
          est.customerPhone,
          `Hi ${est.customerName || "there"}, following up on your estimate for ${est.serviceType || "auto service"} ($${est.totalEstimate || "see estimate"}). ` +
          `Ready to schedule? Call (216) 862-0005 or book at nickstire.org. We also offer financing! — Nick's Tire & Auto`
        );

        // Mark as followed up
        await db.execute(sql`UPDATE estimates SET followUpSent = 1 WHERE id = ${est.id}`);
        sent++;
        // 1.5s delay between sends
        await new Promise(r => setTimeout(r, 1500));
      } catch {
        log.warn(`Estimate follow-up SMS failed for ${est.customerName}`);
      }
    }

    return { recordsProcessed: sent, details: `${sent} estimate follow-ups sent` };
  } catch (err: any) {
    // Table might not have followUpSent column yet — graceful fail
    if (err.message?.includes("followUpSent") || err.message?.includes("Unknown column")) {
      return { recordsProcessed: 0, details: "followUpSent column not yet added — skipping" };
    }
    return { recordsProcessed: 0, details: `Failed: ${err.message}` };
  }
}

// ─── SMS CAMPAIGN AUTO-RETRY ───────────────────────────
// Auto-send SMS campaign to eligible untexted customers (was manual retryCampaign)
export async function autoCampaignRetry(): Promise<{ recordsProcessed: number; details: string }> {
  try {
    const { getDb } = await import("../db");
    const { customers } = await import("../../drizzle/schema");
    const { sql, eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0, details: "No DB" };

    const STORE_PHONE = "(216) 862-0005";
    const REVIEW_URL = "nickstire.org/review";
    const REFER_URL = "nickstire.org/refer";

    // Get eligible customers: not yet texted, not opted out, valid phone
    const untexted = await db.select()
      .from(customers)
      .where(sql`${customers.smsCampaignSent} = 0 AND ${customers.smsOptOut} = 0 AND ${customers.phone} IS NOT NULL AND LENGTH(${customers.phone}) >= 10 AND ${customers.phone} LIKE '+1%'`)
      .orderBy(sql`CASE ${customers.segment} WHEN 'recent' THEN 0 WHEN 'lapsed' THEN 1 ELSE 2 END, ${customers.lastVisitDate} DESC`)
      .limit(25); // Smaller batches for auto — runs daily, catches up over time

    if (untexted.length === 0) return { recordsProcessed: 0, details: "All customers texted" };

    const { sendSms } = await import("../sms");
    let sent = 0;

    for (const c of untexted) {
      const name = c.firstName || "there";
      const msg = c.segment === "lapsed"
        ? `Hi ${name}, this is Nick's Tire & Auto. Thank you for trusting us with your vehicle!\n\nA quick Google review means a lot to us:\n${REVIEW_URL}\n\nRefer a friend: ${REFER_URL}\nWe'd love to see you again. — Nick's Team ${STORE_PHONE}`
        : `Hi ${name}, thank you for choosing Nick's Tire & Auto! We truly appreciate your business.\n\nGot 30 sec? A Google review helps other Cleveland drivers find honest repair:\n${REVIEW_URL}\n\nRefer a friend: ${REFER_URL}\n— Nick's Team ${STORE_PHONE}`;

      const result = await sendSms(c.phone, msg);
      if (result.success) {
        sent++;
        await db.update(customers)
          .set({ smsCampaignSent: 1, smsCampaignDate: new Date() } as any)
          .where(eq(customers.id, c.id));
      }

      // 1.5s delay between sends
      await new Promise(r => setTimeout(r, 1500));
    }

    if (sent > 0) {
      const { sendTelegram } = await import("./telegram");
      await sendTelegram(`📱 AUTO CAMPAIGN: ${sent}/${untexted.length} review+referral texts sent automatically.`);
    }

    return { recordsProcessed: sent, details: `${sent} campaign SMS auto-sent` };
  } catch (err: any) {
    log.error("Auto campaign retry failed:", { error: err.message });
    return { recordsProcessed: 0, details: `Failed: ${err.message}` };
  }
}

// ─── AUTO-ENROLL DRIP CAMPAIGNS ────────────────────────
// Enroll customers into drip campaigns based on events
export async function enrollInDripCampaign(
  trigger: "post-service" | "new-customer" | "at-risk" | "declined-estimate",
  customer: { phone: string; name: string; vehicle?: string; service?: string }
): Promise<void> {
  try {
    const { getCampaignByTrigger, personalizeMessage } = await import("./dripCampaigns");
    const campaign = getCampaignByTrigger(trigger);
    if (!campaign || !campaign.steps[0]) return;

    const step = campaign.steps[0];
    if (step.delayDays > 0) return; // Only send immediate steps here, scheduled ones need DB

    const { sendSms } = await import("../sms");
    const msg = personalizeMessage(step.messageTemplate, {
      firstName: customer.name.split(" ")[0] || "there",
      vehicle: customer.vehicle || "vehicle",
      service: customer.service || "auto service",
      referralCode: customer.phone.slice(-4),
    });

    await sendSms(customer.phone, msg);
    log.info(`Drip enrolled: ${customer.name} → ${campaign.name} (step 1 sent)`);
  } catch (err: any) {
    log.warn(`Drip enrollment failed: ${err.message}`);
  }
}
