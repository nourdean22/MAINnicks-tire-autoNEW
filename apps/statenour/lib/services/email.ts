import { Resend } from "resend";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/email");

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = "NOUR OS <noreply@bdnick.info>";
const DEFAULT_TO = "nourdean22@gmail.com";

export interface EmailOptions {
  to?: string;
  subject: string;
  text?: string;
  html?: string;
}

/**
 * Send an email via Resend.
 * Returns the email ID on success, null if Resend is not configured.
 */
export async function sendEmail(options: EmailOptions): Promise<string | null> {
  if (!resend) {
    log.info("send_skipped", { reason: "not_configured", subject: options.subject });
    return null;
  }

  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: options.to ?? DEFAULT_TO,
    subject: options.subject,
    ...(options.html ? { html: options.html } : { text: options.text ?? "" }),
  });

  if (error) {
    throw new Error(`Email failed: ${error.message}`);
  }

  return data?.id ?? null;
}

// ── Email Templates ────────────────────────────────────────────────────

export function driftAlertEmail(alerts: { ruleName: string; severity: string; message: string }[]): EmailOptions {
  const alertList = alerts
    .map((a) => `• [${a.severity.toUpperCase()}] ${a.ruleName}: ${a.message}`)
    .join("\n");

  return {
    subject: `⚠ ${alerts.length} Drift Alert${alerts.length > 1 ? "s" : ""} — NOUR OS`,
    text: `You have ${alerts.length} unresolved drift alert${alerts.length > 1 ? "s" : ""}:\n\n${alertList}\n\nReview at https://bdnick.info/system/alerts`,
    html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #e5e5e5; padding: 24px; border-radius: 12px;">
        <h2 style="color: #f59e0b; font-size: 18px; margin: 0 0 16px;">⚠ Drift Alerts</h2>
        <p style="color: #a1a1aa; font-size: 14px; margin: 0 0 16px;">
          You have ${alerts.length} unresolved drift alert${alerts.length > 1 ? "s" : ""}:
        </p>
        ${alerts.map((a) => `
          <div style="background: #1a1a1a; border-left: 3px solid ${a.severity === "high" ? "#ef4444" : "#f59e0b"}; padding: 12px 16px; border-radius: 8px; margin-bottom: 8px;">
            <div style="font-size: 13px; font-weight: 600; color: #e5e5e5;">${a.ruleName}</div>
            <div style="font-size: 12px; color: #a1a1aa; margin-top: 4px;">${a.message}</div>
          </div>
        `).join("")}
        <a href="https://bdnick.info/system/alerts" style="display: inline-block; margin-top: 16px; background: #f59e0b; color: #000; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600;">Review Alerts →</a>
      </div>
    `,
  };
}

export function dailySummaryEmail(data: {
  date: string;
  tasksCompleted: number;
  tasksCreated: number;
  leadsCreated: number;
  jobs: number;
  aiCostCents: number;
  errors: number;
  driftAlerts: number;
}): EmailOptions {
  return {
    subject: `📊 Daily Summary — ${data.date}`,
    text: `NOUR OS Daily Summary for ${data.date}:\n\nTasks: ${data.tasksCompleted} completed, ${data.tasksCreated} created\nLeads: ${data.leadsCreated} new\nJobs: ${data.jobs}\nAI Cost: $${(data.aiCostCents / 100).toFixed(2)}\nErrors: ${data.errors}\nDrift Alerts: ${data.driftAlerts}`,
    html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #e5e5e5; padding: 24px; border-radius: 12px;">
        <h2 style="color: #e5e5e5; font-size: 18px; margin: 0 0 4px;">📊 Daily Summary</h2>
        <p style="color: #71717a; font-size: 12px; margin: 0 0 20px;">${data.date}</p>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          ${[
            { label: "Tasks Done", value: data.tasksCompleted, color: "#10b981" },
            { label: "Tasks Created", value: data.tasksCreated, color: "#3b82f6" },
            { label: "New Leads", value: data.leadsCreated, color: "#8b5cf6" },
            { label: "Jobs Logged", value: data.jobs, color: "#f59e0b" },
            { label: "AI Cost", value: `$${(data.aiCostCents / 100).toFixed(2)}`, color: "#06b6d4" },
            { label: "Errors", value: data.errors, color: data.errors > 0 ? "#ef4444" : "#10b981" },
          ].map((m) => `
            <div style="background: #1a1a1a; padding: 12px; border-radius: 8px; text-align: center;">
              <div style="font-size: 24px; font-weight: 700; color: ${m.color};">${m.value}</div>
              <div style="font-size: 11px; color: #71717a; margin-top: 2px;">${m.label}</div>
            </div>
          `).join("")}
        </div>
        <a href="https://bdnick.info/system" style="display: inline-block; margin-top: 16px; background: #27272a; color: #e5e5e5; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 500;">Open Dashboard →</a>
      </div>
    `,
  };
}

export function deviceOfflineEmail(deviceName: string, platform: string, lastSeen: string): EmailOptions {
  return {
    subject: `🔴 Device Offline: ${deviceName}`,
    text: `${deviceName} (${platform}) has been offline for over 24 hours.\nLast seen: ${lastSeen}\n\nCheck at https://bdnick.info/devices`,
    html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #e5e5e5; padding: 24px; border-radius: 12px;">
        <h2 style="color: #ef4444; font-size: 18px; margin: 0 0 16px;">🔴 Device Offline</h2>
        <div style="background: #1a1a1a; padding: 16px; border-radius: 8px; border-left: 3px solid #ef4444;">
          <div style="font-size: 16px; font-weight: 600;">${deviceName}</div>
          <div style="font-size: 13px; color: #a1a1aa; margin-top: 4px;">Platform: ${platform}</div>
          <div style="font-size: 13px; color: #a1a1aa;">Last seen: ${lastSeen}</div>
        </div>
        <a href="https://bdnick.info/devices" style="display: inline-block; margin-top: 16px; background: #ef4444; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600;">Check Devices →</a>
      </div>
    `,
  };
}

export function budgetWarningEmail(spent: number, limit: number, percentUsed: number): EmailOptions {
  return {
    subject: `💰 AI Budget at ${percentUsed}% — NOUR OS`,
    text: `AI spend is at ${percentUsed}% of daily budget.\nSpent: $${(spent / 100).toFixed(2)} / $${(limit / 100).toFixed(2)}`,
    html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #e5e5e5; padding: 24px; border-radius: 12px;">
        <h2 style="color: #f59e0b; font-size: 18px; margin: 0 0 16px;">💰 AI Budget Warning</h2>
        <div style="background: #1a1a1a; padding: 16px; border-radius: 8px;">
          <div style="font-size: 32px; font-weight: 700; color: ${percentUsed >= 100 ? "#ef4444" : "#f59e0b"};">${percentUsed}%</div>
          <div style="font-size: 13px; color: #a1a1aa; margin-top: 4px;">$${(spent / 100).toFixed(2)} of $${(limit / 100).toFixed(2)} daily budget</div>
          <div style="margin-top: 8px; height: 6px; background: #27272a; border-radius: 3px; overflow: hidden;">
            <div style="height: 100%; width: ${Math.min(100, percentUsed)}%; background: ${percentUsed >= 100 ? "#ef4444" : "#f59e0b"}; border-radius: 3px;"></div>
          </div>
        </div>
      </div>
    `,
  };
}

export function quoteDeliveryEmail(quote: {
  quoteNumber: string;
  customerName: string;
  vehicleYear: number;
  vehicleMake: string;
  vehicleModel: string;
  items: { description: string; quantity: number; totalPrice: number }[];
  grandTotal: number;
  discountAmount: number;
  expiresAt: string | null;
}): EmailOptions {
  const itemRows = quote.items
    .map(
      (i) =>
        `<tr><td style="padding: 8px 12px; border-bottom: 1px solid #27272a; color: #e5e5e5;">${i.description}</td><td style="padding: 8px 12px; border-bottom: 1px solid #27272a; color: #a1a1aa; text-align: center;">${i.quantity}</td><td style="padding: 8px 12px; border-bottom: 1px solid #27272a; color: #e5e5e5; text-align: right;">$${i.totalPrice.toFixed(2)}</td></tr>`
    )
    .join("");

  const expiryNote = quote.expiresAt
    ? `<p style="color: #f59e0b; font-size: 12px; margin-top: 12px;">⏰ This quote expires on ${new Date(quote.expiresAt).toLocaleDateString()}. Call us to book before then!</p>`
    : "";

  return {
    subject: `Your Quote ${quote.quoteNumber} — Nick's Tire & Auto`,
    html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #e5e5e5; padding: 24px; border-radius: 12px;">
        <h2 style="color: #e5e5e5; font-size: 20px; margin: 0 0 4px;">Your Quote is Ready</h2>
        <p style="color: #71717a; font-size: 13px; margin: 0 0 16px;">Quote #${quote.quoteNumber}</p>
        <div style="background: #1a1a1a; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
          <div style="font-size: 14px; font-weight: 600; color: #e5e5e5;">${quote.customerName}</div>
          <div style="font-size: 13px; color: #a1a1aa; margin-top: 4px;">${quote.vehicleYear} ${quote.vehicleMake} ${quote.vehicleModel}</div>
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <thead><tr style="background: #1a1a1a;">
            <th style="padding: 8px 12px; text-align: left; color: #71717a;">Service</th>
            <th style="padding: 8px 12px; text-align: center; color: #71717a;">Qty</th>
            <th style="padding: 8px 12px; text-align: right; color: #71717a;">Price</th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        ${quote.discountAmount > 0 ? `<div style="text-align: right; margin-top: 8px; font-size: 13px; color: #10b981;">Discount: -$${quote.discountAmount.toFixed(2)}</div>` : ""}
        <div style="text-align: right; margin-top: 8px; font-size: 20px; font-weight: 700; color: #e5e5e5;">Total: $${quote.grandTotal.toFixed(2)}</div>
        ${expiryNote}
        <a href="tel:+12168620005" style="display: inline-block; margin-top: 16px; background: #3b82f6; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">📞 Call to Book: (216) 862-0005</a>
        <p style="color: #52525b; font-size: 11px; margin-top: 16px;">Nick's Tire & Auto Service · nickstire.org</p>
      </div>
    `,
    text: `Quote ${quote.quoteNumber} for ${quote.customerName}\n${quote.vehicleYear} ${quote.vehicleMake} ${quote.vehicleModel}\n\n${quote.items.map((i) => `${i.description} x${i.quantity} — $${i.totalPrice.toFixed(2)}`).join("\n")}\n\nTotal: $${quote.grandTotal.toFixed(2)}\n\nCall to book: (216) 862-0005`,
  };
}

export function bookingConfirmationEmail(data: {
  quoteNumber: string;
  customerName: string;
  vehicleYear: number;
  vehicleMake: string;
  vehicleModel: string;
  grandTotal: number;
}): EmailOptions {
  return {
    subject: `Booking Confirmed ${data.quoteNumber} — Nick's Tire & Auto`,
    html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #e5e5e5; padding: 24px; border-radius: 12px;">
        <h2 style="color: #10b981; font-size: 20px; margin: 0 0 16px;">✅ Booking Confirmed!</h2>
        <div style="background: #1a1a1a; padding: 16px; border-radius: 8px;">
          <div style="font-size: 16px; font-weight: 600;">${data.customerName}</div>
          <div style="font-size: 13px; color: #a1a1aa; margin-top: 4px;">${data.vehicleYear} ${data.vehicleMake} ${data.vehicleModel}</div>
          <div style="font-size: 13px; color: #a1a1aa; margin-top: 4px;">Quote #${data.quoteNumber}</div>
          <div style="font-size: 20px; font-weight: 700; color: #e5e5e5; margin-top: 8px;">$${data.grandTotal.toFixed(2)}</div>
        </div>
        <p style="color: #a1a1aa; font-size: 13px; margin-top: 16px;">
          We'll be in touch to schedule your appointment. If you need to reach us sooner, call (216) 862-0005.
        </p>
        <a href="tel:+12168620005" style="display: inline-block; margin-top: 12px; background: #10b981; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600;">📞 Call Us</a>
        <p style="color: #52525b; font-size: 11px; margin-top: 16px;">Nick's Tire & Auto Service · nickstire.org</p>
      </div>
    `,
    text: `Booking Confirmed!\n\nQuote #${data.quoteNumber} for ${data.customerName}\n${data.vehicleYear} ${data.vehicleMake} ${data.vehicleModel}\nTotal: $${data.grandTotal.toFixed(2)}\n\nWe'll be in touch to schedule. Call (216) 862-0005 anytime.`,
  };
}

