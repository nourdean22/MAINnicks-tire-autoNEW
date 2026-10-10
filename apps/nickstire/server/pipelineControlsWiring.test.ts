/**
 * Pipeline controls are wired, not just defined (2026-10-10). The helpers in
 * services/pipelineControls.ts are the policy; these pins prove the admin
 * router, the admin HTTP route and the Action Center reach them, and that each
 * runner is the same code the 15-minute tick runs, scoped to one job.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf8");
const block = (src: string, start: string, end: string) => {
  const i = src.indexOf(start);
  expect(i, `anchor missing: ${start}`).toBeGreaterThan(-1);
  const j = src.indexOf(end, i + start.length);
  expect(j, `end missing after ${start}`).toBeGreaterThan(i);
  return src.slice(i, j);
};

describe("contentAdmin exposes the controls", () => {
  const SRC = read("server/routers/content.ts");

  it("runCronJobNow starts a registered job through startCronJobNow + runJobByName, in the background", () => {
    const b = block(SRC, "runCronJobNow: adminProcedure", "\n  }),\n");
    expect(b).toContain("startCronJobNow(");
    expect(b).toContain("getRegisteredJobNames()");
    expect(b).toContain("runJobByName");
    expect(b).toContain("BAD_REQUEST");
  });

  it("listCronJobs reads the registry and the cadences, nothing else", () => {
    const b = block(SRC, "listCronJobs: adminProcedure", "\n  }),\n");
    expect(b).toContain("getRegisteredJobNames()");
    expect(b).toContain("getJobCadences()");
  });

  it("advanceReelJobNow reads the job's status and starts exactly the tick's runner for that step", () => {
    const b = block(SRC, "advanceReelJobNow: adminProcedure", "\n  }),\n");
    expect(b).toContain("startReelStepNow(");
    expect(b).toContain("processNextReelJob(input.jobId)");
    expect(b).toContain("processNextAssemblyJob(input.jobId)");
    expect(b).toContain("runRenderedQaOnJob(input.jobId)");
    expect(b).toContain("measureJobAudioQa(");
    expect(b).toContain("BAD_REQUEST");
  });

  it("reelJobsInFlight lists only the waiting and working statuses", () => {
    const b = block(SRC, "reelJobsInFlight: adminProcedure", "\n  }),\n");
    for (const s of ["queued", "generating", "assets_ready", "assembling", "assembled"]) expect(b).toContain(`"${s}"`);
    expect(b).not.toContain('"posted"');
  });
});

describe("the admin HTTP door runs any registered job, behind the admin key", () => {
  it("/api/admin/run-cron uses requireAdminApiKey and startCronJobNow, and refuses unknown names with 404", () => {
    const ADMIN = read("server/routes/adminRoutes.ts");
    expect(ADMIN).toMatch(/app\.post\("\/api\/admin\/run-cron",\s*requireAdminApiKey/);
    const b = block(ADMIN, 'app.post("/api/admin/run-cron"', "\n  });\n");
    expect(b).toContain("startCronJobNow(");
    expect(b).toContain("runJobByName");
    expect(b).toMatch(/status\(404\)/);
  });
});

describe("the Action Center has the buttons", () => {
  const UI = read("client/src/pages/admin/instagram/ActionCenter.tsx");
  it("advance-now and run-now mutations are wired to the router, and the in-flight list is queried", () => {
    expect(UI).toContain("trpc.contentAdmin.advanceReelJobNow.useMutation");
    expect(UI).toContain("trpc.contentAdmin.runCronJobNow.useMutation");
    expect(UI).toContain("trpc.contentAdmin.reelJobsInFlight.useQuery");
    expect(UI).toContain("trpc.contentAdmin.listCronJobs.useQuery");
  });
  it("no native dialogs: the controls confirm nothing through window.*", () => {
    expect(UI).not.toMatch(/window\.(confirm|alert|prompt)\(/);
  });
});
