/**
 * Drip Campaign Engine — Automated multi-touch customer sequences
 * Enrolls customers into campaigns based on triggers (booking, purchase, etc.)
 * Processes steps on schedule via cron.
 * Feature flag: drip_campaigns_enabled (start DISABLED)
 */

import { createLogger } from "../lib/logger";
import { randomUUID } from "crypto";

const log = createLogger("drip-campaigns");

export interface DripCampaign {
  id: string;
  name: string;
  trigger: "post-service" | "new-customer" | "at-risk" | "declined-estimate" | "no-show" | "manual";
  steps: DripStep[];
  isActive: boolean;
}

export interface DripStep {
  stepNumber: number;
  delayDays: number;
  channel: "sms" | "email";
  messageTemplate: string;
  condition?: string; // Optional: "only if no visit since enrollment"
}

export interface DripEnrollment {
  id: string;
  campaignId: string;
  customerId: string;
  customerPhone: string;
  customerName: string;
  currentStep: number;
  status: "active" | "completed" | "cancelled" | "converted";
  enrolledAt: Date;
  nextStepAt: Date;
  metadata?: Record<string, string>;
}

// Pre-built campaigns
export const CAMPAIGNS: DripCampaign[] = [
  {
    id: "post-service",
    name: "Post-Service Follow-Up",
    trigger: "post-service",
    isActive: true,
    steps: [
      { stepNumber: 1, delayDays: 0, channel: "sms", messageTemplate: "Hi {{firstName}}, thank you for choosing Nick's Tire & Auto! If anything doesn't feel right with your {{service}}, call us: (216) 862-0005. — Nick's Team" },
      { stepNumber: 2, delayDays: 3, channel: "sms", messageTemplate: "{{firstName}}, if we earned it, a Google review means the world: nickstire.org/review — Nick & the team" },
      { stepNumber: 3, delayDays: 30, channel: "sms", messageTemplate: "Hi {{firstName}}, just checking in — how's your {{vehicle}} running since the {{service}}? Any concerns? (216) 862-0005" },
    ],
  },
  {
    id: "new-customer-welcome",
    name: "New Customer Welcome",
    trigger: "new-customer",
    isActive: true,
    steps: [
      { stepNumber: 1, delayDays: 0, channel: "sms", messageTemplate: "Welcome to Nick's Tire & Auto, {{firstName}}! Save our number: (216) 862-0005. Your referral code: {{referralCode}} — share it & you both save!" },
      { stepNumber: 2, delayDays: 7, channel: "sms", messageTemplate: "{{firstName}}, quick tip: check your tire pressure monthly. Low tires wear faster and hurt fuel economy. Free air check anytime at Nick's!" },
      { stepNumber: 3, delayDays: 60, channel: "sms", messageTemplate: "Hi {{firstName}}, your {{vehicle}} may be due for maintenance. Book at nickstire.org or call (216) 862-0005. We miss you!" },
    ],
  },
  {
    id: "at-risk-winback",
    name: "At-Risk Customer Win-Back",
    trigger: "at-risk",
    isActive: true,
    steps: [
      { stepNumber: 1, delayDays: 0, channel: "sms", messageTemplate: "Hi {{firstName}}, it's been a while! Your {{vehicle}} may need some attention. $10 off your next visit — just mention this text. (216) 862-0005" },
      { stepNumber: 2, delayDays: 14, channel: "sms", messageTemplate: "{{firstName}}, we've reserved a slot for your {{vehicle}} this week. No appointment needed — walk in Mon-Sat 8-6 or Sun 9-4. — Nick's Tire & Auto" },
      { stepNumber: 3, delayDays: 30, channel: "sms", messageTemplate: "Last chance, {{firstName}}! Free vehicle inspection ($49 value) when you visit this month. We want to make sure your {{vehicle}} is safe. (216) 862-0005", condition: "only if no visit since enrollment" },
    ],
  },
  {
    id: "declined-estimate",
    name: "Declined Estimate Follow-Up",
    trigger: "declined-estimate",
    isActive: true,
    steps: [
      { stepNumber: 1, delayDays: 7, channel: "sms", messageTemplate: "Hi {{firstName}}, just following up on your {{service}} estimate. Car problems rarely stay the same — they usually get worse. Early diagnosis costs less than waiting. Questions about pricing? We offer financing too. (216) 862-0005" },
      { stepNumber: 2, delayDays: 30, channel: "sms", messageTemplate: "{{firstName}}, that {{service}} issue won't fix itself. What feels minor today can turn into more damage, a bigger repair, or a breakdown. Most breakdowns don't come out of nowhere. Bring your estimate back anytime — (216) 862-0005" },
    ],
  },
];

/** Get a campaign by trigger type */
export function getCampaignByTrigger(trigger: DripCampaign["trigger"]): DripCampaign | undefined {
  return CAMPAIGNS.find(c => c.trigger === trigger && c.isActive);
}

/** Create an enrollment */
export function createEnrollment(params: {
  campaignId: string;
  customerId: string;
  customerPhone: string;
  customerName: string;
  metadata?: Record<string, string>;
}): DripEnrollment {
  const campaign = CAMPAIGNS.find(c => c.id === params.campaignId);
  const firstStep = campaign?.steps[0];
  const nextStepAt = new Date();
  if (firstStep) nextStepAt.setDate(nextStepAt.getDate() + firstStep.delayDays);

  return {
    id: randomUUID(),
    campaignId: params.campaignId,
    customerId: params.customerId,
    customerPhone: params.customerPhone,
    customerName: params.customerName,
    currentStep: 0,
    status: "active",
    enrolledAt: new Date(),
    nextStepAt,
    metadata: params.metadata,
  };
}

/** Personalize a message template */
export function personalizeMessage(template: string, data: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}

log.info(`Drip campaign engine loaded: ${CAMPAIGNS.length} campaigns`);
