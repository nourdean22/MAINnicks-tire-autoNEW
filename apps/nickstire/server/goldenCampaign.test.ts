/**
 * GOLDEN CAMPAIGN HARNESS — Reality Control's replayable end-to-end proof.
 *
 * One fixed campaign travels the REAL modules with deterministic mocks at the
 * model/provider/db seams (zero provider calls, zero live publishing):
 *
 *   public evidence resolve → concept tournament (4 pitches + independent
 *   judge) → chained claim-safe genome → reel director draft → operator-
 *   approved Visual World → policy boundary + budget reservation + cadence
 *   reservation inside the REAL service enqueue → persisted payload
 *   assertions (lineage + locked invariants in EVERY prompt) → publish
 *   attempt under an armed kill switch → DENIED with zero Meta calls →
 *   audit-trail reconstruction from captured writes.
 *
 * Every major Creative OS change reruns this. If it goes red, the system's
 * story about itself is wrong somewhere.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { SAMPLE_REEL_BRIEFS } from "../client/src/lib/facelessReelStudioSamples";
import { DEFAULT_AUTONOMY_POLICY } from "../client/src/lib/autonomyPolicy";

afterEach(() => {
  vi.doUnmock("./db");
  vi.doUnmock("./_core/llm");
  vi.doUnmock("./services/reelBriefGen");
  vi.doUnmock("./services/metaSocial");
  vi.resetModules();
});

/** Captures every insert; serves table-aware selects (policy rows when asked,
 *  empty otherwise). Discriminates drizzle tables by known column props. */
function goldenDb(opts: { killSwitchPolicy?: boolean } = {}) {
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];
  const tableName = (t: Record<string, unknown>) =>
    "policyJson" in t ? "autonomy_policy_versions"
    : "reasoningCodes" in t ? "autonomy_audit_events"
    : "actionId" in t ? "generation_reservations"
    : "windowStart" in t ? "content_reservations"
    : "payload" in t ? "reel_jobs"
    : "briefJson" in t && "contentType" in t ? "social_content_inventory"
    : "unknown";
  const db = {
    select: (_proj?: unknown) => ({
      from: (t: Record<string, unknown>) => {
        const name = tableName(t);
        const rows =
          name === "autonomy_policy_versions" && opts.killSwitchPolicy
            ? [{
                version: 2,
                policyJson: JSON.stringify({
                  ...DEFAULT_AUTONOMY_POLICY,
                  version: 2,
                  emergencyControls: { ...DEFAULT_AUTONOMY_POLICY.emergencyControls, publishingKillSwitch: true },
                }),
              }]
            : [];
        const chain: Record<string, unknown> = {};
        const thenable = (r: unknown[]) => {
          const p = Promise.resolve(r) as Promise<unknown[]> & Record<string, unknown>;
          p.limit = () => Promise.resolve(r);
          p.orderBy = () => {
            const q = Promise.resolve(r) as Promise<unknown[]> & Record<string, unknown>;
            q.limit = () => Promise.resolve(r);
            return q;
          };
          return p;
        };
        chain.where = () => thenable(rows);
        chain.orderBy = () => thenable(rows);
        chain.limit = () => Promise.resolve(rows);
        return chain;
      },
    }),
    insert: (t: Record<string, unknown>) => ({
      values: (v: Record<string, unknown>) => {
        inserts.push({ table: tableName(t), values: v });
        return Promise.resolve({ insertId: 42 });
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve({}) }) }),
  };
  return { db, inserts };
}

describe("golden campaign (deterministic mode)", () => {
  it("travels evidence → tournament → genome → visual world → governed enqueue → kill-switched publish denial → audit", async () => {
    const sampleBrief = SAMPLE_REEL_BRIEFS[0];

    // ── deterministic model seam: 4 role pitches → judge → genome ──────────
    const pitch = (role: string) =>
      JSON.stringify({
        concepts: [
          {
            title: `${role} freeze concept`,
            hook: "Your battery ages fastest on the season's first hard freeze",
            coreIdea: "Cold halves cranking power; the weak battery shows itself first",
            visualIdea: "a battery as a hibernating animal under frost",
            whyItWorks: "seasonal urgency plus a checkable claim",
          },
        ],
      });
    const judge = JSON.stringify({
      scores: [
        { id: "entry_01", total: 88, rejected: false, ruleViolations: [] },
        { id: "entry_02", total: 74, rejected: false, ruleViolations: [] },
        { id: "entry_03", total: 70, rejected: false, ruleViolations: [] },
        { id: "entry_04", total: 66, rejected: false, ruleViolations: [] },
      ],
      winnerId: "entry_01",
      judgeReasoning: "clear seasonal moment with verifiable mechanic truth",
    });
    const genome = JSON.stringify({
      version: 1,
      objective: "save",
      audienceMoment: "First hard freeze hits and the battery quits in the driveway",
      driverTension: "Drivers assume a slow crank is normal cold-weather behavior",
      mechanicTruth: "Cold cuts battery cranking power roughly in half; weak batteries fail first on freezing mornings",
      proprietaryProof: ["NHTSA tire pressure guidance"],
      emotionalTurn: "dread turns into a two-minute check",
      visualMetaphor: "the battery as a hibernating animal that may not wake",
      creativeTerritory: "weather_local_alert",
      clevelandAngle: "Lake-effect cold snaps hit Euclid harder than the forecast says",
      nickSignature: "road-survival intelligence without panic",
      desiredAction: 'save this and DM "BATTERY" before the freeze',
    });
    const llmQueue = [pitch("automotive"), pitch("visual"), pitch("cleveland"), pitch("response"), judge, genome];
    const invokeLLM = vi.fn().mockImplementation(() =>
      Promise.resolve({ choices: [{ message: { content: llmQueue.shift() ?? "{}" } }] }),
    );
    vi.doMock("./_core/llm", () => ({ invokeLLM }));

    // db seam: no storage for the generation phase (memory degrades gracefully)
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(null) }));
    vi.resetModules();

    // 1. Public evidence resolves through the curated registry (real module).
    const { resolveEvidenceHandles } = await import("./services/evidenceResolver");
    const evidence = await resolveEvidenceHandles(["NHTSA tire pressure guidance", "made-up source"]);
    expect(evidence.resolved).toHaveLength(1);
    expect(evidence.rejected).toEqual(["made-up source"]);

    // 2. Tournament with the independent judge (real module, mocked model).
    const { runConceptTournament } = await import("./services/conceptTournament");
    const tournament = await runConceptTournament(
      { campaignAsk: "First hard freeze is coming - make drivers check the battery this week", objective: "save", proofHandles: ["NHTSA tire pressure guidance"], avoidRecent: [] },
      { generateGenome: true },
    );
    expect(tournament.winner.title).toContain("freeze concept");
    expect(tournament.genome?.creativeTerritory).toBe("weather_local_alert");
    expect(invokeLLM).toHaveBeenCalledTimes(6);

    // 3. Reel director drafts from the genome (generator seam mocked).
    vi.doMock("./services/reelBriefGen", () => ({
      generateReelBriefAI: vi.fn().mockResolvedValue({ brief: sampleBrief, rawModel: "{}" }),
      resolveSourceProvenance: vi.fn().mockResolvedValue({ evidence: "", isVerified: false, sourceType: "manual" }),
    }));
    vi.resetModules();
    const { draftReelFromGenome } = await import("./services/reelDirector");
    const draft = await draftReelFromGenome(tournament.genome!);
    expect(draft.qualityScore.passing).toBe(true);

    // 4. Operator approves a Visual World (real compile, no image call).
    const { buildReferenceFramePrompt, compileLockedInvariants, visualWorldFromCandidate } = await import("./services/visualWorld");
    const framePrompt = buildReferenceFramePrompt(draft.brief, "bold");
    const world = visualWorldFromCandidate({
      style: "bold",
      url: "https://golden.test/hero.jpg",
      framePrompt,
      lockedInvariants: compileLockedInvariants(draft.brief, "bold", framePrompt),
    });

    // 5. REAL service enqueue: policy boundary + ledger + governor + persist.
    const { db, inserts } = goldenDb();
    vi.doUnmock("./db");
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(db) }));
    vi.resetModules();
    const { enqueueReelJob } = await import("./services/reelPipeline");
    const { jobId } = await enqueueReelJob(
      { ...draft.brief, id: "golden_1", genomeId: "genome_golden", visualWorld: world } as never,
      "admin",
    );
    expect(jobId).toBe(42);

    const jobRow = inserts.find((i) => i.table === "reel_jobs");
    expect(jobRow).toBeTruthy();
    const payload = JSON.parse(jobRow!.values.payload as string);
    expect(payload.genomeId).toBe("genome_golden");
    expect(payload.visualWorld.heroFrameUrl).toBe("https://golden.test/hero.jpg");
    for (const beat of payload.promptPack) {
      expect(beat.prompt).toContain("operator-approved reference frame");
    }
    expect(inserts.some((i) => i.table === "generation_reservations" && i.values.actionId === "reel_job_42")).toBe(true);
    expect(inserts.some((i) => i.table === "content_reservations" && i.values.format === "reel")).toBe(true);
    const enqueueAudit = inserts.filter((i) => i.table === "autonomy_audit_events");
    expect(enqueueAudit.length).toBeGreaterThan(0);
    expect(String(enqueueAudit[0].values.reasoningCodes)).toContain("actor:operator");

    // 6. Publish attempt under an ARMED kill switch: denied, zero Meta calls.
    const armed = goldenDb({ killSwitchPolicy: true });
    vi.doUnmock("./db");
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(armed.db) }));
    const metaSpy = vi.fn().mockRejectedValue(new Error("Meta must never be called in the golden harness"));
    vi.doMock("./services/metaSocial", () => ({
      postToFacebook: metaSpy,
      postToInstagram: metaSpy,
      postInstagramReel: metaSpy,
      postInstagramCarousel: metaSpy,
      postInstagramStory: metaSpy,
    }));
    vi.resetModules();
    const { publishToSocial } = await import("./services/socialPublish");
    const publishOutcome = await publishToSocial({ platforms: ["instagram"], caption: "golden", videoUrl: "https://golden.test/reel.mp4" });
    expect(metaSpy).not.toHaveBeenCalled();
    expect(publishOutcome.results).toHaveLength(1);
    expect(publishOutcome.results[0].success).toBe(false);
    expect(publishOutcome.results[0].error).toContain("kill switch");

    // 7. Audit reconstruction: the denial is on the record.
    const publishAudit = armed.inserts.filter((i) => i.table === "autonomy_audit_events");
    expect(publishAudit.length).toBeGreaterThan(0);
    expect(String(publishAudit[0].values.reasoningCodes)).toContain("PUBLISHING_KILL_SWITCH");
  }, 30_000);
});
