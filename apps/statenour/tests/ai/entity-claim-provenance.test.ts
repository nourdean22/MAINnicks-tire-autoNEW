import { describe, expect, it } from "vitest";
import {
  checkEntityClaimProvenance,
  removeUnsupportedEntityClaims,
} from "@/lib/ai/chat/entity-claim-provenance";

const FAKE = "cmtyj6qr308v1mj011ae54upe";

describe("entity claim provenance", () => {
  it("flags a task id that neither the user nor any tool result emitted", () => {
    const r = checkEntityClaimProvenance(`Done — task #${FAKE} is in the queue.`, {
      userText: "add a task to call John",
      toolResultDigests: [],
    });
    expect(r.claims).toHaveLength(1);
    expect(r.unsupported).toHaveLength(1);
    expect(r.unsupported[0]).toMatchObject({ kind: "task", id: FAKE, support: "NONE" });
  });

  it("accepts an entity id that came from this turn's tool result", () => {
    const r = checkEntityClaimProvenance(`Created task id: ${FAKE}.`, {
      userText: "create it",
      toolResultDigests: [`{\"ok\":true,\"id\":\"${FAKE}\"}`],
    });
    expect(r.unsupported).toHaveLength(0);
    expect(r.claims[0].support).toBe("TOOL_RESULT");
  });

  it("accepts an id supplied by the operator even when no tool fired", () => {
    const r = checkEntityClaimProvenance(`Task #${FAKE} looks stale.`, {
      userText: `check task #${FAKE}`,
      toolResultDigests: [],
    });
    expect(r.unsupported).toHaveLength(0);
    expect(r.claims[0].support).toBe("USER_INPUT");
  });

  it("does not treat an unlabeled commit hash or version as an entity claim", () => {
    const r = checkEntityClaimProvenance(
      "Commit 31614f85 landed and package 6.0.275 is installed.",
      { userText: "", toolResultDigests: [] },
    );
    expect(r.claims).toHaveLength(0);
  });

  it("removes the whole unsupported sentence instead of leaving a false action claim behind", () => {
    const text = `I created task #${FAKE}. The useful next move is to call John.`;
    const report = checkEntityClaimProvenance(text, { userText: "create a task", toolResultDigests: [] });
    const fixed = removeUnsupportedEntityClaims(text, report);
    expect(fixed.removed).toBe(1);
    expect(fixed.text).not.toContain(FAKE);
    expect(fixed.text).not.toMatch(/I created task/i);
    expect(fixed.text).toBe("The useful next move is to call John.");
  });
});
