import { describe, it, expect } from "vitest";
import { detectIntents } from "../../server/services/vapiCallClassifier";
import { episodeKey, intentFamily } from "../../shared/callTaxonomy";
import { classifyVoiceDemand } from "../../server/services/voiceDemandClassifier";
import {
  clusterIncidents,
  countMatches,
  customerToken,
  linkConfidence,
  namePresent,
  recontacts,
  excerptAround,
  FRICTION_PATTERNS,
  frictionOf,
  isOpen,
  episodeNeed,
  isTireIntent,
  maskPII,
  parseTurns,
  phoneKey,
  PROMISE_PATTERNS,
  sessionize,
  type Contact,
} from "./customerCorpus";

describe("the two live-kernel defects the census measures", () => {
  it("POSITIVE CONTROL: the live classifier finds no intent in a bare tire request", () => {
    // If this ever fails, detectIntents learned bare tire requests and the
    // census's "intent-less but tire words" count should read ~0.
    for (const s of ["I need two tires for my Honda", "do you guys have tires", "I need a tire"]) {
      expect(detectIntents(s)).toEqual([]);
      expect(intentFamily(detectIntents(s))).toBe("general");
    }
  });

  it("the existing (unwired) demand classifier the census reuses reads them as a tire need", () => {
    for (const s of ["I need two tires for my Honda", "do you guys have tires", "I need a tire"]) {
      expect(isTireIntent(episodeNeed([s]).need)).toBe(true);
    }
  });

  it("POSITIVE CONTROL: episodeKey splits one need ten minutes apart across 8 PM Eastern", () => {
    const a = new Date("2026-09-15T23:55:00Z"); // 7:55 PM EDT
    const b = new Date("2026-09-16T00:05:00Z"); // 8:05 PM EDT
    expect(episodeKey("2165550100", "tire", a)).not.toBe(episodeKey("2165550100", "tire", b));
  });

  it("gap sessionization keeps those two contacts in one episode", () => {
    const eps = sessionize([
      { phone10: "2165550100", at: new Date("2026-09-15T23:55:00Z"), channel: "call", ref: "c1" },
      { phone10: "2165550100", at: new Date("2026-09-16T00:05:00Z"), channel: "call", ref: "c2" },
    ]);
    expect(eps).toHaveLength(1);
    expect(eps[0]!.contacts).toHaveLength(2);
  });
});

describe("sessionize", () => {
  const c = (phone10: string, iso: string, channel: Contact["channel"] = "call", ref = iso): Contact => ({
    phone10, at: new Date(iso), channel, ref,
  });

  it("a gap longer than the window opens a new episode; the gap is measured from the LAST contact", () => {
    const eps = sessionize([
      c("2165550100", "2026-09-01T14:00:00Z"),
      c("2165550100", "2026-09-02T12:00:00Z"), // 22h after the first — continues
      c("2165550100", "2026-09-03T10:00:00Z"), // 22h after the second — continues (chained)
      c("2165550100", "2026-09-05T10:00:00Z"), // 48h gap — new episode
    ]);
    expect(eps.map((e) => e.contacts.length)).toEqual([3, 1]);
  });

  it("an outbound text never opens an episode, but attaches to an open one", () => {
    const eps = sessionize([
      c("2165550100", "2026-09-01T14:00:00Z", "sms_out"),
      c("2165550100", "2026-09-02T14:00:00Z", "sms_in"),
      c("2165550100", "2026-09-02T15:00:00Z", "sms_out"),
    ]);
    expect(eps).toHaveLength(1);
    expect(eps[0]!.contacts.map((x) => x.channel)).toEqual(["sms_in", "sms_out"]);
  });

  it("different customers never share an episode; a phoneless call is its own", () => {
    const eps = sessionize([
      c("2165550100", "2026-09-01T14:00:00Z"),
      c("2165550199", "2026-09-01T14:01:00Z"),
      c("", "2026-09-01T14:02:00Z"),
    ]);
    expect(eps).toHaveLength(3);
  });
});

describe("masking — mask before you match, match before you print", () => {
  it("removes every phone shape, email, VIN and a spoken number", () => {
    const raw = "call me at (216) 555-0100 or 2165550100, mail a@b.co, VIN 1HGCM82633A004352, it's two one six five five five zero one zero zero";
    const m = maskPII(raw);
    expect(m).not.toMatch(/555/);
    expect(m).not.toMatch(/a@b\.co/);
    expect(m).not.toMatch(/1HGCM82633A004352/);
    expect(m).toContain("[SPOKEN-NUMBER]");
  });

  it("names after an introduction are masked", () => {
    expect(maskPII("Hi, my name is Jordan Example and I need tires")).toBe("Hi, my name is [NAME] and I need tires");
  });

  it("an excerpt is a short window, never the line, and already masked", () => {
    const line = "okay so like I said my number is 216-555-0100 and I need four tires today please thanks a lot for everything";
    const ex = excerptAround(line, FRICTION_PATTERNS.repeated_self, 4)!;
    expect(ex).toContain("like I said");
    expect(ex).not.toMatch(/555/);
    expect(ex.split(/\s+/).length).toBeLessThanOrEqual(12);
  });

  it("a customer token is stable inside a run and different across salts", () => {
    expect(customerToken("2165550100", "s1")).toBe(customerToken("2165550100", "s1"));
    expect(customerToken("2165550100", "s1")).not.toBe(customerToken("2165550100", "s2"));
    expect(phoneKey("+1 (216) 555-0100")).toBe("2165550100");
    expect(phoneKey("555-0100")).toBe("");
  });
});

describe("turns", () => {
  it("prefers role-tagged messages and keeps both speakers", () => {
    const t = parseTurns("User: ignored", [
      { role: "system", message: "prompt" },
      { role: "bot", message: "Nick's Tire, how can I help?" },
      { role: "user", message: "Do you have 225/65R17 in stock?" },
    ]);
    expect(t).toEqual([
      { role: "assistant", text: "Nick's Tire, how can I help?" },
      { role: "customer", text: "Do you have 225/65R17 in stock?" },
    ]);
  });

  it("falls back to the prefixed transcript, joining continuation lines", () => {
    const t = parseTurns("AI: Hello\nUser: I need a patch\nfor my rear tire\nAI: Sure", null);
    expect(t.filter((x) => x.role === "customer").map((x) => x.text)).toEqual(["I need a patch for my rear tire"]);
  });

  it("an unprefixed transcript yields nothing rather than a guess", () => {
    expect(parseTurns("hello i need tires", null)).toEqual([]);
  });
});

describe("needs, friction, promises", () => {
  it("an opening request for a person does not hide the need stated later", () => {
    const n = episodeNeed(["can I speak to a manager", "yeah it's about my brakes grinding"]);
    expect(n.openedWithHuman).toBe(true);
    expect(n.need).toBe("brakes");
    expect(n.all).toEqual(["human_requested", "brakes"]);
  });

  it("a caller who only asks for a person is recorded as exactly that", () => {
    const n = episodeNeed(["hello?", "manager, please"]);
    expect(n.need).toBe("human_requested");
    expect(n.openedWithHuman).toBe(true);
  });

  it("a status call about a car already at the shop is not a sales need", () => {
    expect(episodeNeed(["hey I dropped my car off this morning, is it done"]).need).toBe("active_job_status");
  });

  it("POSITIVE CONTROL: the raw demand classifier reads a phone number as a tire size; the census masks first", () => {
    const s = "you can reach me at (216) 555-0102";
    expect(classifyVoiceDemand(s).intent).toBe("tire_size_help");
    expect(episodeNeed([s]).need).not.toBe("tire_size_help");
  });

  it("nothing classifiable stays unclear, never a default bucket", () => {
    expect(episodeNeed(["hello?", "uh"]).need).toBe("unclear");
  });

  it("friction primitives count per turn and stay separate", () => {
    const f = frictionOf([
      "I already told you it's a 2015 Camry",
      "can I talk to a real person",
      "nobody called me back yesterday",
      "I need tires",
    ]);
    expect(f.repeated_self).toBe(1);
    expect(f.wants_human).toBe(1);
    expect(f.broken_promise).toBe(1);
    expect(f.frustration).toBe(0);
  });

  it("assistant commitments are counted as promises", () => {
    const p = countMatches(
      ["Someone from the shop will call you back shortly.", "Let me have the team check the rack.", "Anything else?"],
      PROMISE_PATTERNS,
    );
    expect(p.callback).toBe(1);
    expect(p.rack_check).toBe(1);
    expect(p.text_followup).toBe(0);
  });
});

describe("open hours come from BUSINESS.hours.structured", () => {
  it("Monday 5:59 PM Eastern is open, 6:00 PM closed; Sunday 4:30 PM closed", () => {
    expect(isOpen(new Date("2026-09-21T21:59:00Z"))).toBe(true); // Mon 17:59 EDT
    expect(isOpen(new Date("2026-09-21T22:00:00Z"))).toBe(false); // Mon 18:00 EDT
    expect(isOpen(new Date("2026-09-20T20:30:00Z"))).toBe(false); // Sun 16:30 EDT
    expect(isOpen(new Date("2026-09-20T14:00:00Z"))).toBe(true); // Sun 10:00 EDT
  });
});

describe("recontact, link confidence, incident grouping", () => {
  const at = (iso: string) => new Date(iso);

  it("a reconnect under 10 minutes after the call ENDED is immediate; a later one is a recontact", () => {
    const r = recontacts([
      { at: at("2026-09-15T14:00:00Z"), endAt: at("2026-09-15T14:05:00Z") },
      { at: at("2026-09-15T14:08:00Z"), endAt: at("2026-09-15T14:09:00Z") }, // 3 min after end
      { at: at("2026-09-15T16:00:00Z") }, // hours later
    ]);
    expect(r).toEqual({ immediate: 1, later: 1 });
  });

  it("different need families across contacts are ambiguous; tire intents are one family", () => {
    expect(linkConfidence(["used_tire_price"])).toBe("single");
    expect(linkConfidence(["used_tire_price", "tire_size_help", "unclear"])).toBe("consistent");
    expect(linkConfidence(["human_requested", "brakes"])).toBe("consistent");
    expect(linkConfidence(["brakes", "used_tire_price"])).toBe("ambiguous");
  });

  it("three customers failing inside an hour is one incident; two is not", () => {
    const f = (iso: string, p: string) => ({ at: at(iso), phone10: p });
    const incidents = clusterIncidents([
      f("2026-09-15T14:00:00Z", "2165550101"),
      f("2026-09-15T14:20:00Z", "2165550102"),
      f("2026-09-15T15:10:00Z", "2165550103"), // 50 min after the last — same cluster
      f("2026-09-16T14:00:00Z", "2165550104"),
      f("2026-09-16T14:10:00Z", "2165550105"),
    ]);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ customers: 3, failures: 3 });
  });

  it("the same customer failing three times is not a system incident", () => {
    const p = "2165550101";
    expect(clusterIncidents([
      { at: at("2026-09-15T14:00:00Z"), phone10: p },
      { at: at("2026-09-15T14:05:00Z"), phone10: p },
      { at: at("2026-09-15T14:10:00Z"), phone10: p },
    ])).toEqual([]);
  });

  it("a name is recorded as present, never returned", () => {
    expect(namePresent("hi this is Jordan with a flat")).toBe(true);
    expect(namePresent("hi I need a flat fixed")).toBe(false);
  });
});
