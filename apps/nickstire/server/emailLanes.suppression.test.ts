/**
 * The EMAIL lanes are tested BEHAVIOURALLY — a suppressed recipient must not be
 * able to reach the sender at all.
 *
 * WHY THIS FILE EXISTS. Codex P2 on PR #2371, and it was right: the email half
 * of `outboundLanes.suppression.test.ts` only inspected source text for a
 * `loadSuppressionIndex()` call and an `else if (optedOut)` token. A regression
 * that kept those tokens but moved the send ahead of the check, ignored the
 * index result, or emptied the branch would have passed. That is precisely the
 * source-assertion-versus-behaviour line I held for the voice lanes and then
 * failed to hold for email.
 *
 * THE INSTRUMENT. Each lane's sender is stubbed to THROW. So "no email was
 * sent" is not inferred from a counter the code under test computed — the stub
 * is the witness. If a suppressed recipient ever reaches the sender, the test
 * fails loudly instead of quietly passing.
 *
 * SYNTHETIC INPUTS ONLY — no network, no DB, no real address or phone.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const SUPPRESSED_PHONE = "2165550143";
const CLEAN_PHONE = "2165550144";

const row = (id: number, phone: string, email: string) => ({
  id,
  firstName: "Synthetic",
  email,
  phone,
  vehicleMake: "Honda",
  vehicleModel: "Civic",
  segment: "lapsed",
});

describe("emailCampaigns · recipient validation", () => {
  it("normalizes only safe whitespace/domain casing and refuses ambiguous repairs", async () => {
    const { normalizeCampaignRecipientEmail } = await import("./services/emailCampaigns");

    expect(normalizeCampaignRecipientEmail("  Name.Tag+shop@EXAMPLE.COM  ")).toBe("Name.Tag+shop@example.com");
    expect(normalizeCampaignRecipientEmail('PEYTONJLEE29@GMAIL.COM"')).toBeNull();
    expect(normalizeCampaignRecipientEmail("Name <person@example.com>")).toBeNull();
    expect(normalizeCampaignRecipientEmail("double@@example.com")).toBeNull();
    expect(normalizeCampaignRecipientEmail("missing-domain-dot@example")).toBeNull();
    expect(normalizeCampaignRecipientEmail(".leading@example.com")).toBeNull();
    expect(normalizeCampaignRecipientEmail("trailing.@example.com")).toBeNull();
  });
});

describe("emailCampaigns · a suppressed recipient never reaches the sender", () => {
  /** Every address the stubbed transport was asked to send to. */
  const sentTo: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    sentTo.length = 0;
    vi.stubEnv("RESEND_API_KEY", "re_canary");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("./db");
    vi.doUnmock("./sms");
    vi.doUnmock("./services/featureFlags");
  });

  /** The lane POSTs to api.resend.com/emails, so fetch IS the transport. */
  const stubTransport = () =>
    vi.stubGlobal("fetch", async (url: string | URL, init?: { body?: string }) => {
      const u = String(url);
      if (!u.includes("api.resend.com")) throw new Error(`unexpected fetch: ${u}`);
      const to = JSON.parse(init?.body ?? "{}").to;
      sentTo.push(Array.isArray(to) ? to[0] : to);
      return { ok: true, json: async () => ({ id: "email_canary" }) } as never;
    });

  const arm = (rows: unknown[], index: unknown) => {
    vi.doMock("./services/featureFlags", async (io) => ({
      ...(await io<typeof import("./services/featureFlags")>()),
      isEnabled: async () => true,
    }));
    vi.doMock("./db", async (io) => ({
      ...(await io<typeof import("./db")>()),
      getDb: async () => ({
        // The lane runs one SELECT then one UPDATE per successful send.
        execute: async (q: unknown) => {
          const text = String((q as { sql?: string })?.sql ?? q);
          if (/UPDATE customers/i.test(text)) return [{ affectedRows: 1 }];
          return [rows];
        },
      }),
    }));
    vi.doMock("./sms", async (io) => ({
      ...(await io<typeof import("./sms")>()),
      loadSuppressionIndex: async () => index,
    }));
  };

  const run = async () => {
    const { autoSendEmailCampaigns } = await import("./services/emailCampaigns");
    return autoSendEmailCampaigns();
  };

  it("POSITIVE CONTROL: a clean index DOES email the recipient", async () => {
    stubTransport();
    arm([row(1, CLEAN_PHONE, "clean@example.com")], {
      ok: true, phones: new Set<string>(), carrierBlocked: new Set<string>(), stale: false,
    });

    const r = await run();

    // Without this, every "nothing was sent" below is satisfiable by a lane
    // that never got past its own feature flag or template lookup.
    expect(sentTo).toEqual(["clean@example.com"]);
    expect(r.recordsProcessed).toBe(1);
  });

  it("BREAKS: malformed CRM emails never reach Resend or starve clean recipients", async () => {
    stubTransport();
    const malformed = Array.from(
      { length: 15 },
      (_, i) => row(200 + i, CLEAN_PHONE, `bad${i}@example.com"`),
    );
    const clean = [
      row(1, CLEAN_PHONE, "first@example.com"),
      row(2, CLEAN_PHONE, "second@example.com"),
      row(3, CLEAN_PHONE, "third@example.com"),
    ];
    arm([...malformed, ...clean], {
      ok: true, phones: new Set<string>(), carrierBlocked: new Set<string>(), stale: false,
    });

    const r = await run();

    expect(sentTo.sort()).toEqual([
      "first@example.com",
      "second@example.com",
      "third@example.com",
    ]);
    expect(r.recordsProcessed).toBe(3);
    expect(r.details).toMatch(/15 invalid email skipped/);
  });

  it("BREAKS: a phone known only to the shared index is never emailed", async () => {
    stubTransport();
    arm([row(1, SUPPRESSED_PHONE, "suppressed@example.com")], {
      ok: true,
      phones: new Set([SUPPRESSED_PHONE]),
      carrierBlocked: new Set<string>(),
      stale: false,
    });

    const r = await run();

    // The stub is the witness: the transport was never asked.
    expect(sentTo).toEqual([]);
    expect(r.recordsProcessed).toBe(0);
  });

  it("BREAKS: an UNREADABLE index sends NOTHING and rejects", async () => {
    // The transport throws here — if suppression is ever bypassed on this path
    // the failure is loud rather than a silent send.
    vi.stubGlobal("fetch", async () => {
      throw new Error("transport reached — the suppression guard did NOT stop the send");
    });
    arm([row(1, CLEAN_PHONE, "clean@example.com")], { ok: false, reason: "index unreadable (canary)" });

    await expect(run()).rejects.toThrow(/suppression index unreadable/);
    expect(sentTo).toEqual([]);
  });

  it("BREAKS: a STALE index sends NOTHING — its age is UNBOUNDED", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("transport reached — the suppression guard did NOT stop the send");
    });
    arm([row(1, CLEAN_PHONE, "clean@example.com")], {
      ok: true, phones: new Set<string>(), carrierBlocked: new Set<string>(), stale: true,
    });

    await expect(run()).rejects.toThrow(/suppression index is STALE/);
    expect(sentTo).toEqual([]);
  });

  it("BREAKS: the batch is taken AFTER suppression, so suppressed rows cannot starve the queue", async () => {
    // Codex P2: with the limit applied BEFORE suppression, suppressed rows
    // occupied the batch and — because lastEmailCampaignAt is only stamped on a
    // successful send — were never aged out, so they re-occupied it every run.
    // 15 suppressed rows ahead of 3 clean ones must still send the 3.
    stubTransport();
    const suppressedRows = Array.from({ length: 15 }, (_, i) => row(100 + i, SUPPRESSED_PHONE, `s${i}@example.com`));
    const cleanRows = [
      row(1, CLEAN_PHONE, "a@example.com"),
      row(2, CLEAN_PHONE, "b@example.com"),
      row(3, CLEAN_PHONE, "c@example.com"),
    ];
    arm([...suppressedRows, ...cleanRows], {
      ok: true,
      phones: new Set([SUPPRESSED_PHONE]),
      carrierBlocked: new Set<string>(),
      stale: false,
    });

    const r = await run();

    expect(sentTo.sort()).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
    expect(r.recordsProcessed).toBe(3);
  });
});

describe("dripProcessor · a suppressed enrollment reaches neither channel", () => {
  const smsTo: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    smsTo.length = 0;
    vi.stubEnv("RESEND_API_KEY", "re_canary");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("./db");
    vi.doUnmock("./sms");
    vi.doUnmock("./services/featureFlags");
    vi.doUnmock("./services/dripCampaigns");
    vi.doUnmock("resend");
  });

  /**
   * ⚠ THE EMAIL BRANCH IS CURRENTLY UNREACHABLE, and that is a measured fact,
   * not an assumption — see the first test below. All 12 steps across all 4
   * campaigns declare `channel: "sms"`. So the missing suppression check there
   * was a LATENT trap for whoever adds the first email step, not a live hole.
   * I described it as live earlier in this PR; that was wrong, and this test is
   * how a future reader finds out without taking my word for it.
   *
   * Reaching the branch therefore needs a synthetic campaign. Mocking campaign
   * DATA to reach a branch is not the same as mocking the logic under test —
   * the guard, the index and the transport are all real here.
   */
  it("the email branch is unreachable today — every declared step is SMS", async () => {
    const { CAMPAIGNS } = await import("./services/dripCampaigns");
    const steps = CAMPAIGNS.flatMap((c) => c.steps);
    expect(steps.length).toBeGreaterThan(0); // the enumeration must find something
    expect(steps.filter((st) => st.channel === "email")).toEqual([]);
  });

  /** A db stub driven by CALL ORDER, not by matching drizzle's SQL objects. */
  const stubDb = (enrollment: Record<string, unknown>) => {
    let call = 0;
    vi.doMock("./db", async (io) => ({
      ...(await io<typeof import("./db")>()),
      getDb: async () => ({
        execute: async () => {
          call += 1;
          if (call === 1) return [[]];               // ensureTable · CREATE TABLE
          if (call === 2) return [[enrollment]];     // the due-steps SELECT
          return [{ affectedRows: 1 }];              // the advance/claim UPDATE
        },
      }),
    }));
  };

  const stubShared = (index: unknown) => {
    vi.doMock("./services/featureFlags", async (io) => ({
      ...(await io<typeof import("./services/featureFlags")>()),
      isEnabled: async () => true,
    }));
    vi.doMock("./sms", async (io) => ({
      ...(await io<typeof import("./sms")>()),
      loadSuppressionIndex: async () => index,
      withOptOut: (m: string) => m,
      sendSms: async (phone: string) => { smsTo.push(phone); return { success: true }; },
    }));
  };

  /** Reaching Resend at all is the failure this suite exists to catch. */
  const stubResendThrowing = () =>
    vi.doMock("resend", () => ({
      Resend: class {
        emails = {
          send: async () => {
            throw new Error("Resend reached — the drip email guard did NOT stop the send");
          },
        };
      },
    }));

  const enrollment = (campaignId: string) => ({
    id: "enr-canary",
    campaignId,
    customerPhone: SUPPRESSED_PHONE,
    customerName: "Synthetic Enrollee",
    currentStep: 1,
    metadata: JSON.stringify({ email: "drip@example.com", vehicle: "Civic", service: "tires" }),
  });

  it("POSITIVE CONTROL: a clean index DOES send the SMS step", async () => {
    stubResendThrowing();
    stubShared({ ok: true, phones: new Set<string>(), carrierBlocked: new Set<string>(), stale: false });
    stubDb({ ...enrollment("post-service"), customerPhone: CLEAN_PHONE });

    const { processDripSteps } = await import("./services/dripProcessor");
    const r = await processDripSteps();

    // Without this, every silence below is satisfiable by a run that returned
    // "No drip steps due" — which is exactly how an earlier draft of this suite
    // passed vacuously.
    expect(smsTo).toEqual([CLEAN_PHONE]);
    expect(r.recordsProcessed).toBe(1);
  });

  it("BREAKS: a suppressed enrollment sends no SMS and is NOT counted as sent", async () => {
    stubResendThrowing();
    stubShared({
      ok: true,
      phones: new Set([SUPPRESSED_PHONE]),
      carrierBlocked: new Set<string>(),
      stale: false,
    });
    stubDb(enrollment("post-service"));

    const { processDripSteps } = await import("./services/dripProcessor");
    const r = await processDripSteps();

    expect(smsTo).toEqual([]);
    // `sent++` used to be unconditional, so cron_log reported suppressed
    // contacts as successful sends (Codex P2 on PR #2371).
    expect(r.recordsProcessed).toBe(0);
    expect(r.details).toMatch(/1 suppressed/);
    // The enrollment still ADVANCED — deliberate, so a mid-campaign opt-out
    // cannot leave a row due forever.
    expect(r.details).toMatch(/1 advanced/);
  });

  it("BREAKS: a suppressed enrollment on an EMAIL step never reaches Resend", async () => {
    // The synthetic campaign is what makes the unreachable branch reachable.
    vi.doMock("./services/dripCampaigns", async (io) => {
      const real = await io<typeof import("./services/dripCampaigns")>();
      return {
        ...real,
        CAMPAIGNS: [{
          id: "zz-synthetic-email-campaign",
          name: "synthetic",
          trigger: "synthetic",
          steps: [
            { stepNumber: 1, delayDays: 0, channel: "sms", messageTemplate: "step one" },
            { stepNumber: 2, delayDays: 1, channel: "email", messageTemplate: "step two by email" },
          ],
        }],
      };
    });
    stubResendThrowing();
    stubShared({
      ok: true,
      phones: new Set([SUPPRESSED_PHONE]),
      carrierBlocked: new Set<string>(),
      stale: false,
    });
    stubDb(enrollment("zz-synthetic-email-campaign"));

    const { processDripSteps } = await import("./services/dripProcessor");
    const r = await processDripSteps();

    // The throwing Resend stub is the witness: it was never constructed or called.
    expect(smsTo).toEqual([]);
    expect(r.recordsProcessed).toBe(0);
    expect(r.details).toMatch(/1 suppressed/);
  });

  it("BREAKS: an UNREADABLE index stops the run before any step", async () => {
    stubResendThrowing();
    stubShared({ ok: false, reason: "index unreadable (canary)" });
    stubDb(enrollment("post-service"));

    const { processDripSteps } = await import("./services/dripProcessor");

    // It REJECTS — stronger than reporting, and what makes cron_log record the
    // run as failed rather than a silent completed-0. My first draft of this
    // test expected a returned value; the behaviour is better than I assumed.
    await expect(processDripSteps()).rejects.toThrow(/suppression index unreadable/);
    expect(smsTo).toEqual([]);
  });

  it("BREAKS: a STALE index stops the run before any step", async () => {
    stubResendThrowing();
    stubShared({ ok: true, phones: new Set<string>(), carrierBlocked: new Set<string>(), stale: true });
    stubDb(enrollment("post-service"));

    const { processDripSteps } = await import("./services/dripProcessor");

    await expect(processDripSteps()).rejects.toThrow(/suppression index is STALE/);
    expect(smsTo).toEqual([]);
  });
});
