/**
 * Task.notes stays on the task's own surfaces (2026-10-29, open item a).
 *
 * Choice: notes are read where the task is the subject (getTaskById, the
 * notes save) and nowhere in bulk. listTasks (board, dashboard, anything that
 * forwards a list) omits the column; every Nick prompt builder already
 * projects Task with `select` and none of them names notes. Source pins,
 * because the leak would be silent: a prompt that quietly grows.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const fnBody = (src: string, name: string) => {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", start + 10);
  return src.slice(start, next === -1 ? undefined : next);
};

describe("Task.notes is not loaded by bulk reads", () => {
  it("listTasks omits notes on both of its findMany calls", () => {
    const body = fnBody(read("lib/services/tasks.ts"), "listTasks");
    const calls = body.split("prisma.task.findMany(").slice(1);
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call.slice(0, 900)).toMatch(/omit:\s*\{\s*notes:\s*true\s*\}/);
  });

  it("getTaskById (the task as subject) does not omit notes", () => {
    expect(fnBody(read("lib/services/tasks.ts"), "getTaskById")).not.toMatch(/notes:\s*true/);
  });

  it.each([
    "lib/brain/task-context.ts",
    "lib/ai/page-data.ts",
    "lib/ai/propose-actions.ts",
    "lib/home/operator-brief.ts",
    "lib/services/todo-desk.ts",
  ])("%s projects Task fields and never selects notes", (file) => {
    const src = read(file);
    expect(src).toMatch(/\.task\.findMany\(/);
    expect(src).not.toMatch(/notes:\s*true/);
  });
});
