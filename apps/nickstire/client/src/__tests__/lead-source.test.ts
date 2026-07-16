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
  summarizeLeadSourceHygiene,
} from "@shared/leadSource";

describe("classifyLeadOrigin", () => {
  it("classifies real web/form sources as trueLead", () => {
    for (const source of ["popup", "chat", "booking", "manual", "fleet", "financing_preapproval", "sms", "careers", "diagnose"]) {
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
    expect(leadSourceLabel({ source: "diagnose" })).toBe("DIAGNOSE");
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

describe("summarizeLeadSourceHygiene — read-only admin rollup", () => {
  it("counts leads per label and classifies the callback cluster", () => {
    const s = summarizeLeadSourceHygiene(
      [
        { source: "popup", phone: "(216) 555-0001" },
        { source: "callback", callbackId: 7, phone: "2165550002" },                       // linked dup
        { source: "callback", callbackId: null, utmCampaign: "vapi-rack-check", phone: "2165550003" }, // voice
        { source: "", phone: "2165550004" },                                               // blank (legacy coercion)
      ],
      [],
    );
    expect(s.totalLeads).toBe(4);
    expect(s.countsByLabel["POPUP"]).toBe(1);
    expect(s.countsByLabel["CALLBACK"]).toBe(1);
    expect(s.countsByLabel["PHONE"]).toBe(1);
    expect(s.linkedCallbackDuplicates).toBe(1);
    expect(s.voiceLeads).toBe(1);
    expect(s.blankSourceLeads).toBe(1);
  });

  it("detects phone overlap between leads and callbacks despite formatting", () => {
    const s = summarizeLeadSourceHygiene(
      [
        { source: "popup", phone: "(216) 555-0001" },
        { source: "chat", phone: "216-555-0009" },
      ],
      [
        { phone: "12165550001" },   // same person, +1 prefix
        { phone: "2165559999" },    // no lead match
      ],
    );
    expect(s.phoneOverlapCount).toBe(1);
  });

  it("ignores blank/short phones and returns zeros for empty input", () => {
    const s = summarizeLeadSourceHygiene(
      [{ source: "popup", phone: "000" }, { source: "popup", phone: null }],
      [{ phone: "" }],
    );
    expect(s.phoneOverlapCount).toBe(0);
    const empty = summarizeLeadSourceHygiene([], []);
    expect(empty.totalLeads).toBe(0);
    expect(empty.phoneOverlapCount).toBe(0);
  });

  it("counts overlap as distinct phones, not row pairs", () => {
    const s = summarizeLeadSourceHygiene(
      [{ source: "popup", phone: "2165550001" }],
      [{ phone: "2165550001" }, { phone: "(216) 555-0001" }], // two callback rows, one person
    );
    expect(s.phoneOverlapCount).toBe(1);
  });
});
