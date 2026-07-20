/**
 * Central SMS Message Catalog and Pricing Truth
 */

import { BUSINESS } from "@shared/business";

export const SERVICE_PRICE_TRUTH = {
  usedTires: "$60 installed for most standard sizes",
  oilConventional: "$49 conventional",
  oilSynthetic: "$80 synthetic",
  brakes: "starts at $149/axle",
  alignment: "starts at $79",
  diagnostic: "free check"
};

export interface ReplyConfig {
  expectedReplyTypes: string[];
  nextActionOnReply: string;
  adminPriority: "low" | "medium" | "high";
  conversionSignal: string;
}

export const REPLY_CONFIGS: Record<string, ReplyConfig> = {
  vapi_confirmation: {
    expectedReplyTypes: ["questions", "reschedule", "cancel"],
    nextActionOnReply: "nickgpt_or_admin",
    adminPriority: "low",
    conversionSignal: "vapi_confirmed_reply"
  },
  vapi_forwarded_call_followup: {
    expectedReplyTypes: ["tire size", "service question", "call back", "price question"],
    nextActionOnReply: "callback_or_auto_price",
    adminPriority: "medium",
    conversionSignal: "vapi_forward_reply"
  },
  after_hours_capture: {
    expectedReplyTypes: ["urgency", "specific service", "cancel"],
    nextActionOnReply: "admin_nudge",
    adminPriority: "medium",
    conversionSignal: "after_hours_reply"
  },
  stale_lead_followup: {
    expectedReplyTypes: ["YES", "call me", "tomorrow", "no thanks"],
    nextActionOnReply: "callback_request_or_archive",
    adminPriority: "high",
    conversionSignal: "stale_lead_recovered"
  },
  abandoned_form_recovery: {
    expectedReplyTypes: ["size check", "pricing", "need appointment", "no thanks"],
    nextActionOnReply: "nickgpt_inquiry",
    adminPriority: "medium",
    conversionSignal: "form_recovered"
  },
  booking_reminder: {
    expectedReplyTypes: ["YES", "cancel", "late", "reschedule"],
    nextActionOnReply: "confirm_or_cancel_booking",
    adminPriority: "high",
    conversionSignal: "booking_confirmed"
  },
  review_request: {
    expectedReplyTypes: ["thanks", "done", "complaint"],
    nextActionOnReply: "complaint_review_flag",
    adminPriority: "high",
    conversionSignal: "review_sentiment"
  },
  price_question_oil: {
    expectedReplyTypes: ["when can I come", "do conventional", "need appointment"],
    nextActionOnReply: "auto_send_hours",
    adminPriority: "medium",
    conversionSignal: "oil_inquiry_replied"
  },
  price_question_tires: {
    expectedReplyTypes: ["have my size", "when open", "do alignment"],
    nextActionOnReply: "size_check_prompt",
    adminPriority: "medium",
    conversionSignal: "tire_inquiry_replied"
  },
  price_question_brakes: {
    expectedReplyTypes: ["how long it takes", "pricing details", "come today"],
    nextActionOnReply: "inspect_offer",
    adminPriority: "medium",
    conversionSignal: "brake_inquiry_replied"
  },
  price_question_alignment: {
    expectedReplyTypes: ["come now", "appointment needed"],
    nextActionOnReply: "auto_send_hours",
    adminPriority: "medium",
    conversionSignal: "alignment_inquiry_replied"
  },
  price_question_diagnostic: {
    expectedReplyTypes: ["coming now", "check engine light"],
    nextActionOnReply: "inspect_offer",
    adminPriority: "medium",
    conversionSignal: "diagnostic_inquiry_replied"
  },
  hours_location: {
    expectedReplyTypes: ["coming now", "can I drop off"],
    nextActionOnReply: "confirm_walkin",
    adminPriority: "low",
    conversionSignal: "hours_replied"
  },
  same_day_visit: {
    expectedReplyTypes: ["coming now", "dropping off"],
    nextActionOnReply: "confirm_walkin",
    adminPriority: "low",
    conversionSignal: "visit_replied"
  },
  drop_off: {
    expectedReplyTypes: ["keys location", "when finished"],
    nextActionOnReply: "dropoff_instructions",
    adminPriority: "low",
    conversionSignal: "drop_off_replied"
  }
};

// Exported so the copy contract in sms.forwarded-followup-copy.test.ts can
// assert on the real variants rather than a duplicated copy that drifts.
export const TEMPLATE_VARIANTS: Record<string, string[]> = {
  vapi_confirmation: [
    "Got your request at Nick's Tire & Auto. We're walk-in and first come, first served — but we saw your message and we'll help you when you pull up. Open Mon-Sat 8-6, Sun 9-4. Questions? {shopPhone}",
    "We got your request. We're at 17625 Euclid Ave, Cleveland. Just pull up when you're ready and we'll take care of you. Mon-Sat 8-6, Sun 9-4. Questions? {shopPhone}",
    "Got you down. Nick's is first come, first served, so walk in anytime. We're at 17625 Euclid Ave, open 7 days. Questions? Call or text {shopPhone}"
  ],
  // 2026-07-20 · NEVER claim we missed the call here. This type fires on VAPI's
  // `assistant-forwarded-call` ended reason, which is a SUCCESSFUL hand-off to a
  // human — so the caller most often DID reach the shop. Two prior variants
  // opened "Sorry we missed your call" / "We missed your call", which meant a
  // customer who just spent five minutes with the crew got an apology for being
  // ignored. Every variant below must read correctly whether or not a human
  // picked up: continue the conversation, never apologize for a call we took.
  vapi_forwarded_call_followup: [
    "Hey, this is Nick's Tire & Auto on Euclid. We saw your request and wanted to help. What's going on with the car — tires, brakes, check engine, or something else?",
    "Hey, this is Nick's Tire & Auto. Text us the tire size or what the car is doing and the crew will pick it up from here.",
    "Hey, this is the team at Nick's. Anything else we can help you with on the car? Text us here or call {shopPhone}."
  ],
  after_hours_capture: [
    "Thanks for reaching out to Nick's Tire & Auto. We're closed right now, but we got your message. We'll reach back out when we open at {nextOpen}.",
    "Thanks for texting Nick's. We're closed for the day, but we've got your message. We'll text or call you back tomorrow morning when we open.",
    "Got your request. We're closed right now, but we'll reach back out when we open. If it's urgent, text us what's going on with the car."
  ],
  stale_lead_followup: [
    "Hey, this is Nick's on Euclid. Just checking if you still need help with the car? Let us know or call us at {shopPhone} to get it sorted.",
    "Hey, just checking if you still need that service we talked about. We can work you in if you bring the car by.",
    "Following up from Nick's. Let us know if you still need us to take a look at the car. Pull up anytime."
  ],
  abandoned_form_recovery: [
    "Looks like you started checking tires or booking a visit at Nick's but didn't finish. Text us here if you have any questions or just walk in anytime.",
    "Hey, this is Nick's Tire & Auto. We saw you started booking but didn't finish. Let us know if you need help or have questions about tires or service.",
    "Want to finish setting up your visit? Just walk in anytime we're open, or text us here if you need a quick answer."
  ],
  "booking_reminder:confirmation-request": [
    "Still planning to swing by? Reply YES to let us know, or just walk in anytime open. {shopPhone}",
    "Checking if you're still coming in today. Text YES to confirm, or walk in whenever it's easy.",
    "Are we still good for your visit? Reply YES to confirm. Walk-ins are always welcome too."
  ],
  "booking_reminder:24h-before": [
    "Reminder from Nick's: we're expecting you tomorrow. We're first come, first served, so earlier is usually better. Open Mon-Sat 8-6, Sun 9-4.",
    "Reminder for your visit tomorrow. Stop by anytime we're open and we'll work you in.",
    "We'll see you tomorrow. Pull up when you get here and we'll check it out."
  ],
  "booking_reminder:1h-before": [
    "Just a heads up — we're expecting you soon at 17625 Euclid Ave. Pull up when you're ready. Questions? {shopPhone}",
    "Just a heads up we're expecting you soon. Pull in and the crew will get you sorted.",
    "We'll see you in about an hour. Call or text if you need help finding us."
  ],
  "booking_reminder:thank-you": [
    "Hey, thanks again for coming by Nick's. If anything feels off or you have a question about the work, text or call us here. We'll take care of you. {shopPhone}",
    "Thanks for coming by today. Reach out if anything comes up — we'll make it right.",
    "Appreciate your business. Let us know if we can help you with anything down the road."
  ],
  "booking_reminder:maintenance-reminder": [
    "Due for an oil change? conventional is $49, synthetic is $80. Walk in any day, no appointment. Nick's Tire & Auto, {shopPhone}",
    "Time for routine maintenance? Conventional oil changes are $49, synthetic is $80. Stop by.",
    "Need an oil change or tire check? Stop by 17625 Euclid Ave. We'll inspect everything first."
  ],
  booking_reminder: [
    "Hi {name}, reminder from Nick's about your {service} visit. Call {shopPhone} if anything changes.",
    "Quick reminder from Nick's about your {service} visit. Stop by during business hours.",
    "Friendly reminder about your {service} service. Pull up when you're ready and we'll check it out."
  ],
  review_request: [
    "Hey, hope everything's been good since your visit. If we earned it, a quick review helps Cleveland drivers find us: nickstire.org/review. Thanks!",
    "Hope we did a good job for you. If you have a minute, leave us a review: nickstire.org/review.",
    "Mind sharing your experience? A quick Google review helps us out: nickstire.org/review."
  ],
  price_question_oil: [
    "Oil changes are $49 for conventional and $80 for full synthetic. Walk in any day — no appointment needed.",
    "Conventional oil change is $49, synthetic is $80. Includes a free vehicle check. Stop by anytime.",
    "It's $49 for conventional and $80 for full synthetic. Just pull up when you're ready."
  ],
  price_question_tires: [
    "Used tires start around $60 installed for most standard sizes. Pull up and we'll check your size and what we have in stock before you decide.",
    "We do used tires starting around $60 installed for standard sizes. Pull up and we'll check what we have in stock.",
    "Used tires are $60 installed for most sizes. Walk in anytime and we'll check your size."
  ],
  price_question_brakes: [
    "Brake work starts with a check first (brakes start around $149 per axle). Bring it in and we'll look it over, show you what's worn, and give you the price before doing anything.",
    "Brakes start around $149 per axle. We'll inspect them first and give you a quote before doing any work.",
    "Brake check is free first. Bring it in and we'll inspect them for you."
  ],
  price_question_alignment: [
    "Alignment starts at $79. If the car pulls, shakes, or the tires are wearing uneven, bring it by and we'll check it first.",
    "Standard alignment starts at $79. Just pull up during business hours.",
    "Wheel alignment starts at $79. We'll inspect your steering and suspension first."
  ],
  price_question_diagnostic: [
    "Diagnostics start with a free check first. Bring it by and we'll scan it, look it over, and tell you what it needs before doing any work.",
    "We do a free check first. We'll scan the codes and let you know the cost first.",
    "Just bring it by. We'll check it out for free and tell you the price before we touch anything."
  ],
  hours_location: [
    "We're at 17625 Euclid Ave, Cleveland. Open Mon-Sat 8-6, Sun 9-4. Walk-ins welcome. Call or text {shopPhone}.",
    "17625 Euclid Ave, Cleveland, OH 44112. Open Mon-Sat 8-6, Sun 9-4. Walk-ins welcome.",
    "We are located at 17625 Euclid Ave. Mon-Sat 8am-6pm, Sun 9am-4pm. Stop by anytime."
  ],
  same_day_visit: [
    "Yes, you can come by today. We're first-come, first-served, so earlier is better. If you can drop it off, that helps us work it in faster.",
    "Yes, you can stop by today. If you can drop it off, that helps us work it in faster.",
    "Yes, bring it in. We're open till 6 today. Pull right up."
  ],
  drop_off: [
    "Dropping it off is perfect. Bring the keys in, tell us what's going on, and we'll call or text you before doing any work.",
    "Drop-off is no problem. We'll inspect it and call you with a quote before doing anything.",
    "You can drop it off anytime we're open. We'll text you when the job is done."
  ]
};

export function getTemplateVariant(
  eventType: string,
  context: Record<string, any> = {},
  variantIndex?: number
): { body: string; variantKey: string } {
  let lookupKey = eventType;
  if (eventType === "booking_reminder" && context.reminderType) {
    const specificKey = `booking_reminder:${context.reminderType}`;
    if (TEMPLATE_VARIANTS[specificKey]) {
      lookupKey = specificKey;
    }
  }

  const variants = TEMPLATE_VARIANTS[lookupKey] || TEMPLATE_VARIANTS[eventType] || [
    "Hi, we've received your request. Nick's Tire & Auto {shopPhone}."
  ];

  const index = variantIndex !== undefined
    ? Math.min(Math.max(0, variantIndex), variants.length - 1)
    : Math.floor(Math.random() * variants.length);

  let raw = variants[index];
  const variantKey = `${lookupKey}_v${index + 1}`;

  // Replace placeholders
  const name = context.name ? context.name.split(" ")[0] : "there";
  const service = context.service || "service";
  const nextOpen = context.nextOpen || "8:00 AM";
  const shopPhone = BUSINESS.phone.display;

  raw = raw
    .replace(/{name}/g, name)
    .replace(/{service}/g, service)
    .replace(/{nextOpen}/g, nextOpen)
    .replace(/{shopPhone}/g, shopPhone);

  return { body: raw, variantKey };
}

export interface ExperimentAssignment {
  body: string;
  variantKey: string;
  experimentId: string;
  isControl: boolean;
  trafficWeight: number;
  variantAssignmentReason: string;
  selectedTemplateKey: string;
}

export function assignVariantWithExperiment(
  eventType: string,
  context: Record<string, any> = {}
): ExperimentAssignment {
  let lookupKey = eventType;
  if (eventType === "booking_reminder" && context.reminderType) {
    const specificKey = `booking_reminder:${context.reminderType}`;
    if (TEMPLATE_VARIANTS[specificKey]) {
      lookupKey = specificKey;
    }
  }

  const variants = TEMPLATE_VARIANTS[lookupKey] || TEMPLATE_VARIANTS[eventType] || [
    "Hi, we've received your request. Nick's Tire & Auto {shopPhone}."
  ];

  const experimentId = `exp_${lookupKey}_v1_vs_challengers`;
  
  // Traffic split: 80% control (v1), 10% challenger 1 (v2), 10% challenger 2 (v3)
  let weights: number[] = [];
  if (variants.length === 1) {
    weights = [100];
  } else if (variants.length === 2) {
    weights = [80, 20];
  } else {
    weights = [80];
    const remaining = 20 / (variants.length - 1);
    for (let i = 1; i < variants.length; i++) {
      weights.push(remaining);
    }
  }

  const roll = Math.random() * 100;
  let selectedIndex = 0;
  let runningSum = 0;
  for (let i = 0; i < weights.length; i++) {
    runningSum += weights[i];
    if (roll <= runningSum) {
      selectedIndex = i;
      break;
    }
  }

  const raw = variants[selectedIndex];
  const variantKey = `${lookupKey}_v${selectedIndex + 1}`;
  const isControl = selectedIndex === 0;
  const trafficWeight = Math.round(weights[selectedIndex]);
  const variantAssignmentReason = `Experiment split roll: ${roll.toFixed(1)} / Weight sum up to ${runningSum.toFixed(1)}%`;

  // Replace placeholders
  const name = context.name ? context.name.split(" ")[0] : "there";
  const service = context.service || "service";
  const nextOpen = context.nextOpen || "8:00 AM";
  const shopPhone = BUSINESS.phone.display;

  const body = raw
    .replace(/{name}/g, name)
    .replace(/{service}/g, service)
    .replace(/{nextOpen}/g, nextOpen)
    .replace(/{shopPhone}/g, shopPhone);

  return {
    body,
    variantKey,
    experimentId,
    isControl,
    trafficWeight,
    variantAssignmentReason,
    selectedTemplateKey: lookupKey
  };
}

