/**
 * NickGPT Deterministic Preflight Guard
 */

export interface PreflightParams {
  eventType: string;
  body: string;
  inboundMessage?: string;
  sourceType: string;
  provider: string;
}

export function runNickgptPreflightGuard(params: PreflightParams): { allowed: boolean; reasonCode: string; details?: any } {
  const { body, sourceType } = params;
  
  if (sourceType !== "nickgpt") {
    return { allowed: true, reasonCode: "not_nickgpt" };
  }

  const lowerBody = body.toLowerCase();
  
  // Rule 1: No promises of free stuff
  if (lowerBody.includes("free") && (lowerBody.includes("give") || lowerBody.includes("offer"))) {
    return { allowed: false, reasonCode: "prohibited_offer_promises" };
  }
  
  // Rule 2: No swearing / toxicity
  const toxicRegex = /\b(fuck|shit|bitch|asshole|cunt)\b/i;
  if (toxicRegex.test(lowerBody)) {
    return { allowed: false, reasonCode: "toxicity_detected" };
  }

  // Rule 3: Must not exceed SMS segment limits drastically (e.g. 500 chars)
  if (body.length > 500) {
    return { allowed: false, reasonCode: "length_exceeded" };
  }

  // Rule 4: Must not include weird hallucinated variables like {name}
  if (body.includes("{") || body.includes("}")) {
    return { allowed: false, reasonCode: "unresolved_template_variables" };
  }

  return { allowed: true, reasonCode: "passed_heuristics" };
}
