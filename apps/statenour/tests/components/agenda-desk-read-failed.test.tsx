/**
 * AgendaDesk renders a failed read as unknown, not empty (audit 09-F7).
 *
 * With no data and no loading flag it fell through to "No agenda items available.", the same words a
 * missing feature would show, so a 500 read as "nothing to do". It now says "unknown \u00b7 read failed"
 * with the reason, like the ReadFailed rows beside it on /system.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AgendaDesk } from "@/components/system/agenda-desk";

const render = (queryResult: Record<string, unknown>) => renderToStaticMarkup(<AgendaDesk queryResult={queryResult} />);

describe("AgendaDesk read states (09-F7)", () => {
  it("a failed read says unknown and names the reason", () => {
    const html = render({ isLoading: false, isError: true, error: { message: "boom" } });
    expect(html).toContain("unknown \u00b7 read failed: boom");
    expect(html).not.toContain("No agenda items available.");
    expect(html).not.toContain("No active agenda items.");
  });

  it("CONTROL: a successful read with no rows keeps its empty copy", () => {
    const html = render({ isLoading: false, isError: false, data: [] });
    expect(html).toContain("No active agenda items.");
    expect(html).not.toContain("read failed");
  });

  it.each([false, true])("CONTROL: rows in hand still render (isError %s: a failed refetch keeps the last rows)", (isError) => {
    const html = render({
      isLoading: false,
      isError,
      data: [{ id: "1", category: "STANDING_INTENTION", title: "Walk daily", createdAt: null }],
    });
    expect(html).toContain("Walk daily");
    expect(html).not.toContain("read failed");
  });
});
