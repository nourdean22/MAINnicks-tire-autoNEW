/**
 * Inline rich-renderer parsers · v10.0.49.
 *
 * Locks the bad-payload-resilience contract for the chart + email-draft
 * renderers. A hallucinated / corrupted payload from a Nick tool must
 * never crash the message renderer — these parsers MUST return null on
 * any malformed input so the chat falls through to the plain code-block
 * path.
 */

import { describe, it, expect } from "vitest";
import { parseChartSpec } from "@/components/chat/inline-chart";
import { parseEmailDraft } from "@/components/chat/email-draft-card";

describe("parseChartSpec", () => {
  it("accepts a well-formed line chart", () => {
    const spec = parseChartSpec(
      JSON.stringify({
        type: "line",
        title: "Revenue 7d",
        data: [
          { label: "Mon", value: 100 },
          { label: "Tue", value: 120 },
          { label: "Wed", value: 95 },
        ],
      }),
    );
    expect(spec).not.toBeNull();
    expect(spec!.type).toBe("line");
    expect(spec!.data).toHaveLength(3);
    expect(spec!.color).toBe("gold"); // default
  });

  it("accepts every chart type", () => {
    for (const type of ["line", "bar", "sparkline", "pie"] as const) {
      const spec = parseChartSpec(
        JSON.stringify({ type, data: [{ label: "x", value: 1 }] }),
      );
      expect(spec?.type).toBe(type);
    }
  });

  it("rejects unknown types", () => {
    const spec = parseChartSpec(
      JSON.stringify({ type: "scatter3d", data: [{ label: "x", value: 1 }] }),
    );
    expect(spec).toBeNull();
  });

  it("rejects malformed JSON", () => {
    expect(parseChartSpec("not json")).toBeNull();
    expect(parseChartSpec("{")).toBeNull();
    expect(parseChartSpec("")).toBeNull();
    expect(parseChartSpec("null")).toBeNull();
    expect(parseChartSpec("[1,2,3]")).toBeNull();
  });

  it("rejects empty data array", () => {
    const spec = parseChartSpec(JSON.stringify({ type: "line", data: [] }));
    expect(spec).toBeNull();
  });

  it("filters non-numeric data points without crashing", () => {
    const spec = parseChartSpec(
      JSON.stringify({
        type: "line",
        data: [
          { label: "a", value: 1 },
          { label: "b", value: "not a number" },
          { label: "c", value: NaN },
          { label: "d", value: 4 },
        ],
      }),
    );
    expect(spec).not.toBeNull();
    expect(spec!.data).toHaveLength(2);
    expect(spec!.data.map((d) => d.value)).toEqual([1, 4]);
  });

  it("caps data at 60 points", () => {
    const data = Array.from({ length: 200 }, (_, i) => ({ label: `p${i}`, value: i }));
    const spec = parseChartSpec(JSON.stringify({ type: "bar", data }));
    expect(spec?.data.length).toBe(60);
  });

  it("falls back to default color on unknown color value", () => {
    const spec = parseChartSpec(
      JSON.stringify({
        type: "line",
        color: "neon-pink",
        data: [{ label: "x", value: 1 }],
      }),
    );
    expect(spec?.color).toBe("gold");
  });

  it("does not pass through prototype-pollution payloads", () => {
    // Even if a malicious tool output sneaks __proto__ in, the parser
    // only reads explicit fields — there's no Object.assign etc. that
    // could leak it. This test locks that behavior.
    const spec = parseChartSpec(
      JSON.stringify({
        type: "line",
        data: [{ label: "x", value: 1 }],
        __proto__: { polluted: true },
      }),
    );
    expect(spec).not.toBeNull();
    // Only the documented fields are exposed.
    expect(Object.keys(spec!).sort()).toEqual(["color", "data", "title", "type"].sort());
  });
});

describe("parseEmailDraft", () => {
  it("accepts a valid draft", () => {
    const draft = parseEmailDraft(
      JSON.stringify({
        to: "test@example.com",
        subject: "Hello",
        body: "Hi there",
        tone: "warm",
      }),
    );
    expect(draft).not.toBeNull();
    expect(draft!.to).toBe("test@example.com");
    expect(draft!.subject).toBe("Hello");
    expect(draft!.body).toBe("Hi there");
    expect(draft!.tone).toBe("warm");
  });

  it("rejects missing required fields", () => {
    expect(parseEmailDraft(JSON.stringify({ to: "a@b.com" }))).toBeNull();
    expect(
      parseEmailDraft(JSON.stringify({ to: "a@b.com", subject: "x" })),
    ).toBeNull();
    expect(
      parseEmailDraft(JSON.stringify({ subject: "x", body: "y" })),
    ).toBeNull();
  });

  it("rejects malformed email addresses", () => {
    expect(
      parseEmailDraft(
        JSON.stringify({ to: "notanemail", subject: "s", body: "b" }),
      ),
    ).toBeNull();
    expect(
      parseEmailDraft(
        JSON.stringify({ to: "no-at-sign.com", subject: "s", body: "b" }),
      ),
    ).toBeNull();
    expect(
      parseEmailDraft(JSON.stringify({ to: "@nodomain", subject: "s", body: "b" })),
    ).toBeNull();
  });

  it("rejects empty strings (treated as missing)", () => {
    expect(
      parseEmailDraft(JSON.stringify({ to: "", subject: "s", body: "b" })),
    ).toBeNull();
    expect(
      parseEmailDraft(
        JSON.stringify({ to: "a@b.com", subject: "", body: "b" }),
      ),
    ).toBeNull();
  });

  it("rejects malformed JSON", () => {
    expect(parseEmailDraft("not json")).toBeNull();
    expect(parseEmailDraft("")).toBeNull();
    expect(parseEmailDraft("null")).toBeNull();
    expect(parseEmailDraft("[]")).toBeNull();
  });

  it("trims whitespace from recipient before validating", () => {
    const draft = parseEmailDraft(
      JSON.stringify({
        to: "  test@example.com  ",
        subject: "x",
        body: "y",
      }),
    );
    expect(draft?.to).toBe("test@example.com");
  });

  it("preserves multi-line body content", () => {
    const body = "Line 1\nLine 2\n\nLine 4 after blank";
    const draft = parseEmailDraft(
      JSON.stringify({ to: "a@b.com", subject: "s", body }),
    );
    expect(draft?.body).toBe(body);
  });
});
