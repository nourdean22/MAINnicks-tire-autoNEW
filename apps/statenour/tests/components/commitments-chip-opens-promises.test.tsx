/**
 * R3 · 2026-11-03 · Nick's "Commitments read, N active" chip links to the Promises section on
 * /missions, where those rows can be closed or edited. Asserted on the rendered card (the consumer),
 * not on the registry entry alone.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/trpc/client", () => {
  const hookLeaf = { useMutation: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }) };
  const procProxy = new Proxy({}, { get: () => hookLeaf });
  return { trpc: new Proxy({}, { get: () => procProxy }) };
});
vi.spyOn(console, "warn").mockImplementation(() => {});

import { ToolResultCard } from "@/components/chat/tool-result-card";

describe("getCommitments chip", () => {
  it("links to /missions#promises", () => {
    // lib/ai/tools/tasks.ts getCommitments: prisma Commitment rows
    const output = [{ id: 4, dateMade: "2026-10-30", toWhom: "Mash", description: "Send the alignment quote", deadline: null, status: "active" }];
    const html = renderToStaticMarkup(<ToolResultCard toolName="getCommitments" state="output-available" output={output} />);
    expect(html).toContain("Commitments read");
    expect(html).toContain('href="/missions#promises"');
  });
});
