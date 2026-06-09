/**
 * Unit tests for the lead-source classifier — the single discriminator behind
 * the Money-Risks double-count fix and the Leads source badges.
 *
 * The load-bearing rule: a `source="callback"` lead is a DUPLICATE only when it
 * is LINKED (callbackId set) to a callback_requests row. Voice rack-check leads
 * (callbackId null) are NOT duplicates and must keep counting.
 */
import { describe, it, expect } from "vitest";
import {
  classifyLeadOrigin,
  isCallbackDuplicateLead,
  isOperationalCallerLead,
  leadSourceLabel,
  countActionableLeads,
} from "@shared/leadSource";

describe("classifyLeadOrigin", () => {
  it("classifies real web/form sources as trueLead", () => {
    for (const source of ["popup", "chat", "booking", "manual", "fleet", "financing_preapproval", "sms", "careers"]) {
      expect(classifyLeadOrigin({ source })).toBe("trueLead");
    }
  });

  it("classifies a linked callback lead (callbackId set) as duplicateLink", () => {
    expect(classifyLeadOrigin({ source: "callback", callbackId: 7 })).toBe("duplicateLink");
  });

  it("classifies a voice-agent rack-check callback (no callbackId) as phoneCall", () => {
    expect(classifyLeadOrigin({ source: "callback", callbackId: null, utmCampaign: "vapi-rack-check" })).toBe("phoneCall");
    expect(classifyLeadOrigin({ source: "callback", utmMedium: "phone" })).toBe("phoneCall");
  });

  it("classifies an unlinked, non-voice callback as operationalCallback", () => {
    expect(classifyLeadOrigin({ source: "callback", callbackId: null })).toBe("operationalCallback");
  });

  it("classifies missing/blank source as unknown", () => {
    expect(classifyLeadOrigin({})).toBe("unknown");
    expect(classifyLeadOrigin({ source: "" })).toBe("unknown");
    expect(classifyLeadOrigin({ source: "   " })).toBe("unknown");
  });
});

describe("isCallbackDuplicateLead — the Money-Risks exclusion predicate", () => {
  it("is true ONLY for a linked callback lead", () => {
    expect(isCallbackDuplicateLead({ source: "callback", callbackId: 7 })).toBe(true);
  });

  it("is false for a voice rack-check callback (counted once, no callback row)", () => {
    expect(isCallbackDuplicateLead({ source: "callback", callbackId: null, utmCampaign: "vapi-rack-check" })).toBe(false);
  });

  it("is false for real web leads", () => {
    expect(isCallbackDuplicateLead({ source: "popup" })).toBe(false);
    expect(isCallbackDuplicateLead({ source: "chat" })).toBe(false);
  });

  it("is false when source is missing", () => {
    expect(isCallbackDuplicateLead({})).toBe(false);
  });
});

describe("isOperationalCallerLead", () => {
  it("is true for any source=callback lead", () => {
    expect(isOperationalCallerLead({ source: "callback", callbackId: 7 })).toBe(true);
    expect(isOperationalCallerLead({ source: "callback", callbackId: null })).toBe(true);
    expect(isOperationalCallerLead({ source: "callback", utmMedium: "phone" })).toBe(true);
  });

  it("is false for real web leads and unknown", () => {
    expect(isOperationalCallerLead({ source: "popup" })).toBe(false);
    expect(isOperationalCallerLead({})).toBe(false);
  });
});

describe("leadSourceLabel", () => {
  it("labels voice as PHONE and callbacks as CALLBACK", () => {
    expect(leadSourceLabel({ source: "callback", utmCampaign: "vapi-rack-check" })).toBe("PHONE");
    expect(leadSourceLabel({ source: "callback", callbackId: 7 })).toBe("CALLBACK");
    expect(leadSourceLabel({ source: "callback", callbackId: null })).toBe("CALLBACK");
  });

  it("upper-cases a real source and dashes the unknown", () => {
    expect(leadSourceLabel({ source: "popup" })).toBe("POPUP");
    expect(leadSourceLabel({ source: "financing_preapproval" })).toBe("FINANCING_PREAPPROVAL");
    expect(leadSourceLabel({})).toBe("—");
  });
});

describe("countActionableLeads — server-side risk-count exclusion", () => {
  it("excludes a linked callback duplicate lead (already counted as a callback)", () => {
    expect(countActionableLeads([{ source: "callback", callbackId: 7 }])).toBe(0);
  });

  it("still counts a voice rack-check callback lead (callbackId null, no callback row)", () => {
    expect(countActionableLeads([{ source: "callback", callbackId: null, utmCampaign: "vapi-rack-check" }])).toBe(1);
  });

  it("counts normal web leads (popup / chat / booking)", () => {
    expect(countActionableLeads([{ source: "popup" }, { source: "chat" }, { source: "booking" }])).toBe(3);
  });

  it("excludes ONLY the linked callback from a mixed set", () => {
    const rows = [
      { source: "popup" },                                                         // real lead -> kept
      { source: "callback", callbackId: 12 },                                      // linked dup -> excluded
      { source: "callback", callbackId: null, utmCampaign: "vapi-rack-check" },     // voice -> kept
      { source: "chat" },                                                          // real lead -> kept
    ];
    expect(countActionableLeads(rows)).toBe(3);
  });

  it("returns 0 for an empty list", () => {
    expect(countActionableLeads([])).toBe(0);
  });
});
