"""The shop read-model mirror.

The point of these tests is the boundary: the mirror must fill nickstire's Lot section
WITHOUT ever being able to disturb the authoritative outbox to StateNour.
"""
from __future__ import annotations

import unittest

from visitd.shop_mirror import ShopMirror, iso_utc
from visitd.state_machine import Emission


def emission(**over) -> Emission:
    base = dict(
        visit_id="v1", state="CONFIRMED_ARRIVAL", seq=3, at=1_700_000_100.0, estimated=False,
        sighting_id="s1", camera="sign", zone="front_lot", priority="high", label="car",
        confidence=0.9, dwell_seconds=60.0, zone_dwell={"front_lot": 60.0}, stationary=True,
        plate={"status": "NONE", "text": None, "normalizedText": None, "confidence": 0.0, "reads": 0},
        direction="inbound", frigate_start_time=1_700_000_000.0, frigate_end_time=None,
    )
    base.update(over)
    return Emission(**base)


class Recorder:
    """Stands in for the HTTP transport."""

    def __init__(self, status=200, boom=None):
        self.status = status
        self.boom = boom
        self.calls = []

    def __call__(self, method, url, payload, headers, timeout):
        self.calls.append({"method": method, "url": url, "payload": payload, "headers": headers})
        if self.boom:
            raise self.boom
        return self.status, "ok"


class ShopMirrorTest(unittest.TestCase):
    def test_disabled_without_a_url_and_key_and_never_calls_out(self):
        rec = Recorder()
        self.assertFalse(ShopMirror(None, None, transport=rec).enabled)
        # A URL with no key would 401 on every single visit; that is not "configured".
        half = ShopMirror("https://nickstire.org/api/camera/visits", None, transport=rec)
        self.assertFalse(half.enabled)
        self.assertFalse(half.send(emission()))
        self.assertEqual(rec.calls, [], "a disabled mirror must not make a request")
        self.assertEqual(half.skipped, 1)

    def test_posts_the_visit_row_with_the_key_header(self):
        rec = Recorder()
        m = ShopMirror("https://nickstire.org/api/camera/visits", "k", transport=rec)
        self.assertTrue(m.send(emission()))
        self.assertEqual(len(rec.calls), 1)
        call = rec.calls[0]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["headers"]["x-sync-key"], "k")
        row = call["payload"]["visits"][0]
        self.assertEqual(row["visitId"], "v1")
        self.assertEqual(row["state"], "CONFIRMED_ARRIVAL")
        self.assertEqual(row["seq"], 3)
        self.assertEqual(row["arrivedAt"], iso_utc(1_700_000_000.0))
        self.assertFalse(row["preexisting"])

    def test_accumulates_across_emissions_so_a_replace_never_erases_history(self):
        """The ingest does a guarded FULL-COLUMN replace. Sending only what one emission
        knows would null out everything learned earlier, so the row is merged here."""
        rec = Recorder()
        m = ShopMirror("u", "k", transport=rec, bay_zones={"sign": frozenset({"bay_1"})})
        m.send(emission(state="ENTERED_ZONE", seq=1))
        m.send(emission(state="IN_SERVICE", seq=4, zone="bay_1", at=1_700_000_500.0))
        m.send(emission(state="LEFT", seq=9, zone=None, at=1_700_000_900.0,
                        frigate_end_time=1_700_000_880.0))

        rows = [c["payload"]["visits"][0] for c in rec.calls]
        self.assertEqual(rows[1]["bayEnteredAt"], iso_utc(1_700_000_500.0))
        self.assertEqual(rows[1]["arrivedAt"], iso_utc(1_700_000_000.0),
                         "the arrival learned at seq 1 must survive into seq 4")
        final = rows[2]
        self.assertEqual(final["arrivedAt"], iso_utc(1_700_000_000.0))
        self.assertEqual(final["bayEnteredAt"], iso_utc(1_700_000_500.0))
        self.assertEqual(final["departedAt"], iso_utc(1_700_000_880.0))
        self.assertEqual(final["bayExitedAt"], final["departedAt"],
                         "a car that leaves from the bay exited the bay")
        self.assertEqual(final["seq"], 9)

    def test_plate_text_only_travels_when_the_read_is_CONFIRMED(self):
        rec = Recorder()
        m = ShopMirror("u", "k", transport=rec)
        for status in ("CANDIDATE", "AMBIGUOUS", "UNREADABLE", "NONE"):
            m.forget("v1")
            m.send(emission(plate={"status": status, "text": "ABC1234", "normalizedText": "ABC1234"}))
            row = rec.calls[-1]["payload"]["visits"][0]
            self.assertEqual(row["plateStatus"], status)
            self.assertIsNone(row["plateText"], f"{status} must not carry text off the edge")

        m.forget("v1")
        m.send(emission(plate={"status": "CONFIRMED", "text": "ABC 1234", "normalizedText": "ABC1234"}))
        self.assertEqual(rec.calls[-1]["payload"]["visits"][0]["plateText"], "ABC1234")

    def test_a_transport_failure_is_swallowed_and_counted(self):
        """A shop outage must never reach the authoritative lane."""
        rec = Recorder(boom=OSError("connection refused"))
        m = ShopMirror("u", "k", transport=rec)
        self.assertFalse(m.send(emission()))   # no exception escapes
        self.assertEqual(m.failed, 1)
        self.assertEqual(m.sent, 0)

    def test_a_rejection_is_counted_not_raised(self):
        m = ShopMirror("u", "k", transport=Recorder(status=401))
        self.assertFalse(m.send(emission()))
        self.assertEqual(m.failed, 1)

    def test_a_terminal_visit_is_forgotten_so_memory_is_bounded(self):
        rec = Recorder()
        m = ShopMirror("u", "k", transport=rec)
        m.send(emission(state="CONFIRMED_ARRIVAL"))
        self.assertIn("v1", m._visits)
        m.send(emission(state="LEFT", seq=9))
        self.assertNotIn("v1", m._visits, "a departed visit must not be retained forever")

    def test_a_failed_send_keeps_the_visit_so_the_next_emission_still_carries_history(self):
        m = ShopMirror("u", "k", transport=Recorder(status=500))
        m.send(emission(state="LEFT", seq=9))
        self.assertIn("v1", m._visits, "dropping state on a failed send would lose the arrival")

    def test_estimated_transitions_are_recorded_as_such(self):
        rec = Recorder()
        m = ShopMirror("u", "k", transport=rec)
        m.send(emission(state="DEPARTING", seq=7, estimated=True))
        self.assertIn("DEPARTING", rec.calls[-1]["payload"]["visits"][0]["estimatedFields"])

    def test_row_for_is_usable_without_any_transport(self):
        """The mapper is pure with respect to the network, so it can be reasoned about
        and tested without pretending to have a server."""
        m = ShopMirror(None, None)
        row = m.row_for(emission())
        self.assertEqual(row["visitId"], "v1")
        self.assertEqual(row["customerMatch"], "NONE")
        self.assertIsNone(row["customerId"])


class PipelineIsolationTest(unittest.TestCase):
    """The structural claim, exercised against the REAL Pipeline: the shop mirror cannot
    disturb the authoritative outbox. This drives `after_step` rather than re-implementing
    its guard in the test, because a test that reimplements the code under test proves
    nothing about the code."""

    def _pipeline(self):
        from test_main import make_pipeline, raw, EVENTS
        return make_pipeline(), raw, EVENTS

    def test_the_mirror_is_ACTUALLY_INVOKED_for_every_emitted_row(self):
        """The positive control. Without this, wiring that never runs looks identical to
        wiring that works: the first version of this feature landed the send loop in
        __init__ instead of after_step, where it referenced an undefined name and was
        skipped because the mirror was disabled in tests. Every other test still passed."""
        p, raw_fn, events_topic = self._pipeline()
        calls = []

        class Probe:
            enabled = True
            sent = 0
            failed = 0

            def send(self, emission, _name=None):
                calls.append(emission.state)
                return True

        p.shop = Probe()
        p.process_message(events_topic, raw_fn("new", "o1", 1000.0, ["front_lot"]), 1000.0)
        p.process_message(events_topic, raw_fn("update", "o1", 1012.0, ["front_lot"]), 1012.0)
        self.assertEqual(calls, ["ENTERED_ZONE", "ARRIVAL_CANDIDATE"],
                         "the mirror must be fed every emission that produced an outbox row")

    def test_a_mirror_that_RAISES_leaves_the_outbox_intact(self):
        p, raw_fn, events_topic = self._pipeline()

        class Exploding:
            enabled = True
            sent = 0
            failed = 0

            def send(self, *_a, **_k):
                raise RuntimeError("shop endpoint melted")

        p.shop = Exploding()
        # A real arrival through the real pipeline, with the mirror blowing up every time.
        p.process_message(events_topic, raw_fn("new", "o1", 1000.0, ["front_lot"]), 1000.0)
        p.process_message(events_topic, raw_fn("update", "o1", 1012.0, ["front_lot"]), 1012.0)

        self.assertGreater(p.ledger.outbox_depth(), 0,
                           "the authoritative outbox must still have been written")
        self.assertGreater(len(p.tracker.open_visits()), 0, "the visit must still be tracked")

    def test_the_mirror_is_off_unless_configured(self):
        p, _raw, _topic = self._pipeline()
        self.assertFalse(p.shop.enabled,
                         "no shopUrl in the test config, so the mirror must be inert")
