/**
 * Invoice / Estimate Generator — Creates HTML invoices from work orders
 * Can be rendered as PDF via Puppeteer or sent as HTML email.
 */

import { createLogger } from "../lib/logger";
const log = createLogger("invoice");

export interface InvoiceData {
  orderNumber: string;
  date: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  vehicleInfo: string;
  lineItems: Array<{
    description: string;
    type: "labor" | "part" | "tire" | "fee" | "discount";
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  warrantyInfo?: string;
  techName?: string;
  notes?: string;
}

/** Generate HTML invoice content */
export function generateInvoiceHTML(data: InvoiceData): string {
  const rows = data.lineItems
    .map(
      (item) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #21262D;color:#F0F6FC">${item.description}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #21262D;color:#8B949E;text-align:center">${item.type}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #21262D;color:#8B949E;text-align:center">${item.quantity}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #21262D;color:#F0F6FC;text-align:right;font-family:monospace">$${item.unitPrice.toFixed(2)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #21262D;color:#FDB913;text-align:right;font-family:monospace;font-weight:bold">$${item.total.toFixed(2)}</td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Invoice #${data.orderNumber}</title></head>
<body style="margin:0;padding:0;background:#0B0E14;font-family:'Inter',sans-serif;color:#F0F6FC">
<div style="max-width:700px;margin:0 auto;padding:40px 20px">
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:32px;border-bottom:2px solid #1E4D8C;padding-bottom:20px">
    <div>
      <h1 style="margin:0;font-size:24px;color:#FDB913;font-weight:800">NICK'S TIRE & AUTO</h1>
      <p style="margin:4px 0 0;font-size:12px;color:#8B949E">17625 Euclid Ave, Euclid OH 44112 | (216) 862-0005</p>
    </div>
    <div style="text-align:right">
      <div style="font-size:11px;color:#8B949E;text-transform:uppercase;letter-spacing:1px">Invoice</div>
      <div style="font-size:18px;font-weight:bold;color:#F0F6FC">#${data.orderNumber}</div>
      <div style="font-size:12px;color:#8B949E">${data.date}</div>
    </div>
  </div>

  <!-- Customer + Vehicle -->
  <div style="display:flex;gap:40px;margin-bottom:24px">
    <div>
      <div style="font-size:10px;color:#8B949E;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Customer</div>
      <div style="font-weight:600">${data.customerName}</div>
      <div style="font-size:13px;color:#8B949E">${data.customerPhone}</div>
      ${data.customerEmail ? `<div style="font-size:13px;color:#8B949E">${data.customerEmail}</div>` : ""}
    </div>
    <div>
      <div style="font-size:10px;color:#8B949E;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Vehicle</div>
      <div style="font-weight:600">${data.vehicleInfo}</div>
      ${data.techName ? `<div style="font-size:13px;color:#8B949E">Tech: ${data.techName}</div>` : ""}
    </div>
  </div>

  <!-- Line Items -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
    <thead>
      <tr style="border-bottom:2px solid #1E4D8C">
        <th style="padding:8px 12px;text-align:left;font-size:10px;color:#8B949E;text-transform:uppercase;letter-spacing:1px">Description</th>
        <th style="padding:8px 12px;text-align:center;font-size:10px;color:#8B949E;text-transform:uppercase;letter-spacing:1px">Type</th>
        <th style="padding:8px 12px;text-align:center;font-size:10px;color:#8B949E;text-transform:uppercase;letter-spacing:1px">Qty</th>
        <th style="padding:8px 12px;text-align:right;font-size:10px;color:#8B949E;text-transform:uppercase;letter-spacing:1px">Price</th>
        <th style="padding:8px 12px;text-align:right;font-size:10px;color:#8B949E;text-transform:uppercase;letter-spacing:1px">Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <!-- Totals -->
  <div style="text-align:right;margin-bottom:24px">
    <div style="font-size:13px;color:#8B949E;margin-bottom:4px">Subtotal: <span style="color:#F0F6FC;font-family:monospace">$${data.subtotal.toFixed(2)}</span></div>
    ${data.discount > 0 ? `<div style="font-size:13px;color:#27AE60;margin-bottom:4px">Discount: -$${data.discount.toFixed(2)}</div>` : ""}
    <div style="font-size:13px;color:#8B949E;margin-bottom:4px">Tax: <span style="color:#F0F6FC;font-family:monospace">$${data.tax.toFixed(2)}</span></div>
    <div style="font-size:20px;font-weight:bold;color:#FDB913;font-family:monospace;border-top:2px solid #1E4D8C;padding-top:8px;margin-top:8px">Total: $${data.total.toFixed(2)}</div>
  </div>

  ${data.warrantyInfo ? `<div style="background:#161B22;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:16px;margin-bottom:24px"><div style="font-size:10px;color:#8B949E;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Warranty</div><div style="font-size:13px;color:#F0F6FC">${data.warrantyInfo}</div></div>` : ""}
  ${data.notes ? `<div style="font-size:12px;color:#8B949E;margin-bottom:24px"><strong>Notes:</strong> ${data.notes}</div>` : ""}

  <!-- Footer -->
  <div style="text-align:center;padding-top:20px;border-top:1px solid #21262D">
    <p style="font-size:11px;color:#8B949E">Thank you for choosing Nick's Tire & Auto!</p>
    <p style="font-size:11px;color:#8B949E">nickstire.org | (216) 862-0005 | 4.9★ (1,700+ reviews)</p>
  </div>
</div>
</body>
</html>`;
}

log.info("Invoice generator loaded");
