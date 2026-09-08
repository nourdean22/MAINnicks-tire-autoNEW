"""Event contract v2: idempotent eventId, shape, timestamp derivation."""
from __future__ import annotations

import unittest
from datetime import datetime, timezone

from helpers import T0, ev, tracker

from visitd import __version__
from visitd.contract import build_event, event_id, iso_utc
from visitd.state_machine import Emission

TOP_KEYS = {"schemaVersion", "event", "eventId", "source", "timestamp", "data"}
DATA_KEYS = {
    "cameraId", "cameraName", "visitId", "sightingId", "trackId", "zone", "zoneName", "state", "priority", "label",
    "confidence", "dwellSeconds", "zoneDwell", "stationary", "estimated", "plate", "metadata",
}
PLATE_KEYS = {"status", "text", "normalizedText", "confidence", "provider", "reads"}
META_KEYS = {"direction", "frigateStartTime", "frigateEndTime", "snapshotRef", "bridgeVersion", "frigateVersion"}


def _emission(**overrides) -> Emission:
    base = dict(
        visit_id="9f3e", state="CONFIRMED_ARRIVAL", seq=3, at=T0 + 47.2, estimated=False, sighting_id="1757347331.12-abc123",
        camera="sign", zone="bay_entrance", priority="high", label="car", confidence=0.87, dwell_seconds=47.2,
        zone_dwell={"bay_entrance": 47.2}, stationary=True,
        plate={"status": "CONFIRMED", "text": "ABC 1234", "normalizedText": "ABC1234", "confidence": 0.93, "reads": 3},
        direction="entering", frigate_start_time=T0, frigate_end_time=None,
    )
    base.update(overrides)
    return Emission(**base)  # type: ignore[arg-type]


class EventIdTest(unittest.TestCase):
    def test_same_inputs_same_id_and_differs_across_state_or_seq(self) -> None:
        a = event_id("9f3e", "CONFIRMED_ARRIVAL", 3)
        self.assertEqual(a, event_id("9f3e", "CONFIRMED_ARRIVAL", 3))
        self.assertEqual(len(a), 40)
        self.assertNotEqual(a, event_id("9f3e", "CONFIRMED_ARRIVAL", 4))
        self.assertNotEqual(a, event_id("9f3e", "LEFT", 3))
        self.assertNotEqual(a, event_id("other", "CONFIRMED_ARRIVAL", 3))

    def test_build_event_is_deterministic(self) -> None:
        one = build_event(_emission(), "v380-shopsign", "Shop Sign", {}, "0.17.2")
        two = build_event(_emission(), "v380-shopsign", "Shop Sign", {}, "0.17.2")
        self.assertEqual(one, two)


class ShapeTest(unittest.TestCase):
    def test_keys_and_values(self) -> None:
        payload = build_event(_emission(), "v380-shopsign", "Shop Sign", {"bay_entrance": "Bay Entrance"}, "0.17.2")
        self.assertEqual(set(payload), TOP_KEYS)
        self.assertEqual(payload["schemaVersion"], 2)
        self.assertEqual(payload["event"], "vehicle_detected")
        self.assertEqual(payload["source"], "frigate")
        data = payload["data"]
        self.assertEqual(set(data), DATA_KEYS)
        self.assertEqual(data["cameraId"], "v380-shopsign")
        self.assertEqual(data["cameraName"], "Shop Sign")
        self.assertEqual(data["trackId"], data["sightingId"])
        self.assertEqual(data["zoneName"], "Bay Entrance")
        self.assertEqual(data["priority"], "high")
        self.assertEqual(set(data["plate"]), PLATE_KEYS)
        self.assertEqual(data["plate"]["provider"], "frigate_lpr")
        self.assertEqual(set(data["metadata"]), META_KEYS)
        self.assertEqual(data["metadata"]["snapshotRef"], "events/1757347331.12-abc123/snapshot.jpg")
        self.assertEqual(data["metadata"]["bridgeVersion"], __version__)
        self.assertEqual(data["metadata"]["frigateVersion"], "0.17.2")
        self.assertEqual(data["metadata"]["direction"], "entering")

    def test_zone_name_falls_back_to_title_case_and_merge_marker_is_optional(self) -> None:
        payload = build_event(_emission(zone="front_lot"), "d", "n", {}, "0.17.2")
        self.assertEqual(payload["data"]["zoneName"], "Front Lot")
        self.assertNotIn("mergedIntoVisitId", payload["data"]["metadata"])
        merged = build_event(_emission(state="LEFT", direction="leaving", merged_into="abc"), "d", "n", {}, "0.17.2")
        self.assertEqual(merged["data"]["metadata"]["mergedIntoVisitId"], "abc")
        self.assertEqual(merged["data"]["metadata"]["direction"], "leaving")

    def test_known_name_passes_through(self) -> None:
        plate = {"status": "CONFIRMED", "text": "ABC1234", "normalizedText": "ABC1234", "confidence": 1.0, "reads": 1, "knownName": "Shop Truck"}
        payload = build_event(_emission(plate=plate), "d", "n", {}, "0.17.2")
        self.assertEqual(payload["data"]["plate"]["knownName"], "Shop Truck")


class TimestampTest(unittest.TestCase):
    def test_iso_utc_from_frame_time(self) -> None:
        # 1757347331.12 (the plan's example frame_time) is 2025-09-08T16:02:11.120Z; the plan's prose year is off by one
        self.assertEqual(iso_utc(T0), "2025-09-08T16:02:11.120Z")
        self.assertEqual(iso_utc(0.0), "1970-01-01T00:00:00.000Z")

    def test_timestamp_is_derived_from_emission_frame_time_not_wall_clock(self) -> None:
        payload = build_event(_emission(at=T0 + 47.2), "d", "n", {}, "0.17.2")
        parsed = datetime.strptime(payload["timestamp"], "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
        self.assertAlmostEqual(parsed.timestamp(), T0 + 47.2, places=3)

    def test_end_to_end_from_tracker(self) -> None:
        t = tracker()
        t.handle_event(ev("new", "a", T0))
        emitted = t.handle_event(ev("update", "a", T0 + 1.0, ["front_lot"]))
        payload = build_event(emitted[0], "v380-shopinside", "Front Lot", {}, "0.17.2")
        self.assertEqual(payload["timestamp"], iso_utc(T0 + 1.0))
        self.assertEqual(payload["data"]["state"], "ENTERED_ZONE")
        self.assertEqual(payload["data"]["visitId"], "V1")
        self.assertEqual(payload["eventId"], event_id("V1", "ENTERED_ZONE", 1))


if __name__ == "__main__":
    unittest.main()
