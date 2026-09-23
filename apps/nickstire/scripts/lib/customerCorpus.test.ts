import { describe, it, expect } from "vitest";
import { detectIntents } from "../../server/services/vapiCallClassifier";
import { episodeKey, intentFamily } from "../../shared/callTaxonomy";
import { extractTireSize } from "../../shared/callDemandExtraction";
import { classifyVoiceDemand } from "../../server/services/voiceDemandClassifier";
import {
  ACKNOWLEDGEMENT,
  addDays,
  businessWeekKey,
  classifyTurn,
  clusterIncidents,
  countAsks,
  countPromises,
  customerToken,
  linkConfidence,
  linkInvoices,
  namePresent,
  recontacts,
  excerptAround,
  FRICTION_PATTERNS,
  frictionOf,
  isOpen,
  isOptOutText,
  episodeNeed,
  isTireIntent,
  maskForOutput,
  maskPII,
  maskTurns,
  parseTurns,
  phoneKey,
  sessionize,
  transferState,
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

  it("a gap longer than the window opens a new episode; the gap is measured from the LAST customer contact", () => {
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

  it("an automated outbound text attaches but never chains two needs into one episode (f6)", () => {
    // Old rule: the gap ran from the last contact of ANY kind, so a reminder
    // 23h after a brakes call and an oil question 23h after the reminder were
    // one 46-hour "episode". The anchor is the last CUSTOMER contact.
    const eps = sessionize([
      c("2165550100", "2026-09-14T14:00:00Z", "call"),
      c("2165550100", "2026-09-15T13:00:00Z", "sms_out"), // 23h after the call — attaches
      c("2165550100", "2026-09-16T12:00:00Z", "sms_in"), // 46h after the call — a new need
    ]);
    expect(eps.map((e) => e.contacts.map((x) => x.channel))).toEqual([["call", "sms_out"], ["sms_in"]]);
    expect(eps[0]!.lastCustomerEnd.toISOString()).toBe("2026-09-14T14:00:00.000Z");
    expect(eps[0]!.end.toISOString()).toBe("2026-09-15T13:00:00.000Z");
  });

  it("the gap runs from when a call ENDED, not when it started", () => {
    const eps = sessionize([
      { phone10: "2165550100", at: new Date("2026-09-14T14:00:00Z"), endAt: new Date("2026-09-14T15:00:00Z"), channel: "call", ref: "long" },
      c("2165550100", "2026-09-15T14:30:00Z", "sms_in"), // 24.5h after the start, 23.5h after the end
    ]);
    expect(eps).toHaveLength(1);
    expect(eps[0]!.lastCustomerEnd.toISOString()).toBe("2026-09-15T14:30:00.000Z");
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

  // Every case the independent reviewer found leaking (/tmp/cc/mask.mts), pinned
  // to its exact masked form. The old maskPII returned the input unchanged for
  // all but the first four and "17625 Euclid Ave".
  it.each([
    ["my number is 216 555 0123", "my number is [PHONE]"],
    ["it's 2 1 6 5 5 5 0 1 2 3", "it's [PHONE]"],
    ["216.555.0123", "[PHONE]"],
    ["call me at two one six, five five five, oh one two three", "call me at [SPOKEN-NUMBER]"],
    ["two one six 555 0123", "[NUMBER]"],
    ["my cell is 555-0123", "my cell is [PHONE]"],
    ["I live on 17625 Euclid Ave", "I live on [ADDRESS]"],
    ["I'm at 1234 East 185th Street", "I'm at [ADDRESS]"],
    ["pick me up at 1234 E 185th St", "pick me up at [ADDRESS]"],
    ["I'm on 450 Lake Shore Boulevard", "I'm on [ADDRESS]"],
    ["we're at 88 Maple Court now", "we're at [ADDRESS] now"],
    ["My name is Jordan Example", "My name is [NAME]"],
    ["This is Maria Lopez calling about my tires", "This is [NAME] calling about my tires"],
    ["It's Jordan", "It's [NAME]"],
    ["I'm Jordan", "I'm [NAME]"],
    ["I’m Jordan", "I'm [NAME]"], // curly apostrophe (iOS smart punctuation)
    ["Yeah, Maria. M-A-R-I-A.", "Yeah, [NAME]. [SPELLED]."],
    ["email is jordan.example at gmail dot com", "email is [EMAIL]"],
    ["it's jordan dot example at yahoo dot com", "it's [EMAIL]"],
    ["vin is 1hgcm82633a004352", "vin is [VIN]"],
  ])("maskPII(%j) → %j", (raw, masked) => {
    expect(maskPII(raw)).toBe(masked);
  });

  it("a STRONG introduction masks the next word whatever its case; a WEAK one only a capitalised word", () => {
    expect(maskPII("my name is jordan and I need tires")).toBe("my name is [NAME] and I need tires");
    expect(maskPII("name's Jordan Example")).toBe("name's [NAME]");
    expect(maskPII("you can call me Jordan")).toBe("you can call me [NAME]");
    expect(maskPII("call me jordan")).toBe("call me [NAME]");
    // ...but these are not names, and the words carry the customer's meaning:
    for (const s of ["it's fine", "I'm good", "this is about my brakes", "I am looking for tires", "it's a Honda",
      "call me back when it's ready", "call me at the shop", "can you call me tomorrow"]) {
      expect(maskPII(s)).toBe(s);
    }
  });

  it("namePresent sees the introductions maskPII masks", () => {
    expect(namePresent("My name is Jordan")).toBe(true);
    expect(namePresent("my name is jordan")).toBe(true);
    expect(namePresent("This is Maria")).toBe(true);
    expect(namePresent("hi this is Jordan with a flat")).toBe(true);
    for (const s of ["hi I need a flat fixed", "it's fine", "I'm good", "call me back"]) expect(namePresent(s)).toBe(false);
  });

  it("the names the assistant addresses the caller by are masked; the address form is case-blind, the name is not", () => {
    expect(maskPII("Thanks, Jordan. And what's the best number?")).toBe("Thanks, [NAME]. And what's the best number?");
    expect(maskPII("Got it, Maria, one sec")).toBe("Got it, [NAME], one sec");
    expect(maskPII("Perfect Sam!")).toBe("Perfect [NAME]!");
    // a capitalised word not followed by punctuation is left alone (a make, a street)
    expect(maskPII("Got it, Honda Civic")).toBe("Got it, Honda Civic");
    // The old rule carried /i on the WHOLE regex, so "[A-Z][a-z]+" matched any
    // word: "okay, brakes." became "okay, [NAME]." and the classifier lost the need.
    expect(maskPII("okay, brakes.")).toBe("okay, brakes.");
    expect(episodeNeed(["okay, brakes."]).need).toBe("brakes");
    // Accepted over-masking: a capitalised make or weekday after an address form
    // reads exactly like a name. Nothing downstream needs it (vehicle is extracted
    // from the raw text), and a leaked name would be worse.
    expect(maskPII("Okay, Honda. What year?")).toBe("Okay, [NAME]. What year?");
    expect(maskPII("Sure, Tuesday.")).toBe("Sure, [NAME].");
  });

  it("the tire sizes the classifier needs survive every number rule", () => {
    for (const s of ["225/65R17", "225 65 17", "225/65/17", "225-65-17", "LT265/70R17", "I need all four, 225 65 17 please"]) {
      expect(maskPII(s)).toBe(s);
    }
    expect(episodeNeed(["it's a 225 65 17"]).need).toBe("tire_size_help");
    // A 3-2-2 grouping that is NOT a real size (no 555 width) is still a number.
    expect(maskPII("555 01 23")).toBe("[NUMBER]");
  });

  it("a mask TOKEN never becomes a need: the classifier's hours rule keys on the word 'address'", () => {
    expect(classifyVoiceDemand(maskPII("I live on 17625 Euclid Ave")).intent).toBe("hours_location");
    expect(episodeNeed(["I live on 17625 Euclid Ave"]).need).toBe("unclear");
    expect(classifyTurn("I live on 17625 Euclid Ave, my brakes grind when I stop").intent).toBe("brakes");
  });

  it("POSITIVE CONTROL: a bare local number reads as a tire size to the raw classifier; masked, it does not", () => {
    expect(classifyVoiceDemand("call me at 555-0102").intent).toBe("tire_size_help");
    expect(maskPII("call me at 555-0102")).toBe("call me at [PHONE]");
    expect(episodeNeed(["call me at 555-0102"]).need).not.toBe("tire_size_help");
  });

  it("a written or spoken time is not an email; a 17-letter word with no digit is not a VIN", () => {
    expect(maskPII("I'll be there at 5.30")).toBe("I'll be there at 5.30");
    expect(maskPII("VIN is ABCDEFGHJKLMNPRST")).toBe("VIN is ABCDEFGHJKLMNPRST");
  });

  it("the structured tire size the export carries is never a phone number", () => {
    for (const s of ["you can reach me at 216 555 0102", "my number is 216-555-0102", "call 440 225 6517"]) {
      expect(extractTireSize(s)).toBeNull();
    }
  });

  it("output surfaces hash every digit left after maskPII; classification keeps them", () => {
    expect(maskForOutput("plate is JKL 4821")).toBe("plate is JKL ####");
    expect(maskForOutput("Last four of the card is 4242")).toBe("Last four of the card is ####");
    expect(maskForOutput("my name is Jordan, it's 225/65R17")).toBe("my name is [NAME], it's ###/##R##");
    expect(maskPII("it's 225/65R17")).toBe("it's 225/65R17");
  });

  it("an excerpt is a short window, never the line, masked, with no digit left", () => {
    // "4821" (a plate) sits inside the window and no maskPII rule claims it:
    // the old excerpt printed it verbatim.
    const line = "okay so like I said it is 4821 and my number is 216-555-0100 and I need four tires today please thanks a lot";
    const ex = excerptAround(line, FRICTION_PATTERNS.repeated_self, 4)!;
    expect(ex).toContain("like I said it is #### and");
    expect(ex).not.toMatch(/\d/);
    expect(ex.split(/\s+/).length).toBeLessThanOrEqual(12);
  });

  it("a customer token is stable inside a run and different across salts", () => {
    expect(customerToken("2165550100", "s1")).toBe(customerToken("2165550100", "s1"));
    expect(customerToken("2165550100", "s1")).not.toBe(customerToken("2165550100", "s2"));
    expect(phoneKey("+1 (216) 555-0100")).toBe("2165550100");
    expect(phoneKey("555-0100")).toBe("");
  });
});

describe("context-aware masking — the answer to 'what's your name?' is a bare name", () => {
  const a = (text: string) => ({ role: "assistant" as const, text });
  const u = (text: string) => ({ role: "customer" as const, text });

  it("a short answer right after a name ask is replaced whole; no rule could have recognised it", () => {
    expect(maskPII("Jordan Example.")).toBe("Jordan Example.");
    const out = maskTurns([a("Can I get your name?"), u("Jordan Example."), a("And the best number?"), u("Jordan Example.")]);
    expect(out.map((t) => t.text)).toEqual(["Can I get your name?", "[NAME]", "And the best number?", "Jordan Example."]);
  });

  it("every customer turn until the assistant speaks again is covered (a split answer)", () => {
    const out = maskTurns([a("And your first name?"), u("Uh, yeah."), u("Maria. M-A-R-I-A.")]);
    expect(out.map((t) => t.text)).toEqual(["And your first name?", "[NAME]", "[NAME]"]);
  });

  it("a long answer keeps its lowercase words and I-forms; every other capitalised word goes", () => {
    const out = maskTurns([a("Who am I speaking with?"), u("yeah so I'm calling for Jordan Example about the tires I ordered")]);
    expect(out[1]!.text).toBe("yeah so I'm calling for [NAME] [NAME] about the tires I ordered");
  });

  it("masked tokens are never masked twice", () => {
    const out = maskTurns([a("What's your name?"), u("My name is Jordan and my number is 216 555 0123 okay")]);
    expect(out[1]!.text).toBe("[NAME] name is [NAME] and my number is [PHONE] okay");
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

  it("wanting the manager needs a REQUEST frame, not the word", () => {
    const hit = (s: string) => frictionOf([s]).wants_manager_owner;
    for (const s of ["can I speak to a manager please", "put me through to the owner", "is the manager there?",
      "where's the manager", "I want Nick himself", "let me talk with your supervisor"]) expect(hit(s)).toBe(1);
    for (const s of ["I'm the second owner of this car", "my manager said I should get new tires"]) expect(hit(s)).toBe(0);
  });

  it("'you didn't call me back' is a broken promise (curly apostrophe too)", () => {
    expect(frictionOf(["you guys didn't call me back yesterday"]).broken_promise).toBe(1);
    expect(frictionOf(["you guys didn’t call me back yesterday"]).broken_promise).toBe(1);
    expect(frictionOf(["I left a message and nobody called back"]).broken_promise).toBe(1);
  });

  it("SERVER DEFECT, reported not fixed: the demand classifier files 'didn't call me back' as wrong_number", () => {
    // voiceDemandClassifier's wrong_number rule matches `didn'?t call`. If this
    // starts failing, the classifier was fixed — delete this pin.
    expect(episodeNeed(["you guys didn't call me back yesterday"]).need).toBe("wrong_number");
  });

  it("every way the assistant commits to a callback is a promise", () => {
    for (const s of [
      "I'll have someone call you back within the hour.",
      "I'll have Nick give you a call.",
      "I'll make sure someone calls you back.",
      "We'll get back to you this afternoon.",
      "Someone from the shop will call you back shortly.",
      "If nobody answers, they will call you back.",
      "Let me get a message to the team so they can reach out.",
      "Don't worry, I'll have someone call you back.",
    ]) expect(countPromises([s]).callback, s).toBe(1);
  });

  it("an in-call action or a negated commitment is not a promise", () => {
    for (const s of [
      "Let me check what we have in stock.",
      "I can't check the inventory from here.",
      "I'll let you know what the rack has in a second.",
      "One sec, I'll text you the address right now.",
      "I don't think the team will call you back today.",
    ]) expect(Object.values(countPromises([s])).reduce((a, b) => a + b, 0), s).toBe(0);
    // a negated clause does not cancel the promise in the next one
    expect(countPromises(["The shop can't text you tonight, but Nick will give you a call tomorrow."])).toMatchObject({ callback: 1, text_followup: 0 });
  });

  it("a text sent during the call, a drop-off condition, and a present-tense 'when it's ready' are not open promises", () => {
    for (const s of [
      // the old scripted oil-change line (vapi.ts before 2026-09-23): conditional + automated
      "pull up, we'll do it while you wait, or drop it off and we'll text when it's ready.",
      "I'll text you the address real quick, drive safe.",
      "We'll text you a confirmation with the address.",
      "I'm going to send you a text with the details.",
      "You'll get a text with the details.",
      "We'll let you know when you pull up.",
      "When it's ready you can pick it up.",
    ]) expect(Object.values(countPromises([s])).reduce((a, b) => a + b, 0), s).toBe(0);
    // real open promises still count
    expect(countPromises(["Someone will call you back."]).callback).toBe(1);
    expect(countPromises(["We'll text you once the parts come in."]).text_followup).toBe(1);
    expect(countPromises(["I'll let you know when it's ready."]).status_update).toBe(1);
  });

  it("a rack check is a promise only as a future check AND a report back", () => {
    expect(countPromises(["I'll have the team check the rack and let you know."]).rack_check).toBe(1);
    expect(countPromises(["Let me have the team check the rack."]).rack_check).toBe(0);
    expect(countPromises(["We'll let you know when your car is ready."]).status_update).toBe(1);
  });

  it("an ask counts only in a sentence that ends with '?'; a read-back is not an ask", () => {
    expect(countAsks(["Great, so that's a 225/65R17 tire size, we have two in stock."]).ask_tire_size).toBe(0);
    expect(countAsks(["I have your make and model as a 2015 Camry."]).ask_vehicle).toBe(0);
    expect(countAsks(["Got it. What size are your tires?"]).ask_tire_size).toBe(1);
    expect(countAsks(["Thanks. And your name?"]).ask_name).toBe(1);
  });
});

describe("opt-out, transfers, business dates", () => {
  it("an opt-out is the WHOLE body (the production keyword list), trailing punctuation allowed", () => {
    for (const s of ["STOP", "Stop.", "stop!", " Unsubscribe ", "opt-out", "STOP ALL", "Revoke"]) expect(isOptOutText(s), s).toBe(true);
    // These START with a keyword and are not opt-outs; the old prefix regex hid
    // them from "unanswered". Plain-English revocations are not covered (named
    // in shared/smsOptOutKeywords.ts) and stay a human-review question.
    for (const s of ["Cancel my appointment for tomorrow", "Stop by around 3 ok?", "End of day works", "Quit texting me please"]) {
      expect(isOptOutText(s), s).toBe(false);
    }
  });

  it("transfer state: the provider verdict, else a *-transfer-* failure, else a forward attempt", () => {
    expect(transferState(undefined, "assistant-warm-transfer-failed")).toBe("not_connected");
    expect(transferState(undefined, "assistant-forwarded-call")).toBe("attempted");
    expect(transferState("unknown", "assistant-forwarded-call")).toBe("attempted");
    expect(transferState("connected", "assistant-forwarded-call")).toBe("connected");
    expect(transferState("not_connected", "assistant-forwarded-call")).toBe("not_connected");
    expect(transferState(undefined, "customer-ended-call")).toBe("none");
  });

  it("a coverage week is the Eastern business week (Mon–Sun), not the UTC one", () => {
    // Sunday 11:30 PM EDT is already Monday in UTC.
    expect(businessWeekKey(new Date("2026-09-21T03:30:00Z"))).toBe("2026-09-14");
    expect(businessWeekKey(new Date("2026-09-21T14:00:00Z"))).toBe("2026-09-21");
    expect(addDays("2026-09-25", 14)).toBe("2026-10-09");
  });

  it("an invoice links to at most one episode: the latest that started on or before its business date, within 14 days", () => {
    const eps = [{ phone10: "2165550180", startDay: "2026-09-08" }, { phone10: "2165550180", startDay: "2026-09-11" }];
    expect(linkInvoices(eps, [{ phone10: "2165550180", day: "2026-09-12" }])).toEqual([1]);
    expect(linkInvoices(eps, [{ phone10: "2165550180", day: "2026-09-09" }])).toEqual([0]);
    // same business day links (invoices are stamped 08:00 ET or at import time)
    expect(linkInvoices(eps, [{ phone10: "2165550180", day: "2026-09-08" }])).toEqual([0]);
    // the day before the first episode, 15 days after the last, another phone: none
    expect(linkInvoices(eps, [
      { phone10: "2165550180", day: "2026-09-07" },
      { phone10: "2165550180", day: "2026-09-26" },
      { phone10: "2165550181", day: "2026-09-12" },
    ])).toEqual([null, null, null]);
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
      { at: at("2026-09-15T14:00:00Z"), endAt: at("2026-09-15T14:05:00Z"), by: "call" },
      { at: at("2026-09-15T14:08:00Z"), endAt: at("2026-09-15T14:09:00Z"), by: "call" }, // 3 min after end
      { at: at("2026-09-15T16:00:00Z"), by: "call" }, // hours later
    ]);
    expect(r).toEqual({ immediate: 1, later: 1, replies: 0 });
  });

  it("a text answering the shop's text is a reply, not a recontact", () => {
    const r = recontacts([
      { at: at("2026-09-15T14:00:00Z"), by: "text" },
      { at: at("2026-09-15T14:30:00Z"), by: "shop" },
      { at: at("2026-09-15T15:00:00Z"), by: "text" },
    ]);
    expect(r).toEqual({ immediate: 0, later: 0, replies: 1 });
  });

  it("a CALL after the shop's automatic confirmation text is still a recontact", () => {
    const r = recontacts([
      { at: at("2026-09-15T14:00:00Z"), endAt: at("2026-09-15T14:02:00Z"), by: "call" },
      { at: at("2026-09-15T14:02:30Z"), by: "shop" }, // confirmation text, seconds after hang-up
      { at: at("2026-09-15T14:45:00Z"), by: "call" },
    ]);
    expect(r).toEqual({ immediate: 0, later: 1, replies: 0 });
  });

  it("a TEXT after that confirmation is a recontact too: paperwork sent under 15 min after hang-up prompts nothing (f16)", () => {
    const r = recontacts([
      { at: at("2026-09-15T14:00:00Z"), endAt: at("2026-09-15T14:02:00Z"), by: "call" },
      { at: at("2026-09-15T14:02:30Z"), by: "shop" },
      { at: at("2026-09-15T23:30:00Z"), by: "text", text: "do you have them in 17 inch?" },
    ]);
    expect(r).toEqual({ immediate: 0, later: 1, replies: 0 });
  });

  it("a chase ('still waiting… can someone call me') is never a reply, even after a real shop text", () => {
    const r = recontacts([
      { at: at("2026-09-15T14:00:00Z"), by: "text", text: "do you have used 17s" },
      { at: at("2026-09-15T15:00:00Z"), by: "shop" },
      { at: at("2026-09-15T23:30:00Z"), by: "text", text: "hey still waiting to hear, can someone call me" },
    ]);
    expect(r).toEqual({ immediate: 0, later: 1, replies: 0 });
  });

  it("an acknowledgement is not owed a reply; a question is", () => {
    for (const ack of ["ok thanks", "Thank you!", "👍", "ok", "Ok", "got it, thanks"]) expect(ACKNOWLEDGEMENT.test(ack)).toBe(true);
    for (const q of ["ok is my car ready?", "thanks, how much for two tires", "yes"]) expect(ACKNOWLEDGEMENT.test(q)).toBe(false);
    expect(ACKNOWLEDGEMENT.test("kk")).toBe(true);
  });

  it("a long near-acknowledgement fails fast (no exponential backtracking)", () => {
    // With `k|kk` both in the alternation, 40 k's then "?" took ~4 s (1.6^n
    // growth; long enough to fail here, short enough never to hang the run).
    const t0 = performance.now();
    expect(ACKNOWLEDGEMENT.test("k".repeat(40) + "?")).toBe(false);
    expect(ACKNOWLEDGEMENT.test("ok ".repeat(2000) + "?")).toBe(false);
    expect(performance.now() - t0).toBeLessThan(250);
  });

  it("different need families across contacts are ambiguous; tire intents are one family", () => {
    expect(linkConfidence(["used_tire_price"])).toBe("single");
    expect(linkConfidence(["used_tire_price", "tire_size_help", "unclear"])).toBe("consistent");
    expect(linkConfidence(["human_requested", "brakes"])).toBe("consistent");
    expect(linkConfidence(["brakes", "used_tire_price"])).toBe("ambiguous");
  });

  it("logistics (hours, walk-in, wait, on-my-way) follow through on any need; they never make a link ambiguous", () => {
    expect(linkConfidence(["used_tire_availability", "hours_location"])).toBe("consistent");
    expect(linkConfidence(["used_tire_price", "walk_in_same_day"])).toBe("consistent");
    expect(linkConfidence(["brakes", "wait_time", "ready_to_visit"])).toBe("consistent");
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
    expect(incidents[0]).toMatchObject({ customers: 3, failures: 3, anonymousFailures: 0 });
  });

  it("anonymous failures are failures, never distinct customers", () => {
    const f = (iso: string, p: string) => ({ at: at(iso), phone10: p });
    // Two known customers + three withheld numbers: the old grouping counted
    // each anonymous failure as a new customer and reported a 5-customer incident.
    expect(clusterIncidents([
      f("2026-09-15T14:00:00Z", "2165550101"), f("2026-09-15T14:05:00Z", ""),
      f("2026-09-15T14:10:00Z", ""), f("2026-09-15T14:15:00Z", "2165550102"), f("2026-09-15T14:20:00Z", ""),
    ])).toEqual([]);
    expect(clusterIncidents([
      f("2026-09-15T14:00:00Z", "2165550101"), f("2026-09-15T14:05:00Z", ""),
      f("2026-09-15T14:10:00Z", "2165550102"), f("2026-09-15T14:15:00Z", "2165550103"),
    ])[0]).toMatchObject({ customers: 3, failures: 4, anonymousFailures: 1 });
  });

  it("the same customer failing three times is not a system incident", () => {
    const p = "2165550101";
    expect(clusterIncidents([
      { at: at("2026-09-15T14:00:00Z"), phone10: p },
      { at: at("2026-09-15T14:05:00Z"), phone10: p },
      { at: at("2026-09-15T14:10:00Z"), phone10: p },
    ])).toEqual([]);
  });
});
