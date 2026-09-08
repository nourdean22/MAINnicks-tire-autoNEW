/**
 * tests/ai/chat/signed-image-markdown.test.ts · 2026-09-07 (program D13)
 *
 * With IMAGES_REQUIRE_SIGNATURE=1 the chat minter emits
 * `![Generated Image](/api/images/<id>?exp=…&sig=…)`. Every regex that
 * used to assume the id was followed by `)` must still recognise it:
 * otherwise signed markdown escapes the history stripper (the model sees
 * the URL pattern it must never see) and the ghost validator cannot swap a
 * fabricated signed reference.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ auditEvent: { findMany: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db, resetQueryCount: vi.fn(), getQueryCount: vi.fn(() => 0) }));

import { stripImageMarkdownFromText } from "@/lib/ai/chat/sanitize-history";
import { validateImageReferences } from "@/lib/ai/image-ref-validator";
import { signImagePath } from "@/lib/images/signed-url";

const ID = "clx9abcdefghijklmnop12345";
const ENV = { AUTH_SECRET: "markdown-test-secret-not-a-credential" };
const NOW = Date.parse("2026-09-07T12:00:00Z");
const signed = () => signImagePath(ID, { env: ENV, now: NOW });

describe("sanitize-history · signed image markdown", () => {
  it("positive control: the raw form is still replaced", () => {
    expect(stripImageMarkdownFromText(`look ![Generated Image](/api/images/${ID}) done`)).toContain("[image rendered]");
  });

  it("the signed form is replaced too — not shown to the model", () => {
    const out = stripImageMarkdownFromText(`look ![Generated Image](${signed()}) done`);
    expect(out).toContain("[image rendered]");
    expect(out).not.toContain("/api/images/");
  });

  it("an external image is left alone", () => {
    const text = "![Generated Image](https://example.test/x.png)";
    expect(stripImageMarkdownFromText(text)).toBe(text);
  });
});

describe("image-ref-validator · signed image markdown", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a real id behind a signed link is found, valid, and left untouched", async () => {
    db.auditEvent.findMany.mockResolvedValue([{ id: ID }]);
    const text = `![Generated Image](${signed()})`;
    const r = await validateImageReferences(text);
    expect(r).toMatchObject({ found: 1, valid: 1, ghosts: 0 });
    expect(r.cleaned).toBe(text);
  });

  it("a fabricated id behind a signed link is swapped out, query string and all", async () => {
    db.auditEvent.findMany.mockResolvedValue([]);
    const r = await validateImageReferences(`![Generated Image](${signed()})`);
    expect(r.ghosts).toBe(1);
    expect(r.cleaned).not.toContain("/api/images/");
    expect(r.cleaned).not.toContain("sig=");
  });
});
