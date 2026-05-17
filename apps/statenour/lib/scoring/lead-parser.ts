import { leadTypeValues, leadUrgencyValues } from "@/lib/domain";

type LeadType = (typeof leadTypeValues)[number];
type LeadUrgency = (typeof leadUrgencyValues)[number];

type LeadParserResult = {
  leadType: LeadType;
  urgency: LeadUrgency;
  valueEstimate: number;
  matchedKeywords: string[];
  explanation?: string;
};

const typeRules: Array<{ leadType: LeadType; keywords: string[]; baseValue: number }> = [
  {
    leadType: "TIRES",
    keywords: ["tire", "tires", "flat", "rim", "wheel", "rotate"],
    baseValue: 700
  },
  {
    leadType: "BRAKES",
    keywords: ["brake", "brakes", "rotor", "pads", "grinding", "squeal"],
    baseValue: 850
  },
  {
    leadType: "DIAGNOSTIC",
    keywords: ["diagnostic", "check engine", "light", "scan", "misfire"],
    baseValue: 450
  },
  {
    leadType: "OIL",
    keywords: ["oil", "maintenance", "filter"],
    baseValue: 140
  },
  {
    leadType: "REPAIR",
    keywords: ["repair", "suspension", "alignment", "noise", "ac", "battery", "won't start"],
    baseValue: 950
  }
];

const highUrgencyWords = ["today", "asap", "urgent", "stuck", "stranded", "tow", "grinding", "flat", "won't start"];
const lowUrgencyWords = ["quote", "estimate", "shopping", "next week", "sometime"];

export function parseLeadIntake(inquiryText: string): LeadParserResult {
  const normalized = inquiryText.toLowerCase();
  const matchedRule = typeRules.find((rule) => rule.keywords.some((keyword) => normalized.includes(keyword)));
  const matchedKeywords = matchedRule?.keywords.filter((keyword) => normalized.includes(keyword)) || [];

  let urgency: LeadUrgency = "MEDIUM";

  if (highUrgencyWords.some((word) => normalized.includes(word))) {
    urgency = "HIGH";
  } else if (lowUrgencyWords.some((word) => normalized.includes(word))) {
    urgency = "LOW";
  }

  const leadType = matchedRule?.leadType || "OTHER";
  let valueEstimate = matchedRule?.baseValue || 300;

  if (urgency === "HIGH") {
    valueEstimate += 120;
  } else if (urgency === "LOW") {
    valueEstimate -= 40;
  }

  return {
    leadType,
    urgency,
    valueEstimate,
    matchedKeywords,
    explanation: matchedKeywords.length
      ? `Matched ${matchedKeywords.join(", ")} and inferred ${leadType.toLowerCase()} with ${urgency.toLowerCase()} urgency.`
      : "No strong keywords found, defaulting to OTHER and medium urgency."
  };
}
