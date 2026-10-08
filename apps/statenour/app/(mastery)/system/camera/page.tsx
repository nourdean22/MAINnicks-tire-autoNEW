"use client";

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc/client";
import { StandardPage } from "@/components/layout/standard-page";
import { Panel } from "@/components/panel";
import { MetricCard } from "@/components/metric-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { 
  Camera, 
  Car, 
  Check, 
  X, 
  Play, 
  Edit3, 
  AlertTriangle, 
  Clock, 
  ShieldAlert,
  ArrowRight,
  RefreshCw,
  Search
} from "lucide-react";
import { toast } from "sonner";

export default function CameraArrivalsPage() {
  const [selectedCamera, setSelectedCamera] = useState<string>("all");
  const [selectedState, setSelectedState] = useState<string>("all");
  const [searchPlate, setSearchPlate] = useState<string>("");
  const [simulating, setSimulating] = useState(false);
  const [testPlate, setTestPlate] = useState("");
  const [testState, setTestState] = useState("CONFIRMED_ARRIVAL");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [correctedPlateText, setCorrectedPlateText] = useState("");

  // Fetch real-time arrivals data
  const arrivalsQuery = trpc.system.cameraArrivals.useQuery(undefined, {
    refetchInterval: 5000, // Poll every 5 seconds for snappy updates
  });

  const testAlertMutation = trpc.system.testVehicleAlert.useMutation({
    onSuccess: () => {
      toast.success("Test vehicle alert triggered!");
      arrivalsQuery.refetch();
    },
    onError: (err) => {
      toast.error(`Simulate failed: ${err.message}`);
    }
  });

  const updateStatusMutation = trpc.system.updateArrivalStatus.useMutation({
    onSuccess: () => {
      toast.success("Arrival status updated");
      arrivalsQuery.refetch();
    },
    onError: (err) => {
      toast.error(`Update failed: ${err.message}`);
    }
  });

  const data = arrivalsQuery.data || { events: [], todayCount: 0, cameras: [] };
  const loading = arrivalsQuery.isPending || arrivalsQuery.isFetching;
  // 2026-09-08 · empty-vs-error (ADR-0017 / plan C4): a failed read used to
  // render as "0 arrivals today". The error is now its own state; the
  // headline counts show "—" and a banner names the failure.
  const readFailed = arrivalsQuery.isError;
  const readError = arrivalsQuery.error?.message ?? "unknown error";

  // Filtered events
  const filteredEvents = useMemo(() => {
    return data.events.filter((e) => {
      const cameraMatch = selectedCamera === "all" || e.deviceId === selectedCamera;
      const state = e.data?.state || "DETECTED";
      const stateMatch = selectedState === "all" || state === selectedState;
      
      const plateText = (e.data?.plate?.text || "").toLowerCase();
      const plateMatch = !searchPlate || plateText.includes(searchPlate.toLowerCase());
      
      return cameraMatch && stateMatch && plateMatch;
    });
  }, [data.events, selectedCamera, selectedState, searchPlate]);

  // Statistics
  const activeCamerasCount = data.cameras.filter((c) => c.status === "ONLINE").length;
  const totalCamerasCount = data.cameras.length;

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (data.cameras.length === 0) {
      toast.error("No cameras available to simulate. Register a device first.");
      return;
    }
    setSimulating(true);
    // Pick the first camera in the list for simulation
    const targetCameraId = data.cameras[0].id;
    try {
      await testAlertMutation.mutateAsync({
        deviceId: targetCameraId,
        state: testState,
        plateText: testPlate.trim() || undefined,
      });
      setTestPlate("");
    } finally {
      setSimulating(false);
    }
  };

  const handleUpdateStatus = (eventId: string, state: "ACKNOWLEDGED" | "FALSE_POSITIVE" | "LEFT") => {
    updateStatusMutation.mutate({ eventId, state });
  };

  const handleStartEditPlate = (eventId: string, currentText: string) => {
    setEditingEventId(eventId);
    setCorrectedPlateText(currentText);
  };

  const handleSavePlate = async (eventId: string) => {
    try {
      await updateStatusMutation.mutateAsync({
        eventId,
        state: "ACKNOWLEDGED",
        plateText: correctedPlateText.trim().toUpperCase(),
      });
      setEditingEventId(null);
    } catch {
      // toast shown in mutation onError
    }
  };

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  };

  const getDwellDisplay = (seconds: number) => {
    if (!seconds) return "—";
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };

  const getStateBadgeClass = (state: string) => {
    switch (state) {
      case "CONFIRMED_ARRIVAL":
        return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
      case "ENTERED_ZONE":
        return "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20";
      case "ACKNOWLEDGED":
        return "bg-violet-500/10 text-violet-400 border border-violet-500/20";
      case "FALSE_POSITIVE":
        return "bg-red-500/10 text-red-400 border border-red-500/20";
      case "LEFT":
        return "bg-fg-tertiary text-fg-secondary border border-edge-default";
      default:
        return "bg-amber-500/10 text-amber-400 border border-amber-500/20";
    }
  };

  const getPlateBadgeClass = (status: string) => {
    switch (status) {
      case "CONFIRMED":
      case "CORRECTED":
        return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono";
      case "CANDIDATE":
        return "bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono";
      case "UNREADABLE":
      case "REJECTED":
        return "bg-red-500/10 text-red-400 border border-red-500/20";
      default:
        return "bg-fg-tertiary text-fg-secondary border border-edge-default";
    }
  };

  return (
    <StandardPage
      eyebrow="Nick's Tire & Auto"
      title="Arrival Intelligence"
      description="Raw vehicle-event log: arrival alerts and plate corrections. The lot view is Nick's Admin, Lot."
      width="2xl"
      rhythm="loose"
      className="px-3 py-4 text-fg sm:px-4 sm:py-6"
      actions={
          <div className="flex items-center gap-2">
            <FreshnessChip
              // 2026-09-10 · render time is not evidence freshness. See
              // system/tools/page.tsx for the same fix.
              lastFetchedAt={
                arrivalsQuery.dataUpdatedAt ? new Date(arrivalsQuery.dataUpdatedAt) : null
              }
              source="tRPC cameraArrivals"
              onReload={() => arrivalsQuery.refetch()}
            />
            <button
              onClick={() => arrivalsQuery.refetch()}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-control border border-edge-strong bg-content px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:bg-surface-hover disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        }
    >

      {/* Demoted 2026-10-08 (camera audit N4): this is StateNour's raw vehicle-event log, kept
          for the arrival-alert links and for plate corrections. The lot itself (episodes,
          coverage, operator marks) is the Lot section of Nick's Admin, and the morning brief
          carries yesterday's summary from it. Two lot views that disagree are worse than one. */}
      <div
        role="note"
        className="rounded-surface border border-edge-strong bg-content px-3 py-2 text-xs text-fg-secondary"
      >
        This page is the raw vehicle-event log: arrival alerts and plate corrections. The shop&apos;s
        lot view, with coverage and visit marks, is the Lot section of Nick&apos;s Admin
        (nickstire.org/admin); the morning brief carries yesterday&apos;s summary.
      </div>

      {readFailed && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-surface border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Arrivals read failed: {readError}. The counts below are unknown, not zero — retry, or check
            /system/errors.
          </span>
        </div>
      )}

      {/* Stats Summary Panel */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
        <MetricCard
          label="Today's Arrivals"
          value={readFailed ? "—" : data.todayCount}
          hint={readFailed ? "Read failed — value unknown" : "Total confirmed arrivals today (ET day)"}
        />
        <MetricCard
          label="Camera Fleet"
          value={readFailed ? "—" : `${activeCamerasCount} / ${totalCamerasCount}`}
          hint={readFailed ? "Read failed — value unknown" : "Operational cameras on shop WiFi"}
        />
        <MetricCard
          label="Active Alerts"
          value={readFailed ? "—" : data.events.filter((e) => e.data?.state === "CONFIRMED_ARRIVAL").length}
          hint={readFailed ? "Read failed — value unknown" : "Vehicles awaiting operator attention"}
        />
        <MetricCard
          label="Last Detection"
          value={readFailed ? "—" : data.events[0] ? formatTime(data.events[0].timestamp) :"—"}
          hint={
            readFailed
              ? "Read failed — value unknown"
              : data.events[0]
                ? `${data.events[0].cameraName} (${data.events[0].data?.label || "car"})`
                : "No vehicles detected today"
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* Sidebar Filters & Simulator */}
        <div className="space-y-6 lg:col-span-1">
          {/* Filters Card */}
          <Panel className="space-y-4 border border-edge-default">
              <h2 className="text-[15px] font-semibold text-fg-secondary">Filters</h2>
            
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-fg-tertiary mb-1">Camera Source</label>
                <select
                  value={selectedCamera}
                  onChange={(e) => setSelectedCamera(e.target.value)}
                  className="w-full rounded-control border border-edge-strong bg-content px-3 py-2 text-xs text-fg focus:outline-none"
                >
                  <option value="all">All Cameras</option>
                  {data.cameras.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-fg-tertiary mb-1">Event State</label>
                <select
                  value={selectedState}
                  onChange={(e) => setSelectedState(e.target.value)}
                  className="w-full rounded-control border border-edge-strong bg-content px-3 py-2 text-xs text-fg focus:outline-none"
                >
                  <option value="all">All States</option>
                  <option value="ENTERED_ZONE">ENTERED_ZONE</option>
                  <option value="CONFIRMED_ARRIVAL">CONFIRMED_ARRIVAL</option>
                  <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
                  <option value="FALSE_POSITIVE">FALSE_POSITIVE</option>
                  <option value="LEFT">LEFT</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-fg-tertiary mb-1">Plate Search</label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchPlate}
                    onChange={(e) => setSearchPlate(e.target.value)}
                    placeholder="Enter plate text..."
                    className="w-full rounded-control border border-edge-strong bg-content pl-8 pr-3 py-2 text-xs text-fg placeholder:text-fg-tertiary focus:outline-none"
                  />
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-fg-tertiary" />
                </div>
              </div>
            </div>
          </Panel>

          {/* Simulator Card */}
          <Panel className="space-y-4 border border-edge-default">
              <h2 className="text-[15px] font-semibold text-fg-secondary flex items-center gap-1.5">
              <ShieldAlert className="h-4 w-4 text-violet-400" />
              Simulate Arrival
            </h2>
            <form onSubmit={handleSimulate} className="space-y-3">
              <div>
                <label className="block text-xs text-fg-tertiary mb-1">Plate Candidate</label>
                <input
                  type="text"
                  value={testPlate}
                  onChange={(e) => setTestPlate(e.target.value)}
                  placeholder="e.g. ABC1234"
                  maxLength={10}
                  className="w-full rounded-control border border-edge-strong bg-content px-3 py-2 text-xs text-fg placeholder:text-fg-tertiary focus:outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs text-fg-tertiary mb-1">Target State</label>
                <select
                  value={testState}
                  onChange={(e) => setTestState(e.target.value)}
                  className="w-full rounded-control border border-edge-strong bg-content px-3 py-2 text-xs text-fg focus:outline-none"
                >
                  <option value="ENTERED_ZONE">ENTERED_ZONE (Stage 1)</option>
                  <option value="CONFIRMED_ARRIVAL">CONFIRMED_ARRIVAL (Stage 2)</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={simulating || data.cameras.length === 0}
                className="w-full flex items-center justify-center gap-1.5 rounded-control bg-accent hover:bg-accent-hover text-[var(--text-inverse)] font-semibold text-[13px] min-h-[44px] transition disabled:opacity-50"
              >
                <Play className="h-3 w-3" />
                {simulating ? "Simulating..." : "Trigger Simulation"}
              </button>
              {data.cameras.length === 0 && (
                <p className="text-[11px] text-red-400 mt-1">Please register a device platform first.</p>
              )}
            </form>
          </Panel>
        </div>

        {/* Arrivals Feed Table */}
        <div className="lg:col-span-3 space-y-4">
              <Panel className="border border-edge-default p-0 overflow-hidden">
            <div className="p-4 border-b border-edge-default flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-fg">Recent Arrivals Feed</h2>
              <span className="text-xs text-fg-tertiary">Showing {filteredEvents.length} results</span>
            </div>

            {readFailed ? (
              <div className="p-12 text-center text-red-300 space-y-2">
                <AlertTriangle className="h-10 w-10 mx-auto text-red-400 stroke-[1.5]" />
                <p className="text-sm">The arrivals read failed — this list is unknown, not empty.</p>
                <p className="text-xs text-red-400/70">{readError}</p>
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="p-12 text-center text-fg-tertiary space-y-2">
              <Car className="h-10 w-10 mx-auto text-fg-tertiary stroke-[1.5]" />
                <p className="text-sm">No vehicle events found matching criteria.</p>
                <p className="text-xs text-fg-tertiary">Events are ingested from the camera-bridge or simulator.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-edge-default bg-content text-fg-tertiary">
                      <th className="p-3 font-medium">Time / Camera</th>
                      <th className="p-3 font-medium">Vehicle / Conf</th>
                      <th className="p-3 font-medium">Dwell</th>
                      <th className="p-3 font-medium">State</th>
                      <th className="p-3 font-medium">Plate OCR</th>
                      <th className="p-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEvents.map((e) => {
                      const state = e.data?.state || "DETECTED";
                      const label = e.data?.label || "vehicle";
                      const conf = e.data?.confidence || 0;
                      const dwell = e.data?.dwellSeconds || 0;
                      const plate = e.data?.plate || { status: "NONE" };
                      const isEditingPlate = editingEventId === e.id;

                      return (
                        <tr key={e.id} className="border-b border-edge-default hover:bg-surface-hover transition">
                          <td className="p-3">
                            <div className="font-semibold text-fg">{formatTime(e.timestamp)}</div>
                            <div className="text-[11px] text-fg-tertiary flex items-center gap-1 mt-0.5">
              <Camera className="h-3 w-3 text-fg-tertiary" />
                              {e.cameraName}
                            </div>
                          </td>
                          <td className="p-3">
              <span className="capitalize font-medium text-fg">{label}</span>
                            <div className="text-[11px] text-fg-tertiary mt-0.5">
                              Conf: {Math.round(conf * 100)}%
                            </div>
                          </td>
                          <td className="p-3 font-medium text-fg">
                            {getDwellDisplay(dwell)}
                          </td>
                          <td className="p-3">
              <span className={`px-2 py-0.5 rounded-micro text-[11px] font-semibold ${getStateBadgeClass(state)}`}>
                              {state}
                            </span>
                          </td>
                          <td className="p-3">
                            {isEditingPlate ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={correctedPlateText}
                                  onChange={(e) => setCorrectedPlateText(e.target.value)}
                                  className="w-24 rounded-control border border-edge-strong bg-canvas px-2 py-0.5 text-xs text-fg focus:outline-none font-mono"
                                />
                                <button
                                  onClick={() => handleSavePlate(e.id)}
                                  className="rounded-control p-1 bg-emerald-600 hover:bg-emerald-500 text-fg"
                                >
                                  <Check className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={() => setEditingEventId(null)}
                                  className="rounded-control p-1 bg-content hover:bg-surface-hover text-fg-secondary"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded-micro text-[11px] font-semibold ${getPlateBadgeClass(plate.status)}`}>
                                  {plate.text ? plate.text : plate.status}
                                </span>
                                {plate.status !== "NONE" && (
                                  <button
                                    onClick={() => handleStartEditPlate(e.id, plate.text || "")}
                                    className="p-1 rounded-control text-fg-tertiary hover:text-fg hover:bg-surface-hover transition"
                                    title="Edit plate"
                                  >
                                    <Edit3 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {state === "CONFIRMED_ARRIVAL" && (
                                <>
                                  <button
                                    onClick={() => handleUpdateStatus(e.id, "ACKNOWLEDGED")}
                                    className="px-2.5 py-1.5 rounded-control border border-edge-default text-fg-secondary hover:border-edge-strong hover:text-fg font-medium text-[11px] transition"
                                  >
                                    Acknowledge
                                  </button>
                                  <button
                                    onClick={() => handleUpdateStatus(e.id, "FALSE_POSITIVE")}
                                    className="px-2.5 py-1.5 rounded-control border border-red-500/40 bg-red-500/5 hover:bg-red-500/10 text-red-400 font-medium text-[11px] transition"
                                    title="Mark false positive"
                                  >
                                    False Alarm
                                  </button>
                                </>
                              )}
                              {state === "ACKNOWLEDGED" && (
                                <button
                                  onClick={() => handleUpdateStatus(e.id, "LEFT")}
                                  className="px-2.5 py-1.5 rounded-control border border-edge-default bg-content hover:bg-surface-hover text-fg-secondary font-medium text-[11px] transition"
                                >
                                  Mark Departed
                                </button>
                              )}
                              {state === "LEFT" && (
                                <span className="text-fg-tertiary text-[11px] italic">Left scene</span>
                              )}
                              {state === "FALSE_POSITIVE" && (
                                <span className="text-red-500/60 text-[11px] italic">False alert</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </StandardPage>
  );
}
