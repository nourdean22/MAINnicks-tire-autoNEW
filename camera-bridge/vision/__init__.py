"""
Nick's Tire vision operating layer (2026-09-09).

A hot-swappable, offline-testable pipeline that turns cheap V380 pixels into
TRUSTWORTHY shop events, sitting immediately upstream of the shipped `visitd`
state machine. Nothing here rebuilds visitd; it produces honest evidence for it.

The defect this exists to kill: a car ALREADY PARKED when the detector starts was
promoted to CONFIRMED_ARRIVAL because "present in the lot for 45s" was equated with
"arrived". visitd is a pure function of its event stream, so it cannot defend itself
-- preexisting-object and camera-motion gating MUST happen here, at the edge.

Component status (full table in README.md):
  IMPLEMENTED + unit-tested offline: Frame/Detection, CaptureMux + ReplaySource +
    SyntheticSource + V380WindowSource, FrameHealth, SceneLock, PreexistingCensus,
    DetectorCouncil, TrackGraph (ByteTrack-lite), EntryPortal, BayLatch,
    EvidencePacket, PrivacyToken, VehicleFingerprint, PlateLab (quality + consensus),
    VisionPipeline (-> visitd), ReplayLab + FailureInjector.
  MODEL-DEPENDENT (wired; runs when the runtime + weights are present, degrades
    gracefully otherwise): OpenVinoVehicleDetector, PlateLab OCR backend,
    VehicleFingerprint ReID embedding.

Truth boundary: implementation and accelerated replay can be finished in a day.
Statistical proof of rare failures cannot. Report feature-complete,
simulation-proven, controlled-field-proven and long-horizon-unproven separately.
"""

__all__ = [
    "frame", "capture", "framehealth", "scenelock", "census", "detector",
    "track", "geometry", "baylatch", "fingerprint", "platelab", "evidence",
    "pipeline", "replaylab",
]
