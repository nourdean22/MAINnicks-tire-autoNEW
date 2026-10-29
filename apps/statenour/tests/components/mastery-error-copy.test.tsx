/**
 * 2026-10-29 sync audit, finding 8: the (mastery) error boundary printed error.message verbatim, so a
 * raw server string (Prisma, stack fragments) reached the screen. It now shows a fixed sentence and the digest.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children }: { children: unknown }) => children }));

import MasteryError from "@/app/(mastery)/error";

describe("MasteryError copy", () => {
  it("never prints the raw error message; shows the digest for the log", () => {
    const error = Object.assign(new Error("PrismaClientKnownRequestError: relation \"x\" does not exist"), {
      digest: "4021337",
    });
    const html = renderToStaticMarkup(<MasteryError error={error} reset={() => {}} />);
    expect(html).not.toContain("Prisma");
    expect(html).toContain("This page didn&#x27;t load");
    expect(html).toContain("ref 4021337");
  });
});
