/**
 * 2026-10-29 sync audit, finding 4: "Pull to refresh" pointed at router.refresh(), which does not
 * refetch client tRPC reads. Every failed-read line on Missions now carries a Retry that refetches.
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/missions/task-pending-classification-chip", () => ({ TaskPendingClassificationChip: () => null }));

import { ReadFailed } from "@/components/ui/read-failed";
import { DeckTriage } from "@/components/missions/deck-triage";

const root = path.resolve(__dirname, "../..");

describe("ReadFailed · a Retry that refetches", () => {
  it("the Retry button calls onRetry", () => {
    const onRetry = vi.fn();
    const tree = ReadFailed({ children: "read failed", onRetry }) as ReactElement<{ children: unknown[] }>;
    const button = tree.props.children.find(
      (c): c is ReactElement<{ onClick: () => void }> => isValidElement(c) && c.type === "button",
    );
    button!.props.onClick();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("DeckTriage with an unread source shows Retry, not a pull gesture", () => {
    const html = renderToStaticMarkup(
      <DeckTriage
        triage={{ rows: [], totalCount: 0 }}
        tasks={[]}
        onEditTask={() => {}}
        onSnoozeTask={async () => true}
        onDeleteTask={() => {}}
        incomplete
        onRetry={() => {}}
      />,
    );
    expect(html).toContain("Retry");
    expect(html).toMatch(/could not be read/);
  });

  it("no page copy tells the operator to pull to refresh", () => {
    let out = "";
    try {
      // --untracked so a new file is seen too; git grep exits 1 when nothing matches.
      out = execSync('git grep --untracked -n -i "pull to refresh" -- app components', { cwd: root, encoding: "utf8" });
    } catch (e) {
      if ((e as { status?: number }).status !== 1) throw e;
    }
    const hits = out.split("\n").filter((l) => l && !l.startsWith("components/ui/read-failed.tsx"));
    expect(hits).toEqual([]);
  });
});
