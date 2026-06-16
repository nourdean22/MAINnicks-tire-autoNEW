import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock out the individual handlers to prevent actual network/DB execution in unit tests
vi.mock("@/lib/ai/agent-actions/google-actions", () => ({
  handleGoogleGetSchedule: vi.fn().mockResolvedValue({ action: "google.getSchedule", success: true, result: { events: [] } }),
  handleGoogleProposeEvent: vi.fn().mockResolvedValue({ action: "google.proposeEvent", success: true, result: { created: true } }),
  handleGmailDraftReply: vi.fn().mockResolvedValue({ action: "gmail.draftReply", success: true, result: { draftId: "123" } }),
  handleGmailCreateDraft: vi.fn().mockResolvedValue({ action: "gmail.createDraft", success: true, result: { draftId: "456" } }),
  handleGmailSendDraft: vi.fn().mockResolvedValue({ action: "gmail.sendDraft", success: true, result: { messageId: "789" } }),
  handleGoogleGetReviewStats: vi.fn().mockResolvedValue({ action: "google.getReviewStats", success: true, result: { total: 10 } }),
  handleGoogleGetUnrespondedReviews: vi.fn().mockResolvedValue({ action: "google.getUnrespondedReviews", success: true, result: { reviews: [] } }),
  handleGoogleDraftReviewResponse: vi.fn().mockResolvedValue({ action: "google.draftReviewResponse", success: true, result: { status: "complete" } }),
  handleGoogleMarkReviewResponded: vi.fn().mockResolvedValue({ action: "google.markReviewResponded", success: true }),
}));

vi.mock("@/lib/ai/agent-actions/arsenal-actions", () => ({
  handleArsenalRunPython: vi.fn().mockResolvedValue({ action: "arsenal.runPython", success: true, result: { ok: true, stdout: "4" } }),
  handleArsenalBrowserCreateSession: vi.fn().mockResolvedValue({ action: "arsenal.browserCreateSession", success: true, result: { sessionId: "session-1" } }),
  handleArsenalBrowserCloseSession: vi.fn().mockResolvedValue({ action: "arsenal.browserCloseSession", success: true }),
  handleArsenalBrowserNavigate: vi.fn().mockResolvedValue({ action: "arsenal.browserNavigate", success: true }),
  handleArsenalBrowserAct: vi.fn().mockResolvedValue({ action: "arsenal.browserAct", success: true }),
  handleArsenalBrowserExtract: vi.fn().mockResolvedValue({ action: "arsenal.browserExtract", success: true, result: { price: "$100" } }),
  handleArsenalBrowserObserve: vi.fn().mockResolvedValue({ action: "arsenal.browserObserve", success: true }),
}));

// Mock the feedback loop to avoid DB side-effects during test runs
vi.mock("@/lib/brain/pipeline-controller", () => ({
  feedbackLoop: vi.fn().mockResolvedValue(undefined),
}));

import { parseActions, executeActions } from "@/lib/ai/nick-agent";
import * as googleHandlers from "@/lib/ai/agent-actions/google-actions";
import * as arsenalHandlers from "@/lib/ai/agent-actions/arsenal-actions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Nick Agent Action Parser", () => {
  it("extracts actions from ```action blocks", () => {
    const text = `
Here is what I'll do:
\`\`\`action
[
  { "type": "google.getSchedule", "params": { "daysAhead": 3 } },
  { "type": "arsenal.runPython", "params": { "code": "print(2+2)" } }
]
\`\`\`
Let me know if this works.
    `;
    const parsed = parseActions(text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].type).toBe("google.getSchedule");
    expect(parsed[0].params.daysAhead).toBe(3);
    expect(parsed[1].type).toBe("arsenal.runPython");
  });

  it("extracts inline [ACTION: {...}] markers", () => {
    const text = "Checking review stats [ACTION: { \"type\": \"google.getReviewStats\", \"params\": {} }] now.";
    const parsed = parseActions(text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe("google.getReviewStats");
  });
});

describe("Nick Agent Action Dispatcher", () => {
  it("dispatches new google actions to handlers correctly", async () => {
    const actions = [
      { type: "google.getSchedule", params: { daysAhead: 1 } },
      { type: "google.proposeEvent", params: { title: "Meeting" } },
      { type: "gmail.draftReply", params: { threadId: "t1", body: "Re" } },
      { type: "gmail.createDraft", params: { to: "a@b.com", subject: "Hi", body: "Hello" } },
      { type: "gmail.sendDraft", params: { draftId: "d1" } },
      { type: "google.getReviewStats", params: {} },
      { type: "google.getUnrespondedReviews", params: {} },
      { type: "google.draftReviewResponse", params: { reviewerName: "Joe" } },
      { type: "google.markReviewResponded", params: { reviewId: "r1", responseText: "Thanks" } },
    ];

    const results = await executeActions(actions);
    expect(results).toHaveLength(9);
    
    expect(googleHandlers.handleGoogleGetSchedule).toHaveBeenCalled();
    expect(googleHandlers.handleGoogleProposeEvent).toHaveBeenCalled();
    expect(googleHandlers.handleGmailDraftReply).toHaveBeenCalled();
    expect(googleHandlers.handleGmailCreateDraft).toHaveBeenCalled();
    expect(googleHandlers.handleGmailSendDraft).toHaveBeenCalled();
    expect(googleHandlers.handleGoogleGetReviewStats).toHaveBeenCalled();
    expect(googleHandlers.handleGoogleGetUnrespondedReviews).toHaveBeenCalled();
    expect(googleHandlers.handleGoogleDraftReviewResponse).toHaveBeenCalled();
    expect(googleHandlers.handleGoogleMarkReviewResponded).toHaveBeenCalled();
  });

  it("dispatches new arsenal actions to handlers correctly", async () => {
    const actions = [
      { type: "arsenal.runPython", params: { code: "1" } },
      { type: "arsenal.browserCreateSession", params: {} },
      { type: "arsenal.browserCloseSession", params: { sessionId: "s1" } },
      { type: "arsenal.browserNavigate", params: { sessionId: "s1", url: "https://" } },
      { type: "arsenal.browserAct", params: { sessionId: "s1", instruction: "click" } },
      { type: "arsenal.browserExtract", params: { sessionId: "s1", instruction: "get", keys: ["price"] } },
      { type: "arsenal.browserObserve", params: { sessionId: "s1" } },
    ];

    const results = await executeActions(actions);
    expect(results).toHaveLength(7);

    expect(arsenalHandlers.handleArsenalRunPython).toHaveBeenCalled();
    expect(arsenalHandlers.handleArsenalBrowserCreateSession).toHaveBeenCalled();
    expect(arsenalHandlers.handleArsenalBrowserCloseSession).toHaveBeenCalled();
    expect(arsenalHandlers.handleArsenalBrowserNavigate).toHaveBeenCalled();
    expect(arsenalHandlers.handleArsenalBrowserAct).toHaveBeenCalled();
    expect(arsenalHandlers.handleArsenalBrowserExtract).toHaveBeenCalled();
    expect(arsenalHandlers.handleArsenalBrowserObserve).toHaveBeenCalled();
  });
});
