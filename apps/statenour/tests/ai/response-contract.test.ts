/**
 * Response-contract tests — pins the per-turn compliance contract that
 * the reply gate enforces. Pure, deterministic, no model/DB.
 */
import { describe, it, expect } from "vitest";
import { buildResponseContract, buildContractDirective, detectExecuteFinalized } from "@/lib/ai/response-contract";
import { classifyTurn } from "@/lib/ai/turn-intelligence";

const c = (t: string) => buildResponseContract(t, classifyTurn(t));

describe("response-contract · length", () => {
  it("'keep it concise' → concise, forbids preamble", () => {
    const r = c("Give me your read but keep it concise");
    expect(r.length).toBe("concise");
    expect(r.forbiddenMoves.join(" ")).toMatch(/preamble|filler/i);
  });
  it("'short answer' → concise", () => {
    expect(c("short answer: is the deploy green?").length).toBe("concise");
  });
  it("'be detailed / in depth' → detailed", () => {
    expect(c("be detailed and thorough about the migration plan").length).toBe("detailed");
  });
  it("'one long ass prompt' → detailed length AND copy_paste_prompt mode", () => {
    const r = c("write me one long ass prompt for the coder");
    expect(r.length).toBe("detailed");
    expect(r.answerMode).toBe("copy_paste_prompt");
  });
});

describe("response-contract · answerMode", () => {
  it("'give me a prompt for the coder' → copy_paste_prompt + prompt format + no clarifying", () => {
    const r = c("give me a prompt for the coder to build the auth flow");
    expect(r.answerMode).toBe("copy_paste_prompt");
    expect(r.outputFormat).toBe("prompt");
    expect(r.userIsAskingForCoderPrompt).toBe(true);
    expect(r.shouldAskClarifying).toBe(false);
  });
  it("'what should the coder do next' → operator_command + next move", () => {
    const r = c("what should the coder do next on the missions feature?");
    expect(r.answerMode).toBe("operator_command");
    expect(r.mustGiveNextMove).toBe(true);
  });
  it("'replace X with more useful functions' → correction + useful-functions required", () => {
    const r = c("no, replace those abstract ideas with more useful functions");
    expect(r.answerMode).toBe("correction");
    expect(r.userIsCorrectingDirection).toBe(true);
    expect(r.requiredMoves.join(" ")).toMatch(/useful functions/i);
    expect(r.forbiddenMoves.join(" ")).toMatch(/abstract|vague/i);
  });
  it("'no more internal work' → forbids internal-only work", () => {
    const r = c("no more internal work, focus on user-facing stuff");
    expect(r.forbiddenMoves.join(" ")).toMatch(/internal/i);
  });
  it("'while we wait' → wait_mode, no clarifying", () => {
    const r = c("while we wait for the deploy, what else can we tackle");
    expect(r.answerMode).toBe("wait_mode");
    expect(r.shouldAskClarifying).toBe(false);
  });
  it("'brainstorm ideas' → brainstorm, mustNotClaimActions", () => {
    const r = c("brainstorm ideas for the goals page");
    expect(r.answerMode).toBe("brainstorm");
    expect(r.mustNotClaimActions).toBe(true);
  });
});

describe("response-contract · ranking", () => {
  it("'top 5' → mustRankOptions + rankCount 5 + bullets", () => {
    const r = c("give me the top 5 highest-leverage upgrades");
    expect(r.mustRankOptions).toBe(true);
    expect(r.rankCount).toBe(5);
    expect(r.outputFormat).toBe("bullets");
  });
  it("'rank these' → mustRankOptions, no fixed count", () => {
    const r = c("rank these options for me");
    expect(r.mustRankOptions).toBe(true);
    expect(r.rankCount).toBeNull();
  });
});

describe("response-contract · repo grounding + evidence", () => {
  it("'look at the repo first' → mustBeRepoGrounded + evidence", () => {
    const r = c("look at the repo first, then tell me if this exists");
    expect(r.mustBeRepoGrounded).toBe(true);
    expect(r.mustIncludeEvidence).toBe(true);
    expect(r.forbiddenMoves.join(" ")).toMatch(/generic/i);
  });
});

describe("response-contract · clarification suppression", () => {
  it("'don't ask me questions' → shouldAskClarifying false", () => {
    const r = c("just build it, don't ask me questions");
    expect(r.shouldAskClarifying).toBe(false);
    expect(r.forbiddenMoves.join(" ")).toMatch(/clarifying question/i);
  });
  it("normal ambiguous turn → clarification allowed", () => {
    expect(c("help me think about the thing").shouldAskClarifying).toBe(true);
  });
});

describe("response-contract · multi-session + status update", () => {
  it("'I have 3 sessions going' → userIsManagingConcurrentSessions", () => {
    expect(c("heads up, I have 3 sessions going on statenour right now").userIsManagingConcurrentSessions).toBe(true);
  });
  it("pasted status update → isStatusUpdate + session_update + mustNotClaimActions", () => {
    const r = c("here's an update from the other session: deployed 496f7cda, build verified, tests passed");
    expect(r.isStatusUpdate).toBe(true);
    expect(r.answerMode).toBe("session_update");
    expect(r.mustNotClaimActions).toBe(true);
    expect(r.requiredMoves.join(" ")).toMatch(/reported/i);
  });
});

describe("response-contract · action question vs command", () => {
  it("'should I add this task?' → mustNotClaimActions (question)", () => {
    expect(c("should I add this task to the list?").mustNotClaimActions).toBe(true);
  });
  it("'add: call John' → does NOT force mustNotClaimActions (imperative)", () => {
    expect(c("add: call John tomorrow").mustNotClaimActions).toBe(false);
  });
});

describe("response-contract · directive rendering", () => {
  it("renders a compact directive for a constrained turn", () => {
    const d = buildContractDirective(c("give me the top 5, keep it concise, don't ask questions"));
    expect(d).toMatch(/concise/i);
    expect(d).toMatch(/ranked|5/i);
    expect(d).toMatch(/do not ask/i);
  });
  it("empty directive for an unconstrained, normal-length turn", () => {
    expect(buildContractDirective(c("what's the capital of France"))).toBe("");
  });
  it("casual turn → concise directive (keep banter short)", () => {
    expect(buildContractDirective(c("hey"))).toMatch(/concise/i);
  });
});

describe("response-contract · execute/finalized posture (no unsolicited opposition)", () => {
  it("detects command / finalized-decision phrases", () => {
    for (const t of [
      "just do it",
      "do it now",
      "my decision is final",
      "i've decided, we open the second location",
      "stop arguing and write the plan",
      "no more objections — ship it",
      "don't push back, just answer",
      "execute the plan",
    ]) {
      expect(detectExecuteFinalized(t)).toBe(true);
    }
  });

  it("does NOT fire on ordinary analysis / question turns", () => {
    for (const t of [
      "should I open a second location?",
      "analyze the $20 brake offer",
      "what's my revenue this month",
      "give me your read on retention",
      "how do I do it right?", // 'do it' in a how-to question, not a command
      "can you do it by friday?", // question, not a finalized command
    ]) {
      expect(detectExecuteFinalized(t)).toBe(false);
    }
  });

  it("the contract carries executeFinalized + forbids re-opening the decision", () => {
    const r = c("My decision is final. Stop arguing and just do it.");
    expect(r.executeFinalized).toBe(true);
    expect(r.forbiddenMoves.join(" ")).toMatch(/re-open|counter-view|objection/i);
    expect(r.reasons.join(" ")).toMatch(/execute-finalized/i);
  });

  it("a normal recommendation ask leaves executeFinalized false", () => {
    expect(c("what should I do about the 30 failed reels?").executeFinalized).toBe(false);
  });
});
