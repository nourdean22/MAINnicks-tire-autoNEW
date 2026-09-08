"""Frigate 0.17 payload normalization, including missing optional fields."""
from __future__ import annotations

import json
import unittest

from helpers import fixture

from visitd.frigate_events import FrigateEvent, LprUpdate, parse_event, parse_message, parse_tracked_object_update


def _records(name):
    with open(fixture(name), "r", encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip() and not line.startswith("#")]


class ParseEventTest(unittest.TestCase):
    def test_fixture_new_update_end(self) -> None:
        recs = [r for r in _records("arrival_and_leave.jsonl") if r["topic"] == "frigate/events"]
        new = parse_event(recs[0]["payload"])
        self.assertEqual(new.type, "new")
        self.assertIsNone(new.before)
        self.assertEqual(new.after.id, "1757347331.12-abc123")
        self.assertEqual(new.after.camera, "lot")
        self.assertEqual(new.after.current_zones, ())
        self.assertEqual(new.after.box, (400, 300, 700, 520))
        self.assertEqual(new.after.area, 66000)
        self.assertIsNone(new.after.recognized_license_plate)
        update = parse_event(recs[1]["payload"])
        self.assertEqual(update.type, "update")
        self.assertIsNotNone(update.before)
        self.assertEqual(update.after.current_zones, ("front_lot",))
        self.assertEqual(update.time, update.after.frame_time)
        plated = parse_event(recs[4]["payload"])
        self.assertEqual(plated.after.recognized_license_plate, "ABC1234")
        self.assertEqual(plated.after.recognized_license_plate_score, 0.93)
        self.assertTrue(plated.after.stationary)
        self.assertEqual(plated.after.motionless_count, 190)
        end = parse_event(recs[-1]["payload"])
        self.assertEqual(end.type, "end")
        self.assertEqual(end.after.current_zones, ())
        self.assertEqual(end.after.entered_zones, ("front_lot",))
        self.assertEqual(end.time, end.after.end_time)

    def test_minimal_payload_gets_defaults(self) -> None:
        ev = parse_event({"type": "new", "after": {"id": "x", "camera": "lot", "frame_time": 5.0}})
        self.assertEqual(ev.after.label, "unknown")
        self.assertEqual(ev.after.score, 0.0)
        self.assertEqual(ev.after.start_time, 5.0)
        self.assertIsNone(ev.after.end_time)
        self.assertIsNone(ev.after.box)
        self.assertFalse(ev.after.stationary)
        self.assertEqual(ev.after.current_zones, ())
        self.assertIsNone(ev.after.sub_label)
        end = parse_event({"type": "end", "before": {}, "after": {"id": "x", "camera": "lot", "frame_time": 9.0}})
        self.assertEqual(end.time, 9.0)  # end_time missing -> frame_time

    def test_sub_label_list_form_and_bad_box(self) -> None:
        ev = parse_event({"type": "update", "after": {"id": "x", "camera": "lot", "sub_label": ["Shop Truck", 0.9], "box": [1, 2]}})
        self.assertEqual(ev.after.sub_label, "Shop Truck")
        self.assertIsNone(ev.after.box)

    def test_malformed_payloads_raise(self) -> None:
        with self.assertRaises(ValueError):
            parse_event({"type": "bogus", "after": {"id": "x", "camera": "lot"}})
        with self.assertRaises(ValueError):
            parse_event({"type": "new", "after": {"camera": "lot"}})
        with self.assertRaises(ValueError):
            parse_event({"type": "new", "after": {"id": "x"}})
        with self.assertRaises(ValueError):
            parse_event({"type": "new"})
        with self.assertRaises(ValueError):
            parse_event([])  # type: ignore[arg-type]


class TrackedObjectUpdateTest(unittest.TestCase):
    def test_lpr_update(self) -> None:
        rec = next(r for r in _records("arrival_and_leave.jsonl") if r["topic"] == "frigate/tracked_object_update")
        upd = parse_tracked_object_update(rec["payload"])
        self.assertIsInstance(upd, LprUpdate)
        self.assertEqual(upd.plate, "ABC1234")
        self.assertEqual(upd.score, 0.95)
        self.assertEqual(upd.camera, "lot")
        self.assertAlmostEqual(upd.timestamp, 1757347372.12, places=3)

    def test_non_lpr_returns_none_and_missing_plate_raises(self) -> None:
        self.assertIsNone(parse_tracked_object_update({"type": "face", "id": "x", "name": "bob"}))
        self.assertIsNone(parse_tracked_object_update({"type": "lpr", "id": "x", "plate": "A"}).camera)
        with self.assertRaises(ValueError):
            parse_tracked_object_update({"type": "lpr", "id": "x"})


class ParseMessageTest(unittest.TestCase):
    def test_routes_by_topic_and_accepts_bytes(self) -> None:
        raw = json.dumps({"type": "new", "after": {"id": "x", "camera": "lot", "frame_time": 1.0}}).encode("utf-8")
        self.assertIsInstance(parse_message("frigate/events", raw), FrigateEvent)
        self.assertIsInstance(parse_message("frigate/tracked_object_update", '{"type":"lpr","id":"x","plate":"AB1","score":0.5}'), LprUpdate)
        self.assertIsNone(parse_message("frigate/available", b"online"))
        self.assertIsNone(parse_message("frigate/lot/motion", b"ON"))
        self.assertIsNone(parse_message("nvr/events", raw, topic_prefix="frigate"))
        self.assertIsInstance(parse_message("nvr/events", raw, topic_prefix="nvr"), FrigateEvent)


if __name__ == "__main__":
    unittest.main()
