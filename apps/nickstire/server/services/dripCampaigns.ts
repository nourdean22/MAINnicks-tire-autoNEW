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
      { stepNumber: 1, delayDays: 0, channel: "sms", messageTemplate: "Hey, thanks again for coming by Nick's Tire & Auto. If anything feels off or you have a question about the work, text or call us here. We'll take care of you. (216) 862-0005" },
      { stepNumber: 2, delayDays: 3, channel: "sms", messageTemplate: "Hey, hope everything's been good since your visit. If we earned it, a quick Google review helps other Cleveland drivers find a shop they can trust: nickstire.org/review" },
      { stepNumber: 3, delayDays: 30, channel: "sms", messageTemplate: "Checking in from Nick's — how's the car running? Anything you want a second look at, the check is free. Call or text (216) 862-0005" },
    ],
  },
  {
    id: "new-customer-welcome",
    name: "New Customer Welcome",
    trigger: "new-customer",
    isActive: true,
    steps: [
      { stepNumber: 1, delayDays: 0, channel: "sms", messageTemplate: "Welcome to Nick's Tire & Auto — save our number: (216) 862-0005. If you ever need help with tires, brakes, or check engine, text or call us anytime." },
      { stepNumber: 2, delayDays: 7, channel: "sms", messageTemplate: "Quick tip from Nick's: checking your tire pressure monthly helps them wear evenly and last longer. Free air check anytime, just pull up." },
      { stepNumber: 3, delayDays: 60, channel: "sms", messageTemplate: "About time for an oil change or tire check? conventional oil changes are $49 and synthetic is $80. Walk in any day — no appointment needed. (216) 862-0005" },
    ],
  },
  {
    id: "at-risk-winback",
    name: "At-Risk Customer Win-Back",
    trigger: "at-risk",
    isActive: true,
    steps: [
      { stepNumber: 1, delayDays: 0, channel: "sms", messageTemplate: "It's been a while — Nick's Tire & Auto is here 7 days a week. Conventional oil changes are $49, full synthetic is $80. Walk in any day, no appointment. (216) 862-0005" },
      { stepNumber: 2, delayDays: 14, channel: "sms", messageTemplate: "Still here at Nick's on Euclid. Walk-ins welcome Mon-Sat 8-6, Sun 9-4, no appointment needed. If the car needs anything checked, stop on by. (216) 862-0005" },
      { stepNumber: 3, delayDays: 30, channel: "sms", messageTemplate: "Free check on us this month — written quote first, you don't pay until you say yes. Whenever it's easy, pull up any day. Nick's Tire & Auto, (216) 862-0005", condition: "only if no visit since enrollment" },
    ],
  },
  {
    id: "declined-estimate",
    name: "Declined Estimate Follow-Up",
    trigger: "declined-estimate",
    isActive: true,
    steps: [
      { stepNumber: 1, delayDays: 7, channel: "sms", messageTemplate: "Following up from Nick's on that quote — it still stands. If cost was the holdup, we can go over payment options with you. Free re-check first. (216) 862-0005" },
      { stepNumber: 2, delayDays: 30, channel: "sms", messageTemplate: "That quote is still in our system at Nick's. Stop in whenever it's easy for a free re-check — no charge, no obligation. (216) 862-0005" },
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
