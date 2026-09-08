"""Event contract v2 (plan 6.4): Emission -> JSON payload for POST /api/devices/{id}/events."""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Dict, Optional

from . import __version__
from .state_machine import Emission

SCHEMA_VERSION = 2
EVENT_NAME = "vehicle_detected"
SOURCE = "frigate"
PLATE_PROVIDER = "frigate_lpr"


def event_id(visit_id: str, state: str, seq: int) -> str:
    """Idempotency key: sha1 of visitId|state|seq."""
    return hashlib.sha1(f"{visit_id}|{state}|{seq}".encode("utf-8")).hexdigest()


def iso_utc(frame_time: float) -> str:
    """ISO-8601 UTC with millisecond precision, derived from a Frigate frame_time."""
    dt = datetime.fromtimestamp(frame_time, tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def zone_display_name(zone: Optional[str], zone_names: Dict[str, str]) -> Optional[str]:
    """Human name for a zone id, falling back to Title Case."""
    if zone is None:
        return None
    return zone_names.get(zone) or zone.replace("_", " ").title()


def build_event(
    emission: Emission,
    cloud_device_id: str,
    camera_name: str,
    zone_names: Dict[str, str],
    frigate_version: str,
) -> Dict[str, object]:
    """Render one Emission as a v2 contract payload."""
    plate = dict(emission.plate)
    plate["provider"] = PLATE_PROVIDER
    metadata: Dict[str, object] = {
        "direction": emission.direction,
        "frigateStartTime": emission.frigate_start_time,
        "frigateEndTime": emission.frigate_end_time,
        "snapshotRef": f"events/{emission.sighting_id}/snapshot.jpg",
        "bridgeVersion": __version__,
        "frigateVersion": frigate_version,
    }
    if emission.merged_into:
        metadata["mergedIntoVisitId"] = emission.merged_into
    return {
        "schemaVersion": SCHEMA_VERSION,
        "event": EVENT_NAME,
        "eventId": event_id(emission.visit_id, emission.state, emission.seq),
        "source": SOURCE,
        "timestamp": iso_utc(emission.at),
        "data": {
            "cameraId": cloud_device_id,
            "cameraName": camera_name,
            "visitId": emission.visit_id,
            "sightingId": emission.sighting_id,
            "trackId": emission.sighting_id,
            "zone": emission.zone,
            "zoneName": zone_display_name(emission.zone, zone_names),
            "state": emission.state,
            "priority": emission.priority,
            "label": emission.label,
            "confidence": emission.confidence,
            "dwellSeconds": emission.dwell_seconds,
            "zoneDwell": dict(emission.zone_dwell),
            "stationary": emission.stationary,
            "estimated": emission.estimated,
            "plate": plate,
            "metadata": metadata,
        },
    }
