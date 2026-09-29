/**
 * Every field `lot.health` returns for a camera must reach the screen.
 *
 * THE DEFECT THIS CATCHES, which shipped and sat unnoticed: `inferenceP95Ms` was selected
 * by the router, returned in the camera's `vision` block, and declared in the client's
 * TypeScript type — and `LotSection.tsx` never rendered it. It was invisible from both ends.
 * From the producer side nothing was sending the value, so the blank card looked correct;
 * from the client side the field existed in the type, so it looked wired. When the producer
 * finally started sending it, the card still showed nothing, and nobody would have noticed
 * because nobody had ever seen it show anything.
 *
 * A reader with no writer and a writer with no reader are the same defect from two ends, and
 * this repo already hunts both. This is that hunt at the router/JSX seam.
 *
 * WHAT IT CHECKS: that the card MENTIONS each field. Not that it renders correctly under
 * some state — that needs a render harness and belongs in a component test. Mention is the
 * fact being asserted, and it is exactly the fact that was false.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROUTER = path.resolve(__dirname, "routers", "lot.ts");
const CARD = path.resolve(__dirname, "..", "client", "src", "pages", "admin", "LotSection.tsx");

/**
 * Fields the card deliberately does not show, each with the reason. An entry here is a
 * decision; `no exemption has gone stale` keeps it from becoming a place to park a field
 * nobody wired.
 */
const NOT_SHOWN: Record<string, string> = {
  modelSha256:
    "a 59-character digest answers 'which weights' during an investigation, not at a " +
    "glance. It is in the payload for whoever is debugging; putting it on the card would " +
    "cost a line of every camera row to serve a question asked once a quarter.",
  poseDelta:
    "the pose FACET already renders the verdict this number feeds. Showing both invites " +
    "the reader to second-guess a threshold from a raw value, which is how a green light " +
    "starts getting argued with.",
};

/** The keys of the object literal `lot.health` returns as a camera's `vision` block. */
function visionFieldsReturned(): string[] {
  const src = fs.readFileSync(ROUTER, "utf8");
  const start = src.indexOf("          vision: r");
  const end = src.indexOf("          transport: r", start);
  expect(start, "the vision block moved or vanished").toBeGreaterThanOrEqual(0);
  expect(end, "the vision block has no closing boundary").toBeGreaterThan(start);
  const block = src.slice(start, end);
  const objectStart = block.indexOf("{");
  const objectEnd = block.lastIndexOf("}");
  expect(objectStart, "the vision object opening brace moved").toBeGreaterThanOrEqual(0);
  expect(objectEnd, "the vision object closing brace moved").toBeGreaterThan(objectStart);
  const objectBody = block.slice(objectStart + 1, objectEnd);
  return [...objectBody.matchAll(/(?:^|,)\s*([A-Za-z0-9_]+):\s/gm)].map((m) => m[1]);
}
describe("every vision field the router returns reaches the card", () => {
  it("finds a vision block worth checking", () => {
    // The positive control. A parse that returned [] would make the assertion below pass
    // vacuously forever, and this file would be decoration.
    const fields = visionFieldsReturned();
    expect(fields.length).toBeGreaterThanOrEqual(4);
    expect(fields).toContain("detector");
  });

  it("the card mentions every returned field, or the field is exempted with a reason", () => {
    const card = fs.readFileSync(CARD, "utf8");
    const missing = visionFieldsReturned().filter(
      (f) => !NOT_SHOWN[f] && !card.includes(`vision.${f}`) && !card.includes(`vision?.${f}`),
    );
    expect(
      missing,
      `lot.health returns ${JSON.stringify(missing)} for every camera and LotSection.tsx ` +
        `never renders them, so the value is computed, queried, typed, shipped over the ` +
        `wire and dropped. Render each one or add it to NOT_SHOWN with the reason.`,
    ).toEqual([]);
  });

  it("no exemption has gone stale", () => {
    // Two ways one rots: the field is gone, or someone rendered it anyway. Both leave a
    // recorded reason that is no longer true, and a list of untrue reasons is worse than
    // no list at all.
    const returned = visionFieldsReturned();
    const card = fs.readFileSync(CARD, "utf8");
    const gone = Object.keys(NOT_SHOWN).filter((f) => !returned.includes(f));
    expect(gone, `${JSON.stringify(gone)} are exempted but are not returned any more`).toEqual([]);
    const nowShown = Object.keys(NOT_SHOWN).filter(
      (f) => card.includes(`vision.${f}`) || card.includes(`vision?.${f}`),
    );
    expect(
      nowShown,
      `${JSON.stringify(nowShown)} are listed as deliberately hidden, but the card renders ` +
        `them. Delete the exemption; the reason recorded against it is now false.`,
    ).toEqual([]);
  });

  it("the two fields this gate was written for are on the screen", () => {
    // Named explicitly rather than left to the general rule, because they are the reason
    // the file exists and a future refactor should have to delete this line on purpose.
    const card = fs.readFileSync(CARD, "utf8");
    expect(card).toContain("vision.inferenceP95Ms");
    expect(card).toContain("vision.inferenceAgeSeconds");
  });
});

/** The keys of the object literal `lot.health` returns as a camera's transport block. */
function transportFieldsReturned(): string[] {
  const src = fs.readFileSync(ROUTER, "utf8");
  const start = src.indexOf("          transport: r");
  const end = src.indexOf("          conversation: r", start);
  expect(start, "the transport block moved or vanished").toBeGreaterThanOrEqual(0);
  expect(end, "the transport block has no closing boundary").toBeGreaterThan(start);
  const block = src.slice(start, end);
  return [...block.matchAll(/^\s{16}([A-Za-z0-9_]+):\s/gm)].map((m) => m[1]);
}

describe("every interaction transport field reaches the camera card", () => {
  it("finds a transport block worth checking", () => {
    const fields = transportFieldsReturned();
    expect(fields.length).toBeGreaterThanOrEqual(4);
    expect(fields).toContain("eventProofAgeSeconds");
    expect(fields).toContain("controlProofAgeSeconds");
    expect(fields).toContain("mediaProofAgeSeconds");
    expect(fields).toContain("ptzNotifyAgeSeconds");
  });

  it("the card renders every returned transport proof age", () => {
    const card = fs.readFileSync(CARD, "utf8");
    const missing = transportFieldsReturned().filter(
      (field) =>
        !card.includes(`transport.${field}`) &&
        !card.includes(`transport?.${field}`),
    );
    expect(
      missing,
      `lot.health returns transport fields ${JSON.stringify(missing)} that the camera card drops`,
    ).toEqual([]);
  });

  it("the authority role reaches the screen", () => {
    const card = fs.readFileSync(CARD, "utf8");
    expect(card).toContain("c.role");
  });
});


/** The keys of the object literal `lot.health` returns as Office conversation runtime. */
function conversationFieldsReturned(): string[] {
  const src = fs.readFileSync(ROUTER, "utf8");
  const start = src.indexOf("          conversation: r");
  const end = src.indexOf("          cloud: r", start);
  expect(start, "the conversation block moved or vanished").toBeGreaterThanOrEqual(0);
  expect(end, "the conversation block has no closing boundary").toBeGreaterThan(start);
  const block = src.slice(start, end);
  return [...block.matchAll(/^\s{16}([A-Za-z0-9_]+):\s/gm)].map((m) => m[1]);
}

describe("every Office conversation-runtime field reaches the Office intelligence panel", () => {
  it("finds a conversation block worth checking", () => {
    const fields = conversationFieldsReturned();
    expect(fields.length).toBeGreaterThanOrEqual(8);
    expect(fields).toContain("workerOk");
    expect(fields).toContain("state");
    expect(fields).toContain("lastCoverage");
    expect(fields).toContain("lastError");
  });

  it("renders every returned conversation-runtime field", () => {
    const card = fs.readFileSync(CARD, "utf8");
    const missing = conversationFieldsReturned().filter(
      (field) =>
        !card.includes(`runtime.${field}`) &&
        !card.includes(`runtime?.${field}`),
    );
    expect(
      missing,
      `lot.health returns conversation fields ${JSON.stringify(missing)} that Office intelligence drops`,
    ).toEqual([]);
  });
});
