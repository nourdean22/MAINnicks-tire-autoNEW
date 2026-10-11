/**
 * AnimatedCounter must paint the real value first (audit 14-live-crons item 3,
 * 2026-10-10).
 *
 * THE DEFECT. The counter rendered a literal 0 and wrote the real value only
 * from a requestAnimationFrame tick. Browsers run no frames in a hidden or
 * background document, so every tile on /system/crons read 0 while the header
 * (a plain string) read the truth. 0 active with 0 headroom: impossible data,
 * a stuck counter. The server markup is what a frame-less document keeps, so
 * it must carry the target value.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AnimatedCounter } from "@/components/ui/animated-counter";

describe("AnimatedCounter · initial paint", () => {
  it("server-rendered markup holds the target value, not 0", () => {
    const html = renderToStaticMarkup(<AnimatedCounter value={56} />);
    expect(html).toContain(">56<");
    expect(html).not.toContain(">0<");
  });

  it("keeps prefix, suffix, decimals and locale grouping in the first paint", () => {
    const html = renderToStaticMarkup(
      <AnimatedCounter value={1234.5} decimals={1} prefix="$" suffix="k" />,
    );
    expect(html).toContain(`>$${(1234).toLocaleString()}.5k<`);
  });
});
