/**
 * AI Receptionist — Twilio Voice webhook handlers for after-hours calls
 * Uses Twilio <Gather> for speech recognition + text-to-speech responses.
 * Feature flag: ai_receptionist_enabled (start DISABLED)
 */

import { createLogger } from "../lib/logger";
import { BUSINESS } from "@shared/business";

const log = createLogger("ai-receptionist");

const STORE_PHONE = BUSINESS.phone.display;
const STORE_ADDRESS = BUSINESS.address.full;
const HOURS = BUSINESS.hours.fullDisplay;

interface VoiceIntent {
  intent: "hours" | "appointment" | "pricing" | "location" | "status" | "transfer";
  message: string;
}

/**
 * Classify caller intent from speech transcription.
 * Fast keyword matching — no AI needed for common queries.
 */
export function classifyVoiceIntent(speech: string): VoiceIntent {
  const lower = speech.toLowerCase();

  // Hours
  if (/hours|open|close|when.*open|what time|are you open|sunday/i.test(lower)) {
    return {
      intent: "hours",
      message: `We're open ${HOURS}. Walk-ins are always welcome! Is there anything else I can help with?`,
    };
  }

  // Location / directions
  if (/where|located|address|directions|find you|how.*get there/i.test(lower)) {
    return {
      intent: "location",
      message: `We're at ${STORE_ADDRESS}. Right on Euclid Avenue, easy to find with plenty of parking. Would you like me to send you directions via text?`,
    };
  }

  // Appointment / booking
  if (/appointment|book|schedule|come in|bring.*car|drop off|available/i.test(lower)) {
    return {
      intent: "appointment",
      message: "I'd be happy to help! Walk-ins are welcome during business hours — first-come, first-served — or you can schedule a drop-off at nickstire dot org. Would you like me to have someone call you back?",
    };
  }

  // Pricing
  if (/price|cost|how much|estimate|quote|charge/i.test(lower)) {
    return {
      intent: "pricing",
      // oil price: keep in sync with OIL_PRICE
      message: `Our pricing depends on the service and vehicle. Oil changes start at $49, brake pads from $89, and ${BUSINESS.usedTires.explanation}. For an exact quote, visit nickstire dot org or call us during business hours at ${BUSINESS.phone.dashed}.`,
    };
  }

  // Status check
  if (/status|my car|ready|pick up|done|finished/i.test(lower)) {
    return {
      intent: "status",
      message: `I can't check vehicle status after hours, but you can call us during business hours at ${BUSINESS.phone.dashed} and we'll give you an update right away.`,
    };
  }

  // Default: transfer intent
  return {
    intent: "transfer",
    message: `I'd like to connect you with our team so they can help you directly. Please call us during business hours at ${BUSINESS.phone.dashed}, or leave your name and number and we'll call you first thing.`,
  };
}

/**
 * Generate TwiML response for incoming voice call.
 * Returns XML string for Twilio.
 */
export function generateGreetingTwiML(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew" language="en-US">Thanks for calling Nick's Tire and Auto, Cleveland's top-rated auto repair shop. How can I help you today?</Say>
  <Gather input="speech" timeout="5" speechTimeout="auto" action="/api/v1/webhooks/voice/process" method="POST" language="en-US">
  </Gather>
  <Say voice="Polly.Matthew">I didn't catch that. Please tell me what you need, or press 0 to leave a message.</Say>
  <Gather input="speech dtmf" timeout="5" action="/api/v1/webhooks/voice/process" method="POST">
  </Gather>
  <Say voice="Polly.Matthew">Thank you for calling. Please call us during business hours at ${BUSINESS.phone.dashed}. Have a great day!</Say>
</Response>`;
}

/**
 * Generate TwiML response after processing speech input.
 */
export function generateResponseTwiML(speechResult: string): string {
  const result = classifyVoiceIntent(speechResult);

  log.info("Voice intent classified", { intent: result.intent, speech: speechResult.slice(0, 100) });

  if (result.intent === "transfer") {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">${result.message}</Say>
</Response>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">${result.message}</Say>
  <Gather input="speech dtmf" timeout="5" action="/api/v1/webhooks/voice/process" method="POST">
    <Say voice="Polly.Matthew">Is there anything else I can help with? Press 0 to speak with someone.</Say>
  </Gather>
  <Say voice="Polly.Matthew">Thank you for calling Nick's Tire and Auto. Have a great day!</Say>
</Response>`;
}
