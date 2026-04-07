#!/usr/bin/env node
/**
 * Local script to parse ShopDriver report files and POST to Railway.
 * Run: node scripts/ingest-reports.mjs
 */

import { readFileSync } from "fs";
import { resolve } from "path";

const BRIDGE_URL = "https://mainnicks-tire-auto-production.up.railway.app/api/bridge/ingest-reports";
const BRIDGE_KEY = "9684ba24cfa0400b8e21c79f467536d8335777caf54371420017e5c089ed7c44";

const DESKTOP = process.env.USERPROFILE
  ? resolve(process.env.USERPROFILE, "OneDrive", "Desktop")
  : resolve(process.env.HOME || ".", "OneDrive", "Desktop");

// ─── File paths ────────────────────────────────────────
const FILES = {
  totalSales: resolve(DESKTOP, "4626TTLSLS.txt"),
  techSales: resolve(DESKTOP, "4626TECHSLSRPT.txt"),
  laborSales: resolve(DESKTOP, "4626TLBRSLS.txt"),
  partsSales: resolve(DESKTOP, "4626TTLPTSSLS.txt"),
};

// ─── Parsers (inline, no TS deps) ──────────────────────

function parseDollars(raw) {
  if (!raw) return 0;
  const num = parseFloat(raw.replace(/[$,\s]/g, ""));
  return isNaN(num) ? 0 : Math.round(num * 100);
}

function titleCase(str) {
  if (!str) return "";
  if (str.startsWith("@")) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function normalizeName(raw) {
  if (!raw || raw.trim() === "" || raw.trim() === "-")
    return { firstName: "Unknown", lastName: "", normalized: "Unknown" };
  let name = raw.trim().replace(/"/g, "").replace(/\s+/g, " ");
  if (name.includes(",")) {
    const parts = name.split(",").map(s => s.trim());
    return {
      firstName: titleCase(parts.slice(1).join(" ").trim() || "Unknown"),
      lastName: titleCase(parts[0]),
      normalized: `${titleCase(parts[0])}, ${titleCase(parts.slice(1).join(" ").trim() || "Unknown")}`,
    };
  }
  const parts = name.split(" ");
  return {
    firstName: titleCase(parts[0]),
    lastName: titleCase(parts.slice(1).join(" ")),
    normalized: `${titleCase(parts.slice(1).join(" ") || "Unknown")}, ${titleCase(parts[0])}`,
  };
}

const SERVICE_CATEGORIES = {
  brakes: /brake|pad|rotor|caliper|drum|shoe|bleed|abs|parking.*cable/i,
  tires: /tire|mount.*balance|balance.*tire|replace.*tire|used tire|new tire|plug|flat|tpms|valve.*stem|rotation/i,
  alignment: /align/i,
  suspension: /strut|shock|control.*arm|sway.*bar|stab.*link|ball.*joint|tie.*rod|spring|bushing|bearing|hub/i,
  engine: /tune.*up|spark.*plug|oxygen.*sensor|alternator|starter|belt|timing|valve.*cover|gasket|motor.*mount|oil.*filter.*housing|catalytic|exhaust|muffler|weld.*exhaust|flex.*pipe|manifold/i,
  oil_change: /oil.*change|oil.*filter|lube|synthetic/i,
  cooling: /radiator|thermostat|coolant|water.*pump|heater.*core|cooling|flush.*system/i,
  electrical: /battery|wiper|window.*regulator|fuse|sensor|module|relay|light|headlight/i,
  steering: /power.*steering|steering.*pump|steering.*rack|steering.*hose/i,
  transmission: /transmission|trans.*fluid|trans.*filter|cv.*axle|axle|drive.*shaft/i,
  ac_heat: /a.*c|ac.*charge|ac.*compressor|freon|vacuum.*recharge|heater/i,
  inspection: /inspect|diagnos|check|scan/i,
};

function categorizeService(desc) {
  if (!desc) return "other";
  for (const [cat, re] of Object.entries(SERVICE_CATEGORIES)) {
    if (re.test(desc)) return cat;
  }
  return "other";
}

function normalizePaymentType(raw) {
  if (!raw) return { method: "other", isFinanced: false, financeProvider: null };
  const lower = raw.toLowerCase().trim();
  if (lower.includes("snap")) return { method: "financing", isFinanced: true, financeProvider: "SNAP" };
  if (lower.includes("afterpay")) return { method: "financing", isFinanced: true, financeProvider: "AFTERPAY" };
  if (lower.includes("acima")) return { method: "financing", isFinanced: true, financeProvider: "ACIMA" };
  if (lower.includes("koalafi")) return { method: "financing", isFinanced: true, financeProvider: "Koalafi" };
  if (lower.includes("cash")) return { method: "cash", isFinanced: false, financeProvider: null };
  if (lower.includes("visa") || lower.includes("master") || lower.includes("card") || lower.includes("charge"))
    return { method: "card", isFinanced: false, financeProvider: null };
  if (lower.includes("check")) return { method: "check", isFinanced: false, financeProvider: null };
  return { method: "other", isFinanced: false, financeProvider: null };
}

function detectLazyInvoicing(labor, parts, desc) {
  const total = labor + parts;
  if (total === 0) return { labor, parts, isLazy: false };
  const isService = /remove|replace|r.*r|install|repair|flush|adjust|weld|bleed|diagnos|tune/i.test(desc);
  if (labor === 0 && parts > 20000 && isService) return { labor: Math.round(total * 0.45), parts: Math.round(total * 0.55), isLazy: true };
  const mentionsParts = /pad|rotor|tire|part|filter|battery|sensor|bearing|plug|strut|caliper|belt|hose|alternator|starter/i.test(desc);
  if (parts === 0 && labor > 30000 && mentionsParts) return { labor: Math.round(total * 0.55), parts: Math.round(total * 0.45), isLazy: true };
  return { labor, parts, isLazy: false };
}

const MONTHS = { Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12" };
function parseDate(raw) {
  const m = raw.match(/^(\w{3})\s+(\d{1,2}),\s+(\d{4})$/);
  if (!m) return "1970-01-01";
  return `${m[3]}-${MONTHS[m[1]] || "01"}-${m[2].padStart(2, "0")}`;
}

// ─── Parse Total Sales ─────────────────────────────────
function parseTotalSales(content) {
  const lines = content.split("\n");
  const invoices = [];
  const dailyTotals = [];
  let currentDate = "";
  let dailyCount = 0;
  const dateRe = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("Inv\t") || line.startsWith("New Ticket") ||
        line.startsWith("In Progress") || line.startsWith("Recent") ||
        line.startsWith("Search...") || line.startsWith("Report:") ||
        line.startsWith("Date Range") || line.startsWith("Start Date") ||
        line.startsWith("End Date") || line.startsWith("Copyright") ||
        line.startsWith("Home")) continue;

    if (dateRe.test(line)) { currentDate = parseDate(line); dailyCount = 0; continue; }

    if (line.startsWith("Daily Totals")) {
      const parts = line.split("\t").filter(p => p.startsWith("$"));
      if (parts.length >= 4) {
        dailyTotals.push({
          date: currentDate,
          labor: parseDollars(parts[0]), parts: parseDollars(parts[1]),
          misc: parseDollars(parts[2]), tax: parseDollars(parts[3]),
          total: parts[4] ? parseDollars(parts[4]) : 0, invoiceCount: dailyCount,
        });
      }
      continue;
    }
    if (line.startsWith("Grand Totals")) continue;

    const cols = line.split("\t");
    if (cols.length >= 6 && /^\d+$/.test(cols[0].trim())) {
      const { firstName, lastName } = normalizeName(cols[2]?.trim() || "");
      const desc = cols[3]?.trim() || "";
      const laborRaw = parseDollars(cols[4] || "0");
      const partsRaw = parseDollars(cols[5] || "0");
      const { labor, parts, isLazy } = detectLazyInvoicing(laborRaw, partsRaw, desc);
      const { method, isFinanced, financeProvider } = normalizePaymentType(cols[9]?.trim() || "");

      invoices.push({
        invoiceNumber: cols[0].trim(),
        poNumber: cols[1]?.trim() || "",
        customerName: `${lastName}, ${firstName}`,
        firstName, lastName,
        description: desc,
        laborCents: labor, partsCents: parts,
        miscCents: parseDollars(cols[6] || "0"),
        taxCents: parseDollars(cols[7] || "0"),
        totalCents: parseDollars(cols[8] || "0"),
        payType: cols[9]?.trim() || "",
        paymentMethod: method, isFinanced, financeProvider,
        serviceCategory: categorizeService(desc),
        isLazyInvoice: isLazy,
        date: currentDate,
      });
      dailyCount++;
    }
  }
  return { invoices, dailyTotals };
}

// ─── Parse Tech Report ─────────────────────────────────
function parseTechReport(content) {
  const lines = content.split("\n");
  const techs = [];
  let currentTech = "";
  let items = 0, hours = 0, laborTotal = 0;
  const services = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("New Ticket") || line.startsWith("In Progress") ||
        line.startsWith("Recent") || line.startsWith("Search...") ||
        line.startsWith("Report:") || line.startsWith("Date Range") ||
        line.startsWith("Start Date") || line.startsWith("End Date") ||
        line.startsWith("Date\t") || line.startsWith("Copyright") ||
        line.startsWith("Home") || line.startsWith("MISC CHARGES") ||
        line.startsWith("Filter by:")) continue;

    if (line.startsWith("Technician Totals:")) {
      const next = lines[i + 1]?.trim() || "";
      const vals = next.split("\t").map(s => s.trim()).filter(Boolean);
      if (currentTech && vals.length >= 3) {
        techs.push({
          name: currentTech,
          totalHours: parseFloat(vals[1]?.replace(/,/g, "") || "0"),
          totalLaborCents: parseDollars(vals[2]),
          totalPartsCents: parseDollars(vals[0]),
          lineItems: items,
          avgRateCents: hours > 0 ? Math.round(laborTotal / hours) : 0,
          topServices: { ...services },
        });
      }
      currentTech = ""; items = 0; hours = 0; laborTotal = 0;
      Object.keys(services).forEach(k => delete services[k]);
      i++;
      continue;
    }

    // Tech name line
    if (!line.includes("\t") && !line.startsWith("$") && /^[A-Z@*]/.test(line) && line.length > 2 && !line.startsWith("Grand") && !line.startsWith("Miscellaneous")) {
      currentTech = line.replace(/^[*]+,?\s*/, "").trim();
      items = 0; hours = 0; laborTotal = 0;
      Object.keys(services).forEach(k => delete services[k]);
      continue;
    }

    if (currentTech && line.includes("\t")) {
      const cols = line.split("\t");
      if (cols.length >= 4) {
        const desc = cols[2]?.trim() || "";
        const h = parseFloat(cols[5]?.trim() || "0") || 0;
        const t = parseDollars(cols[7] || "0");
        items++; hours += h; laborTotal += t;
        const cat = categorizeService(desc);
        services[cat] = (services[cat] || 0) + 1;
      }
    }
  }
  return techs;
}

// ─── Parse Labor Report ────────────────────────────────
function parseLaborReport(content) {
  const lines = content.split("\n");
  const services = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("New Ticket") || t.startsWith("In Progress") ||
        t.startsWith("Recent") || t.startsWith("Search...") ||
        t.startsWith("Report:") || t.startsWith("Date Range") ||
        t.startsWith("Start Date") || t.startsWith("End Date") ||
        t.startsWith("Labor Description") || t.startsWith("Grand Totals") ||
        t.startsWith("Copyright") || t.startsWith("Home")) continue;
    const cols = t.split("\t");
    if (cols.length >= 5) {
      const rev = parseDollars(cols[4]);
      if (rev > 0) {
        services.push({
          description: cols[0]?.trim(),
          tickets: parseInt(cols[1]?.trim()) || 0,
          hours: parseFloat(cols[2]?.trim()) || 0,
          avgRate: parseDollars(cols[3]),
          revenue: rev,
          category: categorizeService(cols[0]?.trim()),
        });
      }
    }
  }
  return services;
}

// ─── Parse Parts Report ────────────────────────────────
const BRANDS = {
  Duralast: /duralast/i, Bosch: /bosch/i, Moog: /moog/i, ACDelco: /acdelco/i,
  Dorman: /dorman/i, Walker: /walker/i, NTK: /ntk/i, STP: /stp/i,
  Continental: /continental/i, Beck_Arnley: /beck.*arnley/i, Autolite: /autolite/i,
  Gateway: /gateway/i, Yokohama: /yokohama/i, Milestar: /milestar/i,
};

function detectBrand(desc) {
  for (const [b, re] of Object.entries(BRANDS)) { if (re.test(desc)) return b; }
  return "Generic";
}

function parsePartsReport(content) {
  const lines = content.split("\n");
  const parts = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("New Ticket") || t.startsWith("In Progress") ||
        t.startsWith("Recent") || t.startsWith("Search...") ||
        t.startsWith("Report:") || t.startsWith("Date Range") ||
        t.startsWith("Start Date") || t.startsWith("End Date") ||
        t.startsWith("Part Description") || t.startsWith("Grand Totals") ||
        t.startsWith("Copyright") || t.startsWith("Home")) continue;
    const cols = t.split("\t");
    if (cols.length >= 4) {
      let pn = "", qi = 1;
      if (cols[1] && /[A-Za-z]/.test(cols[1]) && !/^\d+\.\d+$/.test(cols[1].trim())) { pn = cols[1].trim(); qi = 2; }
      const rev = parseDollars(cols[qi + 2] || cols[qi + 1] || "0");
      if (rev > 0) {
        parts.push({
          description: cols[0]?.trim(), partNumber: pn,
          quantity: parseFloat(cols[qi]?.trim()) || 0,
          rate: parseDollars(cols[qi + 1] || "0"), revenue: rev,
          brand: detectBrand(cols[0]?.trim()),
        });
      }
    }
  }
  return parts;
}

// ─── Generate Analytics ────────────────────────────────
function generateAnalytics(invoices, dailyTotals, techs, laborServices, partSales) {
  const totalRevenue = invoices.reduce((s, i) => s + i.totalCents, 0);
  const totalLabor = invoices.reduce((s, i) => s + i.laborCents, 0);
  const totalParts = invoices.reduce((s, i) => s + i.partsCents, 0);

  // Monthly
  const mm = {};
  for (const inv of invoices) {
    const m = inv.date.slice(0, 7);
    if (!mm[m]) mm[m] = { labor: 0, parts: 0, total: 0, count: 0 };
    mm[m].labor += inv.laborCents; mm[m].parts += inv.partsCents;
    mm[m].total += inv.totalCents; mm[m].count++;
  }
  const monthly = Object.entries(mm).map(([m, d]) => ({ month: m, ...d })).sort((a, b) => a.month.localeCompare(b.month));

  // Service categories
  const cats = {};
  for (const inv of invoices) {
    if (!cats[inv.serviceCategory]) cats[inv.serviceCategory] = { count: 0, revenue: 0 };
    cats[inv.serviceCategory].count++; cats[inv.serviceCategory].revenue += inv.totalCents;
  }
  const serviceCategories = Object.entries(cats).map(([c, d]) => ({
    category: c, ...d, pctOfTotal: totalRevenue > 0 ? Math.round(d.revenue / totalRevenue * 10000) / 100 : 0,
  })).sort((a, b) => b.revenue - a.revenue);

  // Payment
  const pm = {};
  for (const inv of invoices) {
    if (!pm[inv.paymentMethod]) pm[inv.paymentMethod] = { count: 0, revenue: 0 };
    pm[inv.paymentMethod].count++; pm[inv.paymentMethod].revenue += inv.totalCents;
  }

  // Financing
  const fin = invoices.filter(i => i.isFinanced);
  const fp = {};
  for (const f of fin) {
    const p = f.financeProvider || "Unknown";
    if (!fp[p]) fp[p] = { count: 0, revenue: 0 };
    fp[p].count++; fp[p].revenue += f.totalCents;
  }

  // Customers
  const cm = {};
  for (const inv of invoices) {
    if (!cm[inv.customerName]) cm[inv.customerName] = { visits: 0, spent: 0, lastVisit: "" };
    cm[inv.customerName].visits++; cm[inv.customerName].spent += inv.totalCents;
    if (!cm[inv.customerName].lastVisit || inv.date > cm[inv.customerName].lastVisit) cm[inv.customerName].lastVisit = inv.date;
  }
  const topCustomers = Object.entries(cm).map(([n, d]) => ({ name: n, ...d, avgTicket: Math.round(d.spent / d.visits) }))
    .sort((a, b) => b.spent - a.spent).slice(0, 30);
  const repeats = Object.values(cm).filter(c => c.visits >= 2).length;

  // Growth
  const recent3 = monthly.slice(-3);
  const prior3 = monthly.slice(-6, -3);
  const recentAvg = recent3.length > 0 ? recent3.reduce((s, m) => s + m.total, 0) / recent3.length : 0;
  const priorAvg = prior3.length > 0 ? prior3.reduce((s, m) => s + m.total, 0) / prior3.length : 0;
  const growthRate = priorAvg > 0 ? Math.round((recentAvg - priorAvg) / priorAvg * 10000) / 100 : 0;

  const lazyCount = invoices.filter(i => i.isLazyInvoice).length;

  // Brand distribution
  const brands = {};
  for (const p of partSales) {
    if (!brands[p.brand]) brands[p.brand] = { revenue: 0, count: 0 };
    brands[p.brand].revenue += p.revenue; brands[p.brand].count++;
  }

  return {
    totalRevenue, totalLabor, totalParts,
    totalMisc: invoices.reduce((s, i) => s + i.miscCents, 0),
    totalTax: invoices.reduce((s, i) => s + i.taxCents, 0),
    invoiceCount: invoices.length,
    operatingDays: dailyTotals.length,
    avgDailyRevenue: dailyTotals.length > 0 ? Math.round(totalRevenue / dailyTotals.length) : 0,
    avgTicketSize: invoices.length > 0 ? Math.round(totalRevenue / invoices.length) : 0,
    monthlyRevenue: monthly,
    serviceCategories,
    paymentMethods: Object.entries(pm).map(([m, d]) => ({ method: m, ...d })).sort((a, b) => b.revenue - a.revenue),
    financingBreakdown: { totalFinanced: fin.reduce((s, i) => s + i.totalCents, 0), count: fin.length, providers: fp },
    techScores: techs,
    topCustomers,
    repeatRate: Object.keys(cm).length > 0 ? Math.round(repeats / Object.keys(cm).length * 10000) / 100 : 0,
    customerCount: Object.keys(cm).length,
    topParts: partSales.sort((a, b) => b.revenue - a.revenue).slice(0, 30),
    brandDistribution: Object.entries(brands).map(([b, d]) => ({ brand: b, ...d })).sort((a, b) => b.revenue - a.revenue),
    topServices: laborServices.sort((a, b) => b.revenue - a.revenue).slice(0, 30),
    lazyInvoiceCount: lazyCount,
    lazyInvoicePct: invoices.length > 0 ? Math.round(lazyCount / invoices.length * 10000) / 100 : 0,
    projectedMonthlyRevenue: recentAvg,
    projectedAnnualRevenue: recentAvg * 12,
    growthRate,
    laborPartsRatio: totalParts > 0 ? Math.round(totalLabor / totalParts * 100) / 100 : 0,
  };
}

// ─── MAIN ──────────────────────────────────────────────
async function main() {
  console.log("Reading report files...");

  const totalSalesContent = readFileSync(FILES.totalSales, "utf-8");
  const techContent = readFileSync(FILES.techSales, "utf-8");
  const laborContent = readFileSync(FILES.laborSales, "utf-8");
  const partsContent = readFileSync(FILES.partsSales, "utf-8");

  console.log(`Files loaded: Total Sales (${totalSalesContent.length} chars), Tech (${techContent.length} chars), Labor (${laborContent.length} chars), Parts (${partsContent.length} chars)`);

  // Parse
  console.log("Parsing Total Sales...");
  const { invoices, dailyTotals } = parseTotalSales(totalSalesContent);
  console.log(`  ${invoices.length} invoices, ${dailyTotals.length} operating days`);

  console.log("Parsing Tech Report...");
  const techs = parseTechReport(techContent);
  console.log(`  ${techs.length} technicians`);

  console.log("Parsing Labor Report...");
  const laborServices = parseLaborReport(laborContent);
  console.log(`  ${laborServices.length} service types`);

  console.log("Parsing Parts Report...");
  const partSales = parsePartsReport(partsContent);
  console.log(`  ${partSales.length} part types`);

  // Lazy invoicing stats
  const lazyCount = invoices.filter(i => i.isLazyInvoice).length;
  console.log(`  ${lazyCount} lazy invoices detected (${Math.round(lazyCount / invoices.length * 100)}%)`);

  // Generate analytics
  console.log("Generating analytics...");
  const analytics = generateAnalytics(invoices, dailyTotals, techs, laborServices, partSales);

  // Print summary
  console.log("\n═══ SHOP ANALYTICS SUMMARY ═══");
  console.log(`Total Revenue: $${(analytics.totalRevenue / 100).toLocaleString()}`);
  console.log(`  Labor: $${(analytics.totalLabor / 100).toLocaleString()} (${Math.round(analytics.totalLabor / analytics.totalRevenue * 100)}%)`);
  console.log(`  Parts: $${(analytics.totalParts / 100).toLocaleString()} (${Math.round(analytics.totalParts / analytics.totalRevenue * 100)}%)`);
  console.log(`Invoices: ${analytics.invoiceCount} across ${analytics.operatingDays} operating days`);
  console.log(`Avg Daily Revenue: $${(analytics.avgDailyRevenue / 100).toFixed(2)}`);
  console.log(`Avg Ticket Size: $${(analytics.avgTicketSize / 100).toFixed(2)}`);
  console.log(`Growth Rate (3mo): ${analytics.growthRate}%`);
  console.log(`Projected Annual: $${(analytics.projectedAnnualRevenue / 100).toLocaleString()}`);
  console.log(`Unique Customers: ${analytics.customerCount}`);
  console.log(`Repeat Rate: ${analytics.repeatRate}%`);
  console.log(`Financing: ${analytics.financingBreakdown.count} invoices ($${(analytics.financingBreakdown.totalFinanced / 100).toLocaleString()})`);
  console.log(`\nTop Service Categories:`);
  for (const cat of analytics.serviceCategories.slice(0, 8)) {
    console.log(`  ${cat.category}: ${cat.count} jobs, $${(cat.revenue / 100).toLocaleString()} (${cat.pctOfTotal}%)`);
  }
  console.log(`\nTechnicians:`);
  for (const tech of analytics.techScores) {
    console.log(`  ${tech.name}: ${tech.totalHours}hrs, $${(tech.totalLaborCents / 100).toLocaleString()}, ${tech.lineItems} jobs`);
  }

  // POST to Railway
  console.log("\nSending to Railway...");
  const payload = JSON.stringify({ invoices, analytics });
  console.log(`Payload size: ${(payload.length / 1024 / 1024).toFixed(2)} MB`);

  const res = await fetch(BRIDGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bridge-Key": BRIDGE_KEY,
    },
    body: payload,
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`FAILED: HTTP ${res.status} — ${err}`);
    process.exit(1);
  }

  const result = await res.json();
  console.log("\n═══ INGESTION RESULT ═══");
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
