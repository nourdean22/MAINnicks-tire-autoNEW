/**
 * /proof had no pending UI (audit 02-X2): its server reads ran with a blank body. The route-level loading.tsx
 * renders the shared StandardPage skeleton under the page's own header, so the wait looks like the page.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/proof" }));

import ProofLoading from "@/app/(mastery)/proof/loading";

describe("/proof loading state", () => {
  it("renders the page header and the shared skeleton", () => {
    const html = renderToStaticMarkup(<ProofLoading />);
    expect(html).toContain('data-testid="page-skeleton"');
    expect(html).toContain("Proof");
  });
});
