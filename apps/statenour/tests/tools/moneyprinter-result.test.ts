/**
 * parseMoneyprinterResult — a parser over ANOTHER project's CLI output.
 *
 * The moneyprinter tool's description has always promised "the generated video
 * filepath" and the tool never returned one; callers got raw stdout. cli.py's
 * last line is `{"task_id": ..., "result": {..., "videos": [...]}}`
 * (moneyprinter app/services/task.py:465), preceded by loguru progress noise.
 *
 * This is exactly the contract that breaks silently when the vendored upstream
 * is upgraded, so it is pinned.
 */
import { describe, it, expect } from "vitest";
import { parseMoneyprinterResult } from "@/lib/ai/tools/system";

const NOISE = [
  "2026-08-03 20:11:02 | INFO | start cli task: abc123, stop_at: video",
  "2026-08-03 20:11:40 | INFO | generating video: 1 => /app/storage/tasks/abc123/final-1.mp4",
  "  0%|          | 0/240 [00:00<?, ?it/s]",
].join("\n");

describe("parseMoneyprinterResult", () => {
  it("extracts the video paths from the final JSON line", () => {
    const stdout = `${NOISE}\n${JSON.stringify({
      task_id: "abc123",
      result: { videos: ["/app/storage/tasks/abc123/final-1.mp4"] },
    })}\n`;

    expect(parseMoneyprinterResult(stdout)).toEqual({
      taskId: "abc123",
      videoPaths: ["/app/storage/tasks/abc123/final-1.mp4"],
    });
  });

  it("returns every path when video-count produced more than one", () => {
    const stdout = JSON.stringify({
      task_id: "t2",
      result: { videos: ["/s/final-1.mp4", "/s/final-2.mp4"] },
    });
    expect(parseMoneyprinterResult(stdout).videoPaths).toHaveLength(2);
  });

  it("ignores earlier JSON-looking log lines and takes the LAST result", () => {
    const stdout = [
      JSON.stringify({ task_id: "old", result: { videos: ["/s/stale.mp4"] } }),
      "…more logs…",
      JSON.stringify({ task_id: "new", result: { videos: ["/s/fresh.mp4"] } }),
    ].join("\n");
    expect(parseMoneyprinterResult(stdout)).toEqual({
      taskId: "new",
      videoPaths: ["/s/fresh.mp4"],
    });
  });

  it("reports NO paths when the run stopped early (stop_at=script/audio)", () => {
    // stop_at short-circuits return {"script": ...} with no videos key — the
    // tool must treat that as a failure, not a success with an empty list.
    const stdout = JSON.stringify({ task_id: "t3", result: { script: "..." } });
    expect(parseMoneyprinterResult(stdout)).toEqual({ taskId: "t3", videoPaths: [] });
  });

  it("returns empty on pure log noise rather than throwing", () => {
    expect(parseMoneyprinterResult(NOISE)).toEqual({ taskId: null, videoPaths: [] });
    expect(parseMoneyprinterResult("")).toEqual({ taskId: null, videoPaths: [] });
  });

  it("drops non-string entries instead of handing a bad path downstream", () => {
    const stdout = JSON.stringify({ task_id: "t4", result: { videos: ["/s/a.mp4", null, 7, ""] } });
    expect(parseMoneyprinterResult(stdout).videoPaths).toEqual(["/s/a.mp4"]);
  });
});
