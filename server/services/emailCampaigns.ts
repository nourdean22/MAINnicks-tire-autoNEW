/**
 * Email Campaign Engine — Batch email sending for marketing
 * Supports templates, audience filtering, and campaign tracking.
 * Feature flag: email_marketing_campaigns (start DISABLED)
 */

import { createLogger } from "../lib/logger";
import { randomUUID } from "crypto";

const log = createLogger("email-campaigns");

export interface EmailCampaign {
  id: string;
  name: string;
  subject: string;
  body: string; // HTML with {{firstName}}, {{vehicleMake}} tokens
  audience: "all" | "vip" | "loyal" | "at-risk" | "churned" | "new";
  status: "draft" | "scheduled" | "sending" | "sent" | "cancelled";
  scheduledFor?: Date;
  sentCount: number;
  openCount: number;
  clickCount: number;
  createdAt: Date;
}

// Template token replacement
export function personalizeEmail(template: string, data: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}

// Pre-built campaign templates
export const CAMPAIGN_TEMPLATES: Record<string, { subject: string; body: string }> = {
  "retention-90day": {
    subject: "We miss your {{vehicleMake}} at Nick's!",
    body: `<h2>Hey {{firstName}},</h2><p>It's been a while since we saw your {{vehicleMake}} {{vehicleModel}}. Your vehicle may be due for maintenance.</p><p>Book online at <a href="https://nickstire.org">nickstire.org</a> or call us at (216) 862-0005.</p><p>— The Nick's Tire & Auto Team</p>`,
  },
  "seasonal-winter": {
    subject: "Is your {{vehicleMake}} winter-ready?",
    body: `<h2>Winter is coming, {{firstName}}.</h2><p>Cleveland winters are brutal. Make sure your {{vehicleMake}} is ready:</p><ul><li>Battery test (free)</li><li>Tire tread check</li><li>Coolant level</li><li>Wiper blades</li></ul><p>Book your winter prep at <a href="https://nickstire.org">nickstire.org</a> or call (216) 862-0005.</p>`,
  },
  "review-request": {
    subject: "{{firstName}}, how did we do?",
    body: `<h2>Thanks for choosing Nick's, {{firstName}}!</h2><p>If we earned it, a Google review means the world to us:</p><p><a href="https://nickstire.org/review" style="background:#FDB913;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Leave a Review</a></p><p>Your feedback helps other Cleveland drivers find honest repair.</p><p>— Nour & the Nick's Tire team</p>`,
  },
  "special-offer": {
    subject: "Exclusive: {{offerTitle}} at Nick's Tire",
    body: `<h2>{{firstName}}, this one's for you.</h2><p>{{offerDescription}}</p><p>Valid through {{offerExpiry}}. Book at <a href="https://nickstire.org">nickstire.org</a> or call (216) 862-0005.</p>`,
  },
};

/** Create a new campaign draft */
export function createCampaign(params: {
  name: string;
  templateKey?: string;
  subject?: string;
  body?: string;
  audience: EmailCampaign["audience"];
}): EmailCampaign {
  const template = params.templateKey ? CAMPAIGN_TEMPLATES[params.templateKey] : null;
  return {
    id: randomUUID(),
    name: params.name,
    subject: params.subject || template?.subject || "",
    body: params.body || template?.body || "",
    audience: params.audience,
    status: "draft",
    sentCount: 0,
    openCount: 0,
    clickCount: 0,
    createdAt: new Date(),
  };
}

log.info("Email campaign engine loaded");
