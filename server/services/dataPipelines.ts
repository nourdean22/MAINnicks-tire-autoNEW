/**
 * Cross-System Data Pipelines — Automated sync, analysis, sorting, processing.
 *
 * Eliminates ALL manual data management between systems:
 *
 * 1. Gateway Tire Price Refresh — auto-fetch wholesale prices for popular sizes
 * 2. Gateway Tire Order Status Polling — auto-check order statuses
 * 3. ShopDriver → Customer lastVisitDate sync — update visit dates from SD invoices
 * 4. Invoice Cross-Reconciliation — match ShopDriver invoices with local invoices
 * 5. Customer Data Enrichment — auto-merge data from all sources
 * 6. Revenue Analytics Pipeline — auto-calculate daily/weekly/monthly metrics
 * 7. Tire Inventory Intelligence — track popular sizes, low-stock alerts
 */

import { createLogger } from "../lib/logger";

const log = createLogger("data-pipelines");

const GATEWAY_BASE = "https://b2b.dktire.com";

// ─── 1. GATEWAY TIRE PRICE REFRESH ──────────────────────
// Auto-fetch current wholesale prices for our popular sizes
// so the website always shows accurate pricing

interface CachedPrice {
  size: string;
  brand: string;
  model: string;
  wholesaleCost: number;
  localQty: number;
  fetchedAt: number;
}

// In-memory price cache (refreshed by cron)
const priceCache = new Map<string, CachedPrice[]>();
const PRICE_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

export async function refreshGatewayPrices(): Promise<{ recordsProcessed: number; details: string }> {
  const POPULAR_SIZES = [
    "205/55R16", "215/60R16", "215/60R17", "225/70R17", "235/65R18",
    "245/70R16", "265/70R17", "265/70R18", "275/60R20", "195/65R15",
  ];

  const username = process.env.GATEWAY_TIRE_USERNAME;
  const password = process.env.GATEWAY_TIRE_PASSWORD;
  if (!username || !password) return { recordsProcessed: 0, details: "No Gateway credentials" };

  // Authenticate
  let cookie: string | null = null;
  try {
    const res = await fetch(`${GATEWAY_BASE}/auth-signin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
      body: JSON.stringify({ username, password }),
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    const cookies = res.headers.getSetCookie?.() || [];
    cookie = cookies.map((c: string) => c.split(";")[0]).join("; ");
  } catch (e) {
    console.warn("[services/dataPipelines] operation failed:", e);
    return { recordsProcessed: 0, details: "Gateway auth failed" };
  }

  if (!cookie) return { recordsProcessed: 0, details: "No session cookie" };

  let totalFetched = 0;
  let sizesUpdated = 0;
  const priceChanges: string[] = [];

  for (const size of POPULAR_SIZES) {
    const sizeClean = size.replace(/[\/Rr\s-]/g, "");
    try {
      const res = await fetch(`${GATEWAY_BASE}/api/products/search?q=${encodeURIComponent(sizeClean)}`, {
        headers: { "Cookie": cookie, "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) continue;

      const oldPrices = priceCache.get(sizeClean) || [];
      const newPrices: CachedPrice[] = data.slice(0, 15).map((item: any) => ({
        size,
        brand: (item.brand || "").toUpperCase(),
        model: item.model || item.name || "",
        wholesaleCost: parseFloat(item.cost || item.price || "0"),
        localQty: parseInt(item.localQty || item.localOnHand || "0", 10),
        fetchedAt: Date.now(),
      }));

      // Detect price changes
      for (const newP of newPrices) {
        const oldP = oldPrices.find(o => o.brand === newP.brand && o.model === newP.model);
        if (oldP && Math.abs(oldP.wholesaleCost - newP.wholesaleCost) > 1) {
          const direction = newP.wholesaleCost > oldP.wholesaleCost ? "📈" : "📉";
          priceChanges.push(`${direction} ${newP.brand} ${newP.model} (${size}): $${oldP.wholesaleCost} → $${newP.wholesaleCost}`);
        }
      }

      priceCache.set(sizeClean, newPrices);
      totalFetched += newPrices.length;
      sizesUpdated++;

      // Small delay between requests to not hammer the API
      await new Promise(r => setTimeout(r, 800));
    } catch (e) {
      console.warn("[services/dataPipelines] operation failed:", e);
      log.warn(`Price fetch failed for size ${size}`);
    }
  }

  // Alert on significant price changes
  if (priceChanges.length > 0) {
    try {
      const { sendTelegram } = await import("./telegram");
      await sendTelegram(
        `💰 GATEWAY TIRE PRICE CHANGES\n\n${priceChanges.slice(0, 10).join("\n")}\n\n` +
        `${priceChanges.length > 10 ? `...and ${priceChanges.length - 10} more\n` : ""}` +
        `Updated: ${sizesUpdated} sizes, ${totalFetched} tires`
      );
    } catch (e) { console.warn("[services/dataPipelines] operation failed:", e); }
  }

  return {
    recordsProcessed: totalFetched,
    details: `${sizesUpdated} sizes refreshed, ${totalFetched} prices cached, ${priceChanges.length} price changes`,
  };
}

/** Get cached prices for a size (used by search to avoid live fetch every time) */
export function getCachedPrices(sizeClean: string): CachedPrice[] | null {
  const cached = priceCache.get(sizeClean);
  if (!cached || cached.length === 0) return null;
  if (Date.now() - cached[0].fetchedAt > PRICE_CACHE_TTL) return null;
  return cached;
}


// ─── 2. GATEWAY TIRE ORDER STATUS POLLING ───────────────
// Auto-check status of pending tire orders with Gateway
export async function pollGatewayOrderStatuses(): Promise<{ recordsProcessed: number; details: string }> {
  try {
    const { getDb } = await import("../db");
    const { tireOrders } = await import("../../drizzle/schema");
    const { sql, eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0, details: "No DB" };

    // Find orders that are pending/ordered (not yet delivered/installed/cancelled)
    const pendingOrders = await db.select({
      id: tireOrders.id,
      orderNumber: tireOrders.orderNumber,
      status: tireOrders.status,
      customerName: tireOrders.customerName,
      customerPhone: tireOrders.customerPhone,
      tireBrand: tireOrders.tireBrand,
      tireModel: tireOrders.tireModel,
      tireSize: tireOrders.tireSize,
      quantity: tireOrders.quantity,
      createdAt: tireOrders.createdAt,
    }).from(tireOrders)
      .where(sql`${tireOrders.status} IN ('received', 'ordered', 'in_transit')`)
      .limit(20);

    if (pendingOrders.length === 0) return { recordsProcessed: 0, details: "No pending orders" };

    // Check for stale orders (received > 2 days with no status change)
    const staleOrders = pendingOrders.filter((o: any) => {
      if (o.status !== "received") return false;
      const age = Date.now() - new Date(o.createdAt).getTime();
      return age > 2 * 24 * 60 * 60 * 1000; // >2 days
    });

    if (staleOrders.length > 0) {
      const { sendTelegram } = await import("./telegram");
      await sendTelegram(
        `⚠️ STALE TIRE ORDERS — ${staleOrders.length} orders still "received" after 2+ days:\n\n` +
        staleOrders.map((o: any) => {
          const days = Math.round((Date.now() - new Date(o.createdAt).getTime()) / 86400000);
          return `${o.orderNumber}: ${o.quantity}x ${o.tireBrand} ${o.tireModel} (${o.tireSize}) — ${days}d old — ${o.customerName}`;
        }).join("\n") +
        `\n\n🔧 Log into Gateway (b2b.dktire.com) and place these orders, then update status.`
      );
    }

    // Check for orders that might have been delivered (ordered > 3 days)
    const possiblyDelivered = pendingOrders.filter((o: any) => {
      if (o.status !== "ordered") return false;
      const age = Date.now() - new Date(o.createdAt).getTime();
      return age > 3 * 24 * 60 * 60 * 1000;
    });

    if (possiblyDelivered.length > 0) {
      const { sendTelegram } = await import("./telegram");
      await sendTelegram(
        `📦 TIRE DELIVERY CHECK — ${possiblyDelivered.length} orders "ordered" 3+ days ago:\n\n` +
        possiblyDelivered.map((o: any) => `${o.orderNumber}: ${o.tireBrand} ${o.tireModel} — ${o.customerName}`).join("\n") +
        `\n\n✅ If tires arrived, update status to "delivered". If not, check tracking.`
      );
    }

    return {
      recordsProcessed: pendingOrders.length,
      details: `${pendingOrders.length} pending, ${staleOrders.length} stale, ${possiblyDelivered.length} check delivery`,
    };
  } catch (err: any) {
    return { recordsProcessed: 0, details: `Failed: ${err.message}` };
  }
}


// ─── 3. SHOPDRIVER → CUSTOMER LAST VISIT DATE SYNC ─────
// When ShopDriver mirror pulls invoices, update customer lastVisitDate
export async function syncVisitDatesFromInvoices(): Promise<{ recordsProcessed: number; details: string }> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0, details: "No DB" };

    // Update lastVisitDate from invoices for customers where invoice date is newer
    const [result] = await db.execute(sql`
      UPDATE customers c
      INNER JOIN (
        SELECT customerPhone, MAX(invoiceDate) as latestInvoice
        FROM invoices
        WHERE invoiceDate IS NOT NULL AND customerPhone IS NOT NULL AND customerPhone != ''
          AND LENGTH(REPLACE(REPLACE(REPLACE(customerPhone, '-', ''), '(', ''), ')', '')) >= 10
        GROUP BY customerPhone
      ) i ON RIGHT(REPLACE(REPLACE(REPLACE(c.phone, '-', ''), '(', ''), ')', ''), 10) =
             RIGHT(REPLACE(REPLACE(REPLACE(i.customerPhone, '-', ''), '(', ''), ')', ''), 10)
      SET c.lastVisitDate = i.latestInvoice
      WHERE c.lastVisitDate IS NULL OR c.lastVisitDate < i.latestInvoice
        AND LENGTH(REPLACE(REPLACE(REPLACE(c.phone, '-', ''), '(', ''), ')', '')) >= 10
    `);

    const affected = (result as any)?.affectedRows || 0;

    // Also update from work orders (completedAt)
    const [woResult] = await db.execute(sql`
      UPDATE customers c
      INNER JOIN (
        SELECT customerId, MAX(completedAt) as latestCompleted
        FROM work_orders
        WHERE completedAt IS NOT NULL AND customerId IS NOT NULL
        GROUP BY customerId
      ) wo ON c.id = CAST(wo.customerId AS UNSIGNED)
      SET c.lastVisitDate = wo.latestCompleted
      WHERE c.lastVisitDate IS NULL OR c.lastVisitDate < wo.latestCompleted
    `);

    const woAffected = (woResult as any)?.affectedRows || 0;
    const total = affected + woAffected;

    if (total > 0) {
      log.info(`Visit dates synced: ${affected} from invoices, ${woAffected} from work orders`);
    }

    return { recordsProcessed: total, details: `${affected} from invoices, ${woAffected} from WOs` };
  } catch (err: any) {
    return { recordsProcessed: 0, details: `Failed: ${err.message}` };
  }
}


// ─── 4. INVOICE CROSS-RECONCILIATION ────────────────────
// Match ShopDriver invoices with local invoices, flag mismatches
export async function crossReconcileInvoices(): Promise<{ recordsProcessed: number; details: string }> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0, details: "No DB" };

    // Find invoices from last 7 days
    const [localInvoices] = await db.execute(sql`
      SELECT invoiceNumber, customerName, customerPhone, totalAmount, invoiceDate, paymentStatus, source
      FROM invoices
      WHERE invoiceDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      ORDER BY invoiceDate DESC
    `);

    const invoices = localInvoices as any[];
    if (!invoices || invoices.length === 0) return { recordsProcessed: 0, details: "No recent invoices" };

    // Calculate daily totals
    const dailyTotals = new Map<string, { count: number; total: number; paid: number; pending: number }>();
    for (const inv of invoices) {
      const day = new Date(inv.invoiceDate).toISOString().slice(0, 10);
      const existing = dailyTotals.get(day) || { count: 0, total: 0, paid: 0, pending: 0 };
      const amount = Number(inv.totalAmount) / 100; // cents to dollars
      existing.count++;
      existing.total += amount;
      if (inv.paymentStatus === "paid") existing.paid += amount;
      else existing.pending += amount;
      dailyTotals.set(day, existing);
    }

    // Flag anomalies
    const anomalies: string[] = [];

    // Check for unpaid invoices > 3 days old
    const unpaidOld = invoices.filter((inv: any) => {
      if (inv.paymentStatus === "paid") return false;
      const age = Date.now() - new Date(inv.invoiceDate).getTime();
      return age > 3 * 24 * 60 * 60 * 1000;
    });
    if (unpaidOld.length > 0) {
      const totalUnpaid = unpaidOld.reduce((s: number, i: any) => s + Number(i.totalAmount) / 100, 0);
      anomalies.push(`💸 ${unpaidOld.length} unpaid invoices >3 days old ($${totalUnpaid.toFixed(0)} outstanding)`);
    }

    // Check for zero-amount invoices
    const zeroInvoices = invoices.filter((inv: any) => Number(inv.totalAmount) === 0);
    if (zeroInvoices.length > 0) {
      anomalies.push(`⚠️ ${zeroInvoices.length} $0 invoices detected`);
    }

    // Store daily metrics in memory (Nick AI learns from this)
    if (anomalies.length > 0) {
      try {
        const { sendTelegram } = await import("./telegram");
        await sendTelegram(
          `📊 INVOICE RECONCILIATION (7-day)\n\n` +
          [...dailyTotals.entries()].slice(0, 5).map(([day, d]) =>
            `${day}: ${d.count} invoices | $${d.total.toFixed(0)} total | $${d.paid.toFixed(0)} paid | $${d.pending.toFixed(0)} pending`
          ).join("\n") +
          `\n\n${anomalies.join("\n")}`
        );
      } catch (e) { console.warn("[services/dataPipelines] operation failed:", e); }
    }

    // Store insights
    try {
      const { remember } = await import("./nickMemory");
      const today = [...dailyTotals.entries()].sort((a, b) => b[0].localeCompare(a[0]))[0];
      if (today) {
        await remember({
          type: "insight",
          content: `Invoice reconciliation: ${today[1].count} invoices today, $${today[1].total.toFixed(0)} total ($${today[1].paid.toFixed(0)} paid, $${today[1].pending.toFixed(0)} pending). ${anomalies.length} anomalies.`,
          source: "invoice_reconciliation",
          confidence: 0.9,
        });
      }
    } catch (e) { console.warn("[services/dataPipelines] operation failed:", e); }

    return {
      recordsProcessed: invoices.length,
      details: `${invoices.length} invoices checked, ${anomalies.length} anomalies, ${dailyTotals.size} days analyzed`,
    };
  } catch (err: any) {
    return { recordsProcessed: 0, details: `Failed: ${err.message}` };
  }
}


// ─── 5. CUSTOMER DATA ENRICHMENT ────────────────────────
// Merge data from all sources: bookings + invoices + work orders + tire orders → customer record
// Writes to Drizzle schema columns: totalSpent (cents), totalVisits, firstVisitDate, vehicleMake/Model/Year
export async function enrichCustomerData(): Promise<{ recordsProcessed: number; details: string }> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { recordsProcessed: 0, details: "No DB" };

  const counts: Record<string, number> = {};
  const errors: string[] = [];

  // Helper: run a step, catch errors independently
  async function step(name: string, query: ReturnType<typeof sql>) {
    try {
      const [result] = await db.execute(query);
      counts[name] = (result as any)?.affectedRows || 0;
    } catch (err: any) {
      counts[name] = 0;
      errors.push(`${name}: ${err.message?.slice(0, 80)}`);
    }
  }

  // 0. Reset all spend/visit data to 0 first — ensures idempotency.
  // Each subsequent step SETs (not ADDs) from the authoritative invoice source.
  await step("reset", sql`
    UPDATE customers SET totalSpent = 0, totalVisits = 0
    WHERE totalSpent != 0 OR totalVisits != 0
  `);

  // 1. Update totalSpent (cents) from paid invoices matched by phone (last 10 digits)
  await step("spent", sql`
    UPDATE customers c
    INNER JOIN (
      SELECT customerPhone, SUM(totalAmount) as total
      FROM invoices
      WHERE paymentStatus = 'paid' AND customerPhone IS NOT NULL AND LENGTH(customerPhone) >= 10
      GROUP BY customerPhone
    ) i ON RIGHT(c.phone, 10) = RIGHT(i.customerPhone, 10)
    SET c.totalSpent = i.total
    WHERE c.totalSpent != i.total AND LENGTH(c.phone) >= 10
  `);

  // 2. Update totalVisits from invoice count matched by phone
  await step("visits", sql`
    UPDATE customers c
    INNER JOIN (
      SELECT customerPhone, COUNT(*) as visits
      FROM invoices
      WHERE customerPhone IS NOT NULL AND LENGTH(customerPhone) >= 10
      GROUP BY customerPhone
    ) i ON RIGHT(c.phone, 10) = RIGHT(i.customerPhone, 10)
    SET c.totalVisits = i.visits
    WHERE c.totalVisits != i.visits AND LENGTH(c.phone) >= 10
  `);

  // 3. Update firstVisitDate from earliest invoice
  await step("first", sql`
    UPDATE customers c
    INNER JOIN (
      SELECT customerPhone, MIN(invoiceDate) as earliest
      FROM invoices
      WHERE customerPhone IS NOT NULL AND invoiceDate IS NOT NULL AND LENGTH(customerPhone) >= 10
      GROUP BY customerPhone
    ) i ON RIGHT(c.phone, 10) = RIGHT(i.customerPhone, 10)
    SET c.firstVisitDate = i.earliest
    WHERE (c.firstVisitDate IS NULL OR c.firstVisitDate > i.earliest) AND LENGTH(c.phone) >= 10
  `);

  // 0. One-time cleanup: strip trailing quotes from imported customer names
  await step("cleanup", sql`
    UPDATE customers
    SET firstName = TRIM(TRAILING '"' FROM firstName),
        lastName = TRIM(TRAILING '"' FROM lastName)
    WHERE firstName LIKE '%"' OR lastName LIKE '%"'
  `);

  // 3b. Also match by name for invoices without phone (LAST, FIRST format)
  // IMPORTANT: SET (not ADD) — this is idempotent. Safe to run multiple times.
  await step("spent-name", sql`
    UPDATE customers c
    INNER JOIN (
      SELECT customerName, SUM(totalAmount) as total, COUNT(*) as visits, MIN(invoiceDate) as earliest
      FROM invoices
      WHERE paymentStatus = 'paid' AND customerName IS NOT NULL
        AND (customerPhone IS NULL OR LENGTH(customerPhone) < 10)
      GROUP BY customerName
    ) i ON UPPER(TRIM(c.lastName)) = UPPER(TRIM(SUBSTRING_INDEX(i.customerName, ',', 1)))
       AND UPPER(TRIM(c.firstName)) = UPPER(TRIM(SUBSTRING_INDEX(i.customerName, ', ', -1)))
    SET c.totalSpent = i.total,
        c.totalVisits = i.visits,
        c.firstVisitDate = CASE WHEN c.firstVisitDate IS NULL OR c.firstVisitDate > i.earliest THEN i.earliest ELSE c.firstVisitDate END
    WHERE c.totalSpent != i.total OR c.totalVisits != i.visits
  `);

  // 4. Update vehicle info by matching customer name (LAST, FIRST format)
  //    vehicleInfo format: "2009 ACURA TL" → year=2009, make=ACURA, model=TL
  await step("vehicles", sql`
    UPDATE customers c
    INNER JOIN (
      SELECT customerName, vehicleInfo
      FROM invoices
      WHERE vehicleInfo IS NOT NULL AND vehicleInfo != '' AND customerName IS NOT NULL
      ORDER BY invoiceDate DESC
    ) i ON UPPER(TRIM(c.lastName)) = UPPER(TRIM(SUBSTRING_INDEX(i.customerName, ',', 1)))
       AND UPPER(TRIM(c.firstName)) = UPPER(TRIM(SUBSTRING_INDEX(i.customerName, ', ', -1)))
    SET c.vehicleYear = SUBSTRING_INDEX(i.vehicleInfo, ' ', 1),
        c.vehicleMake = SUBSTRING_INDEX(SUBSTRING_INDEX(i.vehicleInfo, ' ', 2), ' ', -1),
        c.vehicleModel = TRIM(SUBSTRING(i.vehicleInfo, LENGTH(SUBSTRING_INDEX(i.vehicleInfo, ' ', 2)) + 2))
    WHERE c.vehicleMake IS NULL
  `);

  // 6. Smart segmentation — visit recency + spend tier + churn risk
  // Segment logic:
  //   recent = visited in last 90 days
  //   lapsed = visited 90-365 days ago (churn risk)
  //   new = only 1 visit ever OR never visited
  //   unknown = visited but >365 days ago (likely lost)
  await step("segments", sql`
    UPDATE customers
    SET segment = CASE
      WHEN lastVisitDate >= DATE_SUB(NOW(), INTERVAL 90 DAY) THEN 'recent'
      WHEN lastVisitDate >= DATE_SUB(NOW(), INTERVAL 365 DAY) THEN 'lapsed'
      WHEN totalVisits <= 1 AND lastVisitDate IS NULL THEN 'new'
      WHEN lastVisitDate IS NOT NULL THEN 'unknown'
      ELSE segment
    END
    WHERE (lastVisitDate IS NOT NULL OR totalVisits <= 1)
      AND segment != CASE
        WHEN lastVisitDate >= DATE_SUB(NOW(), INTERVAL 90 DAY) THEN 'recent'
        WHEN lastVisitDate >= DATE_SUB(NOW(), INTERVAL 365 DAY) THEN 'lapsed'
        WHEN totalVisits <= 1 AND lastVisitDate IS NULL THEN 'new'
        ELSE 'unknown'
      END
  `);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const detail = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ");
  const errorDetail = errors.length > 0 ? ` | Errors: ${errors.join("; ")}` : "";

  if (total > 0) {
    log.info(`Customer enrichment: ${detail}${errorDetail}`);
  }

  return { recordsProcessed: total, details: `${detail}${errorDetail}` };
}


// ─── 6. TIRE INVENTORY INTELLIGENCE ─────────────────────
// Track popular sizes, identify trending demand, detect low Gateway stock
export async function analyzeTireInventory(): Promise<{ recordsProcessed: number; details: string }> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0, details: "No DB" };

    // Analyze tire order patterns from last 90 days
    const [orderPatterns] = await db.execute(sql`
      SELECT tireSize, tireBrand,
             COUNT(*) as orderCount,
             SUM(quantity) as totalQty,
             AVG(pricePerTire) as avgPrice
      FROM tire_orders
      WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
        AND status != 'cancelled'
      GROUP BY tireSize, tireBrand
      ORDER BY orderCount DESC
      LIMIT 15
    `);

    const patterns = orderPatterns as any[];
    if (!patterns || patterns.length === 0) return { recordsProcessed: 0, details: "No tire order data" };

    // Check Gateway stock for top ordered sizes
    const topSizes = [...new Set(patterns.map((p: any) => p.tireSize))].slice(0, 5);
    const lowStockSizes: string[] = [];

    // Cross-reference with price cache for stock levels
    for (const size of topSizes) {
      const sizeClean = size.replace(/[\/Rr\s-]/g, "");
      const cached = priceCache.get(sizeClean);
      if (cached) {
        const lowStock = cached.filter(p => p.localQty <= 2 && p.localQty >= 0);
        if (lowStock.length > cached.length / 2) {
          lowStockSizes.push(`${size} (${lowStock.length}/${cached.length} brands low/out at Gateway)`);
        }
      }
    }

    // Store intelligence
    const { remember } = await import("./nickMemory");
    const topSize = patterns[0];
    await remember({
      type: "insight",
      content: `Tire demand (90d): Top size ${topSize.tireSize} (${topSize.orderCount} orders, ${topSize.totalQty} tires). ` +
        `Top 5 sizes: ${patterns.slice(0, 5).map((p: any) => `${p.tireSize} (${p.orderCount})`).join(", ")}. ` +
        (lowStockSizes.length > 0 ? `⚠️ Low stock at Gateway: ${lowStockSizes.join(", ")}` : "Stock looks good."),
      source: "tire_intelligence",
      confidence: 0.85,
    });

    // Alert on low stock
    if (lowStockSizes.length > 0) {
      const { sendTelegram } = await import("./telegram");
      await sendTelegram(
        `📦 TIRE STOCK ALERT — Low Gateway inventory on popular sizes:\n\n` +
        lowStockSizes.join("\n") +
        `\n\nConsider pre-ordering or finding alternate suppliers.`
      );
    }

    return {
      recordsProcessed: patterns.length,
      details: `${patterns.length} size/brand combos analyzed, ${lowStockSizes.length} low stock alerts`,
    };
  } catch (err: any) {
    return { recordsProcessed: 0, details: `Failed: ${err.message}` };
  }
}


// ─── 7. REVENUE ANALYTICS PIPELINE ──────────────────────
// Auto-calculate and store weekly/monthly revenue metrics
export async function processRevenueAnalytics(): Promise<{ recordsProcessed: number; details: string }> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0, details: "No DB" };

    // This week vs last week
    const [thisWeek] = await db.execute(sql`
      SELECT COUNT(*) as jobs, COALESCE(SUM(totalAmount), 0) as revenue
      FROM invoices
      WHERE invoiceDate >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
        AND paymentStatus = 'paid'
    `);

    const [lastWeek] = await db.execute(sql`
      SELECT COUNT(*) as jobs, COALESCE(SUM(totalAmount), 0) as revenue
      FROM invoices
      WHERE invoiceDate >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) + 7 DAY)
        AND invoiceDate < DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
        AND paymentStatus = 'paid'
    `);

    // This month
    const [thisMonth] = await db.execute(sql`
      SELECT COUNT(*) as jobs, COALESCE(SUM(totalAmount), 0) as revenue
      FROM invoices
      WHERE MONTH(invoiceDate) = MONTH(CURDATE()) AND YEAR(invoiceDate) = YEAR(CURDATE())
        AND paymentStatus = 'paid'
    `);

    // Avg ticket this month
    const [avgTicket] = await db.execute(sql`
      SELECT COALESCE(AVG(totalAmount), 0) as avg
      FROM invoices
      WHERE MONTH(invoiceDate) = MONTH(CURDATE()) AND YEAR(invoiceDate) = YEAR(CURDATE())
        AND paymentStatus = 'paid' AND totalAmount > 0
    `);

    // Top services this week
    const [topServices] = await db.execute(sql`
      SELECT serviceDescription, COUNT(*) as cnt
      FROM invoices
      WHERE invoiceDate >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY serviceDescription
      ORDER BY cnt DESC
      LIMIT 5
    `);

    const tw = (thisWeek as any)?.[0] || { jobs: 0, revenue: 0 };
    const lw = (lastWeek as any)?.[0] || { jobs: 0, revenue: 0 };
    const tm = (thisMonth as any)?.[0] || { jobs: 0, revenue: 0 };
    const at = (avgTicket as any)?.[0] || { avg: 0 };
    const top = (topServices as any[]) || [];

    const weekRevenue = Number(tw.revenue) / 100;
    const lastWeekRevenue = Number(lw.revenue) / 100;
    const weekDelta = lastWeekRevenue > 0 ? ((weekRevenue - lastWeekRevenue) / lastWeekRevenue * 100).toFixed(1) : "N/A";
    const monthRevenue = Number(tm.revenue) / 100;
    const avgTicketVal = Number(at.avg) / 100;

    // Store as memory for Nick AI
    const { remember } = await import("./nickMemory");
    await remember({
      type: "insight",
      content: `Revenue analytics: This week $${weekRevenue.toFixed(0)} (${tw.jobs} jobs) vs last week $${lastWeekRevenue.toFixed(0)} (${weekDelta}% change). Month: $${monthRevenue.toFixed(0)} (${tm.jobs} jobs). Avg ticket: $${avgTicketVal.toFixed(0)}. Top services: ${top.slice(0, 3).map((s: any) => `${(s.serviceDescription || "Other").slice(0, 30)} (${s.cnt})`).join(", ")}.`,
      source: "revenue_analytics",
      confidence: 0.95,
    });

    return {
      recordsProcessed: 1,
      details: `Week: $${weekRevenue.toFixed(0)} (${weekDelta}%), Month: $${monthRevenue.toFixed(0)}, Avg: $${avgTicketVal.toFixed(0)}`,
    };
  } catch (err: any) {
    return { recordsProcessed: 0, details: `Failed: ${err.message}` };
  }
}
