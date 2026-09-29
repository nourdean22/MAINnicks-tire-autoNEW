import { describe, expect, it } from "vitest";
import {
  realityEventContract,
  validateRealityEventRegistration,
} from "@/lib/events/reality-event-registry";

describe("RealityEvent registry", () => {
  it("registers every currently live RealityEvent family", () => {
    const current = [
      "experiment.verdict",
      "proof.run",
      "proof.holdout",
      "proof.episode_failed",
      "episode.decision.shadow_evaluated",
      "episode.tool.completed",
      "episode.tool_gap.capability_proposed",
      "episode.mission.step_completed",
      "episode.content.judged",
      "episode.experiment.resolved",
      "episode.business_outcome.observed",
      "darwin.run_refused",
      "darwin.run_failed",
      "darwin.proposal_opened",
      "darwin.no_proposal",
      "shopstate.transition",
    ];
    for (const eventType of current) {
      expect(realityEventContract(eventType), eventType).not.toBeNull();
    }
  });

  it("rejects an unknown/unregistered event type instead of accepting arbitrary dotted strings", () => {
    expect(
      validateRealityEventRegistration({
        eventType: "totally.new.fact",
        payload: {},
      }),
    ).toEqual({
      ok: false,
      error: 'unregistered RealityEvent type "totally.new.fact"',
    });
  });

  it("defaults legacy experiment producers to the registered version and retention class", () => {
    expect(
      validateRealityEventRegistration({
        eventType: "experiment.verdict",
        payload: { status: "keep_running" },
      }),
    ).toMatchObject({
      ok: true,
      eventVersion: 1,
      retentionClass: "evidence",
      canonicalType: "com.statenour.experiment.experiment.verdict.v1",
    });
  });

  it("rejects an explicit version mismatch loudly", () => {
    const result = validateRealityEventRegistration({
      eventType: "experiment.verdict",
      eventVersion: 2,
      payload: { status: "winner" },
    });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/eventVersion 2.*registered version 1/);
  });

  it("rejects a retention-class mismatch rather than trusting the producer", () => {
    const result = validateRealityEventRegistration({
      eventType: "proof.run",
      retentionClass: "operational",
      payload: { outcome: "success" },
    });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/retentionClass.*evidence/);
  });

  it("validates family payloads — an experiment verdict needs a status", () => {
    const result = validateRealityEventRegistration({
      eventType: "experiment.verdict",
      payload: { note: "missing status" },
    });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/payload does not match experiment v1/);
  });

  it("episode events require the canonical Episode v1 payload", () => {
    const bad = validateRealityEventRegistration({
      eventType: "episode.decision.shadow_evaluated",
      payload: { episodeId: "ep-1" },
    });
    expect(bad).toMatchObject({ ok: false });

    const good = validateRealityEventRegistration({
      eventType: "episode.decision.shadow_evaluated",
      payload: { schemaVersion: 1, episodeId: "ep-1", traceId: "trace-1" },
    });
    expect(good).toMatchObject({
      ok: true,
      retentionClass: "learning",
      canonicalType: "com.statenour.episode.decision.shadow_evaluated.v1",
    });
  });

  it("Night Shift darwin events are registry-governed audit records", () => {
    expect(
      validateRealityEventRegistration({
        eventType: "darwin.proposal_opened",
        payload: { pr: "2778" },
      }),
    ).toMatchObject({
      ok: true,
      eventVersion: 1,
      retentionClass: "audit",
      canonicalType: "com.statenour.autonomy.darwin.proposal_opened.v1",
    });
  });
});
