/**
 * Commissioning: the operator's phone as the out-of-band witness.
 *
 * A controlled drive-in is the only evidence that separates "the pipeline is green" from
 * "the pipeline is right". You stand somewhere safe, tap what you SEE, and the report
 * afterwards diffs your timeline against the machine's.
 *
 * DESIGN CONSTRAINTS, all from where this is actually used — outdoors, one-handed, on a
 * phone, while watching a moving car:
 *  · Taps are the largest thing on screen and never smaller than 48px (the iOS-PWA rule);
 *    a mis-tap is a corrupted measurement, not a cosmetic annoyance.
 *  · The next expected tap is highlighted, but EVERY tap stays enabled. A real drive does
 *    not follow the script — a car reverses, or you miss the moment — and a wizard that
 *    forced the order would make the operator record a lie to get to the next screen.
 *  · Two clocks are captured per tap: `Date.now()` and `performance.now()`. Android's wall
 *    clock can step mid-run (an NTP correction, a timezone change); the monotonic one
 *    cannot, so the pair is what makes a late-discovered clock jump recoverable.
 *  · No `window.confirm` anywhere — silently suppressed in an installed PWA, which is
 *    exactly how this is opened.
 */
import { useEffect, useRef, useState } from "react";
import { ClipboardCheck, CircleDot, Timer, CheckCircle2, XCircle, HelpCircle, X } from "lucide-react";

import { trpc } from "@/lib/trpc";
import { Panel } from "./shared";

/** The six taps, in the order a drive-in produces them. Mirrors the server's vocabulary. */
const TAPS = [
  { key: "OUTSIDE", label: "Outside", hint: "car is off the property" },
  { key: "ENTERING", label: "Entering", hint: "crossing the driveway" },
  { key: "INSIDE_LOT", label: "Inside lot", hint: "fully on the property" },
  { key: "IN_BAY", label: "In a bay", hint: "pulled into bay 1 or 3" },
  { key: "EXITING", label: "Exiting", hint: "heading for the street" },
  { key: "DEPARTED", label: "Departed", hint: "gone" },
] as const;

type TapKey = (typeof TAPS)[number]["key"];

interface LocalTap {
  event: TapKey;
  wallMs: number;
  monoMs: number;
}

function clockTone(rttMs: number | null): string {
  if (rttMs === null) return "text-foreground/50";
  if (rttMs > 1500) return "text-red-400";
  if (rttMs > 400) return "text-amber-400";
  return "text-emerald-400";
}

function verdictChip(verdict: string) {
  const map: Record<string, { cls: string; icon: React.ReactNode }> = {
    PASS: { cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", icon: <CheckCircle2 className="w-4 h-4" /> },
    FAIL: { cls: "border-red-500/40 bg-red-500/10 text-red-300", icon: <XCircle className="w-4 h-4" /> },
    INCONCLUSIVE: { cls: "border-amber-500/40 bg-amber-500/10 text-amber-300", icon: <HelpCircle className="w-4 h-4" /> },
  };
  const v = map[verdict] ?? map.INCONCLUSIVE;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] font-semibold ${v.cls}`}>
      {v.icon}
      {verdict.toLowerCase()}
    </span>
  );
}

/** ms -> "+285 ms" / "-1.2 s". Sign is kept: early and late are different problems. */
function formatDelta(ms: number | null): string {
  if (ms === null) return "—";
  const sign = ms < 0 ? "−" : "+";
  const a = Math.abs(ms);
  return a < 1000 ? `${sign}${a} ms` : `${sign}${(a / 1000).toFixed(a < 10_000 ? 2 : 1)} s`;
}

export default function CommissioningPanel({ camera = "sign" }: { camera?: string }) {
  const [runId, setRunId] = useState<string | null>(null);
  const [taps, setTaps] = useState<LocalTap[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * Taps whose write has not come back yet.
   *
   * The operator naturally taps DEPARTED and reaches straight for End. If that write is
   * still in flight, `endCommissioning` can set `endedAt` first -- and `recordTruth`
   * REFUSES a tap on an ended run, so the mandatory tap is lost and a perfectly good
   * drive reports INCONCLUSIVE for a missing witness (Codex P1 on #2255). End waits.
   */
  const [pendingTaps, setPendingTaps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reportRunId, setReportRunId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const monoOrigin = useRef<number>(0);
  /**
   * True once this page has RESUMED a run it did not start.
   *
   * `monoOrigin` is then this page's `performance.now()` zero, which has nothing to do
   * with the origin the server stored when the run began -- so sending `phoneMonoMs`
   * would have the server reconstruct every later tap from the ORIGINAL anchor plus a
   * restarted offset, placing them however long the first session lasted too early. That
   * is worse than no monotonic reading at all, because it is confidently wrong rather
   * than absent (Codex P1 on #2255). Resumed taps therefore send null and fall back to
   * their corrected wall time, which is what the resume banner already promises.
   */
  const resumed = useRef(false);

  const utils = trpc.useUtils();
  // Polled THROUGHOUT a run, not only when idle: this read carries the producer's
  // acknowledgement, which is what arms the tap buttons.
  const runs = trpc.lot.commissioningRuns.useQuery({ limit: 5 }, { refetchInterval: 5_000 });
  const report = trpc.lot.commissioningReport.useQuery(
    { runId: reportRunId ?? "", toleranceMs: 3000 },
    { enabled: Boolean(reportRunId) },
  );

  const start = trpc.lot.startCommissioning.useMutation();
  const record = trpc.lot.recordTruth.useMutation();
  const end = trpc.lot.endCommissioning.useMutation();

  // Hooks stay above every conditional return (`pnpm run lint:hooks` enforces it).
  useEffect(() => {
    if (!runId) return;
    const t = setInterval(() => setElapsed(Math.round((performance.now() - monoOrigin.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [runId]);

  const openRun = runs.data?.ok === true ? runs.data.runs.find((r) => r.open) ?? null : null;
  const activeRun = runId ? runs.data?.ok === true ? runs.data.runs.find((r) => r.runId === runId) ?? null : null : null;
  // THE PRODUCER'S ACKNOWLEDGEMENT, not our own optimism. The edge only learns of a run on
  // its next heartbeat (up to 30 s), and a car driven during that gap is recorded as
  // PRODUCTION with no run id -- which the immutable ingest fields make unrepairable, so
  // the drive would pollute customer KPIs AND the report would see no machine visit.
  const armed = Boolean(activeRun?.acknowledged);

  /**
   * Measure the phone/server clock offset before the run, not after.
   *
   * Five round trips, each timed on THIS device; the server picks the fastest, because a
   * delayed packet biases the estimate one way only. Without this the report has no
   * anchor and correctly refuses to call a run PASS.
   */
  async function syncAndStart() {
    setError(null);
    setBusy("Syncing clocks…");
    try {
      const samples: Array<{ t0: number; serverMs: number; t1: number }> = [];
      for (let i = 0; i < 5; i++) {
        const t0 = Date.now();
        // `staleTime: 0` is load-bearing, not decoration. `utils.*.fetch()` goes through
        // the react-query cache, and a cached answer would return the SAME server instant
        // five times: five samples with a plausible spread of round-trip times and one
        // frozen `serverMs`. The offset would come out wrong by however long the loop
        // took, and nothing downstream could tell -- it would look like a clean sync.
        const res = await utils.lot.clock.fetch(undefined, { staleTime: 0 });
        const t1 = Date.now();
        if (res?.ok) samples.push({ t0, serverMs: res.serverMs, t1 });
      }
      setBusy("Starting run…");
      // Zero the monotonic timer and capture the WALL instant of that same moment, so the
      // server can anchor every reconstructed tap to the phone's own origin instead of to
      // its own `startedAt` -- which would fold this whole request's latency into every
      // tap as a constant error.
      const originWallMs = Date.now();
      monoOrigin.current = performance.now();
      resumed.current = false;
      const started = await start.mutateAsync({ camera, clockSamples: samples, monoOriginWallMs: originWallMs });
      if (!started.ok) {
        setError(started.reason);
        return;
      }
      setTaps([]);
      setElapsed(0);
      setRunId(started.runId);
      setReportRunId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not start the run");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Record one tap. The local list updates IMMEDIATELY and independently of the network:
   * the measurement is the instant your thumb landed, and making it wait on a POST would
   * put WAN latency inside the very number being measured. A failed send is surfaced, not
   * swallowed — a silently dropped tap would show up later as a machine "miss".
   */
  async function tap(event: TapKey) {
    if (!runId) return;
    const wallMs = Date.now();
    const monoMs = Math.round(performance.now() - monoOrigin.current);
    setTaps((prev) => [...prev, { event, wallMs, monoMs }]);
    setPendingTaps((n) => n + 1);
    try {
      const res = await record.mutateAsync({
        runId, event, phoneWallMs: wallMs,
        phoneMonoMs: resumed.current ? null : monoMs,
      });
      if (!res.ok) setError(`${event}: ${res.reason}`);
    } catch (e) {
      setError(`${event} was not saved: ${e instanceof Error ? e.message : "send failed"}`);
    } finally {
      setPendingTaps((n) => Math.max(0, n - 1));
    }
  }

  /**
   * Re-attach to a run that is still open on the server.
   *
   * `runId` lives only in component state, so a PWA reload or an iOS kill mid-drive lost
   * the only path that could end the run -- leaving the edge in commissioning mode
   * indefinitely, quietly excluding real visits from the shop's metrics (Codex P1 on
   * #2255). The monotonic origin cannot be recovered (this is a NEW page), so taps after a
   * resume carry wall time only; the report degrades to the wall reading for them and says
   * so, rather than inventing an anchor.
   */
  function resume(id: string) {
    resumed.current = true;
    monoOrigin.current = performance.now();
    setTaps([]);
    setElapsed(0);
    setReportRunId(null);
    setError("Resumed after a reload: the monotonic anchor is lost, so taps from here carry wall time only.");
    setRunId(id);
  }

  async function endOrphan(id: string) {
    setBusy("Ending…");
    try {
      const res = await end.mutateAsync({ runId: id });
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      await utils.lot.commissioningRuns.invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not end the run");
    } finally {
      setBusy(null);
    }
  }

  async function finish() {
    if (!runId) return;
    setBusy("Ending run…");
    try {
      // CHECK `ok` BEFORE CHANGING LOCAL STATE. The mutation reports a database or
      // migration failure as a RESOLVED `{ ok: false, reason }`, so `mutateAsync` does not
      // throw. Clearing `runId` on that payload would close the screen while the run is
      // still open in the database -- the operator could then neither retry ending it nor
      // record another tap, and the report would open on a run that never finished
      // (Codex P2 on #2255).
      const res = await end.mutateAsync({ runId });
      if (!res.ok) {
        setError(`the run is still open: ${res.reason}`);
        return;
      }
      setReportRunId(runId);
      setRunId(null);
      await utils.lot.commissioningRuns.invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not end the run");
    } finally {
      setBusy(null);
    }
  }

  const nextExpected = TAPS[Math.min(taps.length, TAPS.length - 1)]?.key;

  // ─── The run screen: everything else gets out of the way ──────────────────
  if (runId) {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-background p-4">
        <div className="mx-auto max-w-md">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-[15px] font-semibold">{runId}</div>
              <div className="text-[13px] text-foreground/60">
                <Timer className="mr-1 inline h-3.5 w-3.5" />
                {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} · {taps.length} taps
              </div>
            </div>
            <button
              type="button"
              onClick={finish}
              disabled={Boolean(busy) || pendingTaps > 0}
              className="min-h-[48px] rounded-lg border border-foreground/20 px-4 text-[14px] font-semibold hover:bg-foreground/5 disabled:opacity-50"
            >
              {busy ?? (pendingTaps > 0 ? "Saving taps…" : "End run")}
            </button>
          </div>

          {error && (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[13px] text-red-300">
              {error}
            </div>
          )}

          {!armed && (
            <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[13px] text-amber-200">
              <div className="font-semibold">Waiting for the camera to acknowledge — do not drive yet.</div>
              <div className="mt-1 text-amber-200/80">
                The producer picks up a run on its next heartbeat, up to 30 seconds. A car driven
                before then is recorded as a real customer visit and cannot be reclassified
                afterwards.
              </div>
            </div>
          )}

          <div className="mt-4 grid gap-2.5">
            {TAPS.map((t) => {
              const isNext = t.key === nextExpected;
              const count = taps.filter((x) => x.event === t.key).length;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => tap(t.key)}
                  disabled={!armed}
                  className={`min-h-[72px] rounded-xl border-2 px-4 py-3 text-left transition-colors disabled:opacity-40 ${
                    isNext && armed
                      ? "border-emerald-500/60 bg-emerald-500/10"
                      : "border-foreground/15 hover:bg-foreground/5"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[19px] font-bold leading-tight">{t.label}</div>
                      <div className="text-[13px] text-foreground/55">{t.hint}</div>
                    </div>
                    {count > 0 && (
                      <span className="rounded-full bg-foreground/10 px-2.5 py-1 text-[13px] tabular-nums">
                        ×{count}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {taps.length > 0 && (
            <div className="mt-4 space-y-1 text-[13px] text-foreground/55">
              {[...taps].reverse().slice(0, 8).map((t, i) => (
                <div key={`${t.event}-${t.monoMs}-${i}`} className="flex justify-between tabular-nums">
                  <span>{t.event.toLowerCase().replace("_", " ")}</span>
                  <span>+{(t.monoMs / 1000).toFixed(1)} s</span>
                </div>
              ))}
            </div>
          )}

          <p className="mt-4 text-[12px] text-foreground/40">
            Every tap is stamped with this phone's wall clock and a monotonic timer, and the
            offset against the server was measured before the run. Rows recorded during a run
            are tagged <span className="font-mono">COMMISSIONING</span> and stay out of the
            shop's counters. If this page reloads mid-run, the run stays open on the server —
            reopen the Lot page and resume or end it from the list.
          </p>
        </div>
      </div>
    );
  }

  // ─── Idle: recent runs, and the report of the one just finished ───────────
  return (
    <Panel
      title="Commissioning"
      icon={<ClipboardCheck className="h-4 w-4" />}
      subtitle="Drive a known car through while tapping what you see — the report diffs your timeline against the camera's"
      actions={
        <button
          type="button"
          onClick={syncAndStart}
          disabled={Boolean(busy) || Boolean(openRun)}
          className="min-h-[44px] rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 text-[13px] font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
        >
          {busy ?? "Start a run"}
        </button>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[13px] text-red-300">{error}</div>
      )}

      {openRun && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="text-[13px] font-semibold text-amber-200">
            <span className="font-mono">{openRun.runId}</span> is still open
          </div>
          <div className="mt-1 text-[13px] text-amber-200/80">
            {openRun.acknowledged
              ? "The camera is in commissioning mode, so its visits are being kept out of the shop's counters. End the run when you are finished."
              : "The camera has not acknowledged this run. If it never does, end it."}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => resume(openRun.runId)}
              className="min-h-[44px] rounded-md border border-foreground/20 px-3 text-[13px] font-semibold hover:bg-foreground/5"
            >
              Resume
            </button>
            <button
              type="button"
              onClick={() => endOrphan(openRun.runId)}
              disabled={Boolean(busy)}
              className="min-h-[44px] rounded-md border border-red-500/40 bg-red-500/10 px-3 text-[13px] font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-50"
            >
              {busy ?? "End it"}
            </button>
          </div>
        </div>
      )}

      {reportRunId && (
        <div className="mb-4 rounded-lg border border-foreground/15 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="font-mono text-[14px] font-semibold">{reportRunId}</div>
            <div className="flex items-center gap-2">
              {report.data?.ok === true && verdictChip(report.data.report.verdict)}
              {report.data?.ok === true && !report.data.run.settled && (
                <span
                  className="rounded border border-foreground/20 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-foreground/50"
                  title={`The edge emits a departure only after its grace period and drains on a timer, so the last events of a run can arrive after you press End. This verdict is not recorded until ${report.data.run.settleSeconds}s have passed.`}
                >
                  provisional
                </span>
              )}
              <button
                type="button"
                onClick={() => setReportRunId(null)}
                aria-label="Dismiss report"
                className="rounded-md p-2 text-foreground/50 hover:bg-foreground/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {report.isPending ? (
            <div className="mt-2 text-[13px] text-foreground/50">Building the report…</div>
          ) : report.data?.ok === false ? (
            <div className="mt-2 text-[13px] text-red-300">{report.data.reason}</div>
          ) : report.data?.ok === true ? (
            <>
              {report.data.report.findings.length > 0 && (
                <ul className="mt-2 space-y-1 text-[13px] text-amber-300">
                  {report.data.report.findings.map((f, i) => (
                    <li key={i}>· {f}</li>
                  ))}
                </ul>
              )}
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-foreground/10 text-left text-foreground/50">
                      <th className="py-1.5 pr-3 font-medium">You saw</th>
                      <th className="py-1.5 pr-3 font-medium">Camera</th>
                      <th className="py-1.5 font-medium text-right">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.data.report.matches.map((m, i) => (
                      <tr key={i} className="border-b border-foreground/5 last:border-0">
                        <td className="py-1.5 pr-3">
                          {m.human.event.toLowerCase().replace("_", " ")}
                          {m.required && <span className="text-foreground/35"> · required</span>}
                        </td>
                        <td className="py-1.5 pr-3 text-foreground/70">
                          {m.machine ? m.machine.state.toLowerCase().replace(/_/g, " ") : "—"}
                        </td>
                        <td
                          className={`py-1.5 text-right tabular-nums ${
                            m.deltaMs === null
                              ? "text-foreground/40"
                              : Math.abs(m.deltaMs) > 3000
                                ? "text-red-400"
                                : "text-emerald-400"
                          }`}
                        >
                          {formatDelta(m.deltaMs)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-foreground/50 tabular-nums">
                <span>
                  required matched {report.data.report.stats.matchedRequired}/{report.data.report.stats.totalRequired}
                </span>
                {report.data.report.stats.medianAbsDeltaMs !== null && (
                  <span>median |Δ| {report.data.report.stats.medianAbsDeltaMs} ms</span>
                )}
                <span>visits {report.data.report.visitIds.length}</span>
                {!report.data.run.settled && (
                  <span className="text-foreground/40">
                    not recorded yet &middot; {report.data.run.unsettledReason}
                  </span>
                )}
                {report.data.run.clock && (
                  <span className={clockTone(report.data.run.clock.rttMs)}>
                    clock {report.data.run.clock.offsetMs > 0 ? "+" : ""}
                    {report.data.run.clock.offsetMs} ms · rtt {report.data.run.clock.rttMs} ms
                  </span>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}

      {runs.isError ? (
        <div className="text-[13px] text-red-300">Commissioning history unavailable — this is not "no runs".</div>
      ) : runs.isPending ? (
        <div className="text-[13px] text-foreground/50">Loading runs…</div>
      ) : runs.data?.ok === false ? (
        <div className="text-[13px] text-red-300">{runs.data.reason}</div>
      ) : (runs.data?.runs.length ?? 0) === 0 ? (
        <div className="text-[13px] text-foreground/60">
          No commissioning run yet. The first one is what turns "the tests are green" into
          "a real car was measured".
        </div>
      ) : (
        <div className="space-y-1.5">
          {runs.data!.runs.map((r) => (
            <button
              key={r.runId}
              type="button"
              onClick={() => setReportRunId(r.runId)}
              className="flex w-full items-center justify-between gap-3 rounded-md border border-foreground/10 px-3 py-2 text-left text-[13px] hover:bg-foreground/5"
            >
              <span className="font-mono">{r.runId}</span>
              <span className="flex items-center gap-2 text-foreground/60 tabular-nums">
                {r.open && <CircleDot className="h-3.5 w-3.5 text-emerald-400" />}
                <span>{r.taps} taps</span>
                <span>{r.visits} visits</span>
                {r.verdict && verdictChip(r.verdict)}
              </span>
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}
