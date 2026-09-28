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
        self.assertIsNone(half.queue_row(emission()))
        self.assertEqual(rec.calls, [], "a disabled mirror must not make a request")
        self.assertEqual(half.skipped, 1)

    def test_delivers_the_queued_row_with_the_key_header(self):
        rec = Recorder()
        m = ShopMirror("https://nickstire.org/api/camera/visits", "k", transport=rec)
        queued = m.queue_row(emission())
        visit_id, seq, url, row = queued
        self.assertEqual((visit_id, seq), ("v1", 3))
        self.assertEqual(url, "https://nickstire.org/api/camera/visits")
        self.assertEqual(m.deliver({"visit_id": visit_id, "seq": seq, "url": url, "payload": row}), "sent")
        self.assertEqual(len(rec.calls), 1)
        call = rec.calls[0]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["headers"]["x-sync-key"], "k")
        self.assertEqual(call["payload"]["visits"][0], row)
        self.assertEqual(row["visitId"], "v1")
        self.assertEqual(row["state"], "CONFIRMED_ARRIVAL")
        self.assertEqual(row["seq"], 3)
        self.assertEqual(row["arrivedAt"], iso_utc(1_700_000_000.0))
        self.assertFalse(row["preexisting"])

    def test_priority_producer_header_is_sent_on_visits_and_heartbeats(self):
        rec = Recorder()
        m = ShopMirror(
            "https://nickstire.org/api/camera/visits", "k",
            transport=rec, producer_instance_id="p1-shop-abc",
        )
        queued = m.queue_row(emission())
        visit_id, seq, url, row = queued
        self.assertEqual(
            m.deliver({"visit_id": visit_id, "seq": seq, "url": url, "payload": row}),
            "sent",
        )
        m.heartbeat({"camera": "sign"})
        self.assertEqual(rec.calls[0]["headers"]["x-camera-producer"], "p1-shop-abc")
        self.assertEqual(rec.calls[1]["headers"]["x-camera-producer"], "p1-shop-abc")

    def test_standby_does_not_queue_business_rows_until_elected(self):
        m = ShopMirror(
            "https://nickstire.org/api/camera/visits", "k",
            transport=Recorder(), producer_instance_id="p2-nicksmax-abc",
        )
        self.assertFalse(m.authoritative)
        self.assertIsNone(m.queue_row(emission()))
        self.assertEqual(m.skipped, 1)

    def test_heartbeat_reply_can_promote_and_demote_a_standby(self):
        class AuthorityRecorder(Recorder):
            def __init__(self):
                super().__init__()
                self.reply = '{"authoritative": true}'

            def __call__(self, method, url, payload, headers, timeout):
                super().__call__(method, url, payload, headers, timeout)
                return 200, self.reply

        rec = AuthorityRecorder()
        m = ShopMirror(
            "https://nickstire.org/api/camera/visits", "k",
            transport=rec, producer_instance_id="p2-nicksmax-abc",
        )
        with self.assertLogs("visitd.shop", level="WARNING"):
            self.assertTrue(m.heartbeat({"camera": "sign"}))
        self.assertTrue(m.authoritative)
        self.assertIsNotNone(m.queue_row(emission()))

        rec.reply = '{"authoritative": false}'
        with self.assertLogs("visitd.shop", level="WARNING"):
            self.assertTrue(m.heartbeat({"camera": "sign"}))
        self.assertFalse(m.authoritative)
        self.assertIsNone(m.queue_row(emission(visit_id="v2")))

    def test_accumulates_across_emissions_so_a_replace_never_erases_history(self):
        """The ingest does a guarded FULL-COLUMN replace. Sending only what one emission
        knows would null out everything learned earlier, so the row is merged here."""
        rec = Recorder()
        m = ShopMirror("u", "k", transport=rec, bay_zones={"sign": frozenset({"bay_1"})})
        rows = [
            m.queue_row(emission(state="ENTERED_ZONE", seq=1))[3],
            m.queue_row(emission(state="IN_SERVICE", seq=4, zone="bay_1", at=1_700_000_500.0))[3],
            m.queue_row(emission(state="LEFT", seq=9, zone=None, at=1_700_000_900.0,
                                 frigate_end_time=1_700_000_880.0))[3],
        ]
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
            row = m.queue_row(emission(plate={"status": status, "text": "ABC1234", "normalizedText": "ABC1234"}))[3]
            self.assertEqual(row["plateStatus"], status)
            self.assertIsNone(row["plateText"], f"{status} must not carry text off the edge")

        m.forget("v1")
        row = m.queue_row(emission(plate={"status": "CONFIRMED", "text": "ABC 1234", "normalizedText": "ABC1234"}))[3]
        self.assertEqual(row["plateText"], "ABC1234")

    def test_unreachable_and_rejected_are_DIFFERENT_outcomes(self):
        """A WAN outage clears on its own; a 401 does not. Collapsing them would either
        wake somebody for every dropped packet or stay silent through a dead credential."""
        item = {"visit_id": "v1", "seq": 3, "url": "u", "payload": {"visitId": "v1"}}

        boom = ShopMirror("u", "k", transport=Recorder(boom=OSError("connection refused")))
        self.assertEqual(boom.deliver(item), "unreachable")   # no exception escapes
        self.assertEqual((boom.failed, boom.sent), (1, 0))

        rejected = ShopMirror("u", "k", transport=Recorder(status=401))
        self.assertEqual(rejected.deliver(item), "rejected")
        self.assertEqual(rejected.failed, 1)

    def test_a_terminal_visit_is_forgotten_so_memory_is_bounded(self):
        m = ShopMirror("u", "k", transport=Recorder())
        m.queue_row(emission(state="CONFIRMED_ARRIVAL"))
        self.assertIn("v1", m._visits)
        m.queue_row(emission(state="LEFT", seq=9))
        self.assertNotIn("v1", m._visits, "a departed visit must not be retained forever")

    def test_the_terminal_row_is_MATERIALISED_before_the_accumulator_is_freed(self):
        """Forgetting on queue rather than on delivery is only safe because the merged row
        is already in the returned tuple. If it were not, a shop outage would lose the
        arrival time of every departing car."""
        m = ShopMirror("u", "k", transport=Recorder())
        m.queue_row(emission(state="ENTERED_ZONE", seq=1))
        _, _, _, row = m.queue_row(emission(state="LEFT", seq=9, frigate_end_time=1_700_000_880.0))
        self.assertNotIn("v1", m._visits)
        self.assertEqual(row["arrivedAt"], iso_utc(1_700_000_000.0), "history survives into the queued row")
        self.assertEqual(row["departedAt"], iso_utc(1_700_000_880.0))

    def test_estimated_transitions_are_recorded_as_such(self):
        rec = Recorder()
        m = ShopMirror("u", "k", transport=rec)
        row = m.queue_row(emission(state="DEPARTING", seq=7, estimated=True))[3]
        self.assertIn("DEPARTING", row["estimatedFields"])

    def test_row_for_is_usable_without_any_transport(self):
        """The mapper is pure with respect to the network, so it can be reasoned about
        and tested without pretending to have a server."""
        m = ShopMirror(None, None)
        row = m.row_for(emission())
        self.assertEqual(row["visitId"], "v1")
        self.assertEqual(row["customerMatch"], "NONE")
        self.assertIsNone(row["customerId"])


class PipelineIsolationTest(unittest.TestCase):
    """The structural claims, exercised against the REAL Pipeline: the shop projection is
    DURABLE, and it still cannot disturb the authoritative outbox. This drives `after_step`
    rather than re-implementing its guard, because a test that reimplements the code under
    test proves nothing about the code."""

    def _pipeline(self, shop_transport=None):
        from test_main import make_pipeline, raw, EVENTS
        p = make_pipeline()
        p.shop.url = "https://nickstire.org/api/camera/visits"
        p.shop._key = "k"
        p.shop.transport = shop_transport or Recorder()
        return p, raw, EVENTS

    def test_every_emitted_row_lands_in_the_shop_outbox_in_the_SAME_commit(self):
        """The positive control. Without it, wiring that never runs looks identical to
        wiring that works: the first version of this feature landed the send loop in
        __init__ instead of after_step, where it referenced an undefined name and was
        skipped because the mirror was disabled in tests. Every other test still passed."""
        p, raw_fn, events_topic = self._pipeline()
        p.process_message(events_topic, raw_fn("new", "o1", 1000.0, ["front_lot"]), 1000.0)
        p.process_message(events_topic, raw_fn("update", "o1", 1012.0, ["front_lot"]), 1012.0)

        queued = p.ledger.shop_outbox_batch()
        self.assertEqual(len(queued), 1, "two emissions for ONE visit coalesce to one queued row")
        self.assertEqual(queued[0]["payload"]["state"], "ARRIVAL_CANDIDATE")
        self.assertEqual(p.ledger.shop_outbox_depth(), 1)

    def test_a_DEPARTURE_LOST_TO_AN_OUTAGE_IS_RETRIED_not_dropped(self):
        """THE bug this table exists for. A terminal emission is the LAST one a visit ever
        produces, so under the old inline send a shop outage at that moment meant nothing
        would ever retry it: the car physically leaves, the edge ledger knows, and the board
        shows it parked forever."""
        down = Recorder(boom=OSError("connection refused"))
        p, raw_fn, events_topic = self._pipeline(shop_transport=down)
        p.process_message(events_topic, raw_fn("new", "o1", 1000.0, ["front_lot"]), 1000.0)
        p.process_message(events_topic, raw_fn("end", "o1", 1100.0, ["front_lot"]), 1100.0)
        p.tick(1400.0)   # let the visit reach a terminal state

        self.assertGreaterEqual(p.ledger.shop_outbox_depth(), 1)
        self.assertEqual(p.drain_shop()["unreachable"], 1, "the shop is down; nothing is delivered")
        self.assertGreaterEqual(p.ledger.shop_outbox_depth(), 1, "and NOTHING is dropped")
        age = p.ledger.shop_outbox_oldest_age()
        self.assertIsNotNone(age, "the backlog has a measurable age, which is what surfaces in the admin")

        # The shop comes back. The queued row is delivered without any new emission.
        up = Recorder(status=200)
        p.shop.transport = up
        result = p.drain_shop()
        self.assertGreaterEqual(result["sent"], 1)
        self.assertEqual(p.ledger.shop_outbox_depth(), 0, "the backlog drains with no further events")
        self.assertTrue(up.calls, "the recovered transport actually carried the row")
        self.assertIsNone(p.ledger.shop_outbox_oldest_age())

    def test_a_queued_row_SURVIVES_A_RESTART(self):
        """Durability is a claim about the disk, not about the process. A row that only
        lived in the mirror's in-memory accumulator would be gone here."""
        import tempfile, os
        from visitd.ledger import Ledger
        from test_main import make_pipeline

        fd, path = tempfile.mkstemp(suffix=".sqlite")
        os.close(fd)
        try:
            p = make_pipeline(ledger=Ledger(path))
            p.shop.url, p.shop._key, p.shop.transport = "u", "k", Recorder()
            p.ledger.commit_step([], [], [("v-restart", 4, "u", {"visitId": "v-restart", "seq": 4})])

            fresh = Ledger(path)   # a brand-new process reading the same file
            rows = fresh.shop_outbox_batch()
            self.assertEqual([r["visit_id"] for r in rows], ["v-restart"])
            self.assertEqual(rows[0]["payload"]["seq"], 4)
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

    def test_a_mirror_that_RAISES_while_queueing_leaves_the_outbox_intact(self):
        p, raw_fn, events_topic = self._pipeline()

        def boom(*a, **k):
            raise RuntimeError("mirror is broken")

        p.shop.queue_row = boom
        with self.assertLogs("visitd", level="WARNING"):
            p.process_message(events_topic, raw_fn("new", "o1", 1000.0, ["front_lot"]), 1000.0)
        self.assertEqual(p.ledger.outbox_depth(), 1, "the AUTHORITATIVE outbox still got its row")
        self.assertEqual(p.ledger.shop_outbox_depth(), 0)

    def test_demoted_producer_does_not_drain_an_existing_shop_backlog(self):
        rec = Recorder(status=200)
        p, _raw_fn, _events_topic = self._pipeline(shop_transport=rec)
        p.ledger.commit_step([], [], [("v1", 1, "u", {"visitId": "v1", "seq": 1})])
        p.shop.authoritative = False

        self.assertEqual(p.drain_shop(), {"sent": 0, "rejected": 0, "unreachable": 0})
        self.assertEqual(rec.calls, [], "standby must not write business rows after demotion")
        self.assertEqual(p.ledger.shop_outbox_depth(), 1, "queued truth stays local until authority returns")

    def test_the_mirror_is_off_unless_configured(self):
        from test_main import make_pipeline, raw, EVENTS
        p = make_pipeline()          # no shop url/key
        self.assertFalse(p.shop.enabled)
        p.process_message(EVENTS, raw("new", "o1", 1000.0, ["front_lot"]), 1000.0)
        self.assertEqual(p.ledger.shop_outbox_depth(), 0, "an unconfigured shop queues nothing")
        self.assertEqual(p.drain_shop(), {"sent": 0, "rejected": 0, "unreachable": 0})


class ShopOutboxLedgerTest(unittest.TestCase):
    """The queue's own rules, at the ledger level."""

    def _ledger(self, **kw):
        from visitd.ledger import Ledger
        return Ledger(":memory:", **kw)

    def test_it_COALESCES_by_visit_so_an_outage_cannot_build_an_unbounded_backlog(self):
        led = self._ledger()
        for seq in range(1, 51):
            led.commit_step([], [], [("v1", seq, "u", {"visitId": "v1", "seq": seq})])
        rows = led.shop_outbox_batch()
        self.assertEqual(len(rows), 1, "50 emissions for one visit are ONE queued row")
        self.assertEqual(rows[0]["seq"], 50, "and it is the newest, which is the only one carrying information")

    def test_it_reports_the_CLASSIFICATION_of_every_queued_row(self):
        """What a restarting producer reads to avoid reclassifying an undelivered visit."""
        led = self._ledger()
        led.commit_step([], [], [("v1", 3, "u", {"visitId": "v1", "seq": 3,
                                                 "dataClass": "COMMISSIONING",
                                                 "commissioningRunId": "C-1"})])
        led.commit_step([], [], [("v2", 4, "u", {"visitId": "v2", "seq": 4,
                                                 "dataClass": "PRODUCTION",
                                                 "commissioningRunId": None})])
        self.assertEqual(led.shop_outbox_classifications(),
                         {"v1": ("COMMISSIONING", "C-1"), "v2": ("PRODUCTION", None)})

    def test_a_row_with_no_dataClass_is_omitted_rather_than_guessed(self):
        led = self._ledger()
        led.commit_step([], [], [("v1", 3, "u", {"visitId": "v1", "seq": 3})])
        self.assertEqual(led.shop_outbox_classifications(), {})

    def test_an_unparseable_payload_cannot_take_the_producer_down_at_startup(self):
        led = self._ledger()
        led.commit_step([], [], [("v1", 3, "u", {"visitId": "v1", "dataClass": "COMMISSIONING"})])
        with led._lock:
            led._conn.execute("UPDATE shop_outbox SET payload = ? WHERE visit_id = ?", ("{not json", "v1"))
        self.assertEqual(led.shop_outbox_classifications(), {}, "skipped, not raised")

    def test_an_older_seq_cannot_walk_a_queued_row_backwards(self):
        led = self._ledger()
        led.commit_step([], [], [("v1", 9, "u", {"visitId": "v1", "seq": 9, "state": "LEFT"})])
        led.commit_step([], [], [("v1", 4, "u", {"visitId": "v1", "seq": 4, "state": "IN_SERVICE"})])
        row = led.shop_outbox_batch()[0]
        self.assertEqual(row["seq"], 9)
        self.assertEqual(row["payload"]["state"], "LEFT", "a late older emission must not resurrect a departed car")

    def test_ack_is_GUARDED_by_seq_so_a_newer_row_is_never_silently_dropped(self):
        """A new emission can be queued while its predecessor is in flight. An unguarded
        delete on success would drop that newer row without ever sending it."""
        led = self._ledger()
        led.commit_step([], [], [("v1", 3, "u", {"visitId": "v1", "seq": 3})])
        led.commit_step([], [], [("v1", 5, "u", {"visitId": "v1", "seq": 5})])   # arrived mid-flight
        self.assertFalse(led.shop_outbox_ack("v1", 3), "the in-flight seq is stale; nothing is deleted")
        self.assertEqual(led.shop_outbox_depth(), 1)
        self.assertTrue(led.shop_outbox_ack("v1", 5))
        self.assertEqual(led.shop_outbox_depth(), 0)

    def test_the_queue_is_bounded_and_evicts_the_oldest(self):
        led = self._ledger(shop_outbox_max_depth=3)
        for i in range(6):
            led.commit_step([], [], [(f"v{i}", 1, "u", {"visitId": f"v{i}"})])
        ids = [r["visit_id"] for r in led.shop_outbox_batch()]
        self.assertEqual(len(ids), 3)
        self.assertNotIn("v0", ids, "the oldest goes first, so disk stays bounded")
        self.assertIn("v5", ids)

    def test_a_failed_commit_rolls_the_shop_row_back_with_everything_else(self):
        """One transaction means one outcome. A shop row that survived a rolled-back commit
        would describe a visit state the ledger never accepted."""
        led = self._ledger()

        class Boom:
            visit_id = "v-bad"

            def __getattr__(self, name):
                raise RuntimeError("visit is unserialisable")

        with self.assertRaises(Exception):
            led.commit_step([Boom()], [], [("v1", 1, "u", {"visitId": "v1"})])
        self.assertEqual(led.shop_outbox_depth(), 0, "the shop row rolled back with the commit")
        # ... and the ledger is still usable afterwards: a rollback is not a poisoned handle.
        led.commit_step([], [], [("v-ok", 1, "u", {"visitId": "v-ok"})])
        self.assertEqual(led.shop_outbox_depth(), 1)


class CommissioningHandshakeTest(unittest.TestCase):
    """The producer LEARNS about a run from the heartbeat reply (Codex P1 on #2255).

    `startCommissioning` only writes a database row. Without this the edge stayed in
    PRODUCTION: the controlled drive would enter the shop's real KPIs, its visits would
    carry no run id, and the report would find no machine events to compare against.
    """

    def _mirror(self, **kw):
        return ShopMirror("https://nickstire.org/api/camera/visits", "k", transport=Recorder(), **kw)

    def test_it_ADOPTS_the_run_the_shop_reports(self):
        m = self._mirror()
        self.assertEqual(m.data_class, "PRODUCTION")
        with self.assertLogs("visitd", level="WARNING"):
            m.apply_active_run('{"activeCommissioningRun": {"runId": "C-20260910-001"}}')
        self.assertEqual(m.commissioning_run_id, "C-20260910-001")
        self.assertEqual(m.data_class, "COMMISSIONING")
        # And rows written from now on carry it.
        row = m.row_for(emission())
        self.assertEqual(row["dataClass"], "COMMISSIONING")
        self.assertEqual(row["commissioningRunId"], "C-20260910-001")

    def test_an_EXPLICIT_null_ends_commissioning_mode(self):
        m = self._mirror(data_class="COMMISSIONING", commissioning_run_id="C-1")
        with self.assertLogs("visitd", level="WARNING"):
            m.apply_active_run('{"activeCommissioningRun": null}')
        self.assertIsNone(m.commissioning_run_id)
        self.assertEqual(m.data_class, "PRODUCTION")

    def test_a_reply_WITHOUT_the_field_leaves_the_mode_alone(self):
        """An older shop deployment that does not send the field must not silently
        reclassify a run that is already under way."""
        m = self._mirror(data_class="COMMISSIONING", commissioning_run_id="C-1")
        m.apply_active_run('{"accepted": true, "state": "HEALTHY"}')
        self.assertEqual(m.commissioning_run_id, "C-1")
        self.assertEqual(m.data_class, "COMMISSIONING")

    def test_GARBAGE_leaves_the_mode_alone_and_never_raises(self):
        m = self._mirror(data_class="COMMISSIONING", commissioning_run_id="C-1")
        for junk in ("not json at all", "", b"\x00\x01", None, 42, "[1,2,3]"):
            m.apply_active_run(junk)
        self.assertEqual(m.commissioning_run_id, "C-1")

    def test_re_reporting_the_SAME_run_is_a_no_op_and_does_not_log(self):
        """A 30-second heartbeat would otherwise announce the same run all day."""
        m = self._mirror(data_class="COMMISSIONING", commissioning_run_id="C-1")
        m.apply_active_run('{"activeCommissioningRun": {"runId": "C-1"}}')
        self.assertEqual(m.commissioning_run_id, "C-1")

    def test_a_SUCCESSFUL_heartbeat_applies_the_reply(self):
        """The positive control for the wiring: a 2xx must actually feed the body through."""
        class ReplyRecorder(Recorder):
            def __call__(self, method, url, payload, headers, timeout):
                super().__call__(method, url, payload, headers, timeout)
                return 200, '{"activeCommissioningRun": {"runId": "C-FROM-REPLY"}}'

        m = ShopMirror("https://nickstire.org/api/camera/visits", "k", transport=ReplyRecorder())
        with self.assertLogs("visitd", level="WARNING"):
            self.assertTrue(m.heartbeat({"camera": "sign"}))
        self.assertEqual(m.commissioning_run_id, "C-FROM-REPLY")


class RestartClassificationTest(unittest.TestCase):
    """A COMMISSIONING row still QUEUED must survive the restart that coalesces over it.

    Codex P1 on #2255, round 7. `dataClass` is chosen once, when `row_for` first builds a
    visit's accumulator, and the shop's ingest treats it as immutable after insert. But
    the accumulator is in MEMORY and the shop outbox coalesces by visitId -- one row per
    open visit, replaced wholesale. So a restart that comes up PRODUCTION (the scheduled
    launcher passes no run id) rebuilds the accumulator and overwrites the only
    undelivered COMMISSIONING payload there was. The server cannot defend a row that
    never reached it.
    """

    def _mirror(self, **kw):
        return ShopMirror("https://nickstire.org/api/camera/visits", "k", transport=Recorder(), **kw)

    def test_a_queued_COMMISSIONING_visit_is_not_reclassified_by_a_PRODUCTION_restart(self):
        fresh = self._mirror()                      # restarted: no run id, so PRODUCTION
        self.assertEqual(fresh.data_class, "PRODUCTION")
        with self.assertLogs("visitd", level="INFO"):
            self.assertEqual(
                fresh.restore_classifications({"v1": ("COMMISSIONING", "C-20260910-001")}), 1)

        row = fresh.row_for(emission(visit_id="v1", state="LEFT", seq=9))
        self.assertEqual(row["dataClass"], "COMMISSIONING",
                         "the test drive stays a test drive across the restart")
        self.assertEqual(row["commissioningRunId"], "C-20260910-001")

    def test_a_visit_with_no_queued_row_still_takes_the_CURRENT_mode(self):
        """The pin is not a global override -- a genuinely new car after the restart is
        production, which is the whole point of the producer having left commissioning."""
        fresh = self._mirror()
        fresh.restore_classifications({"v1": ("COMMISSIONING", "C-1")})
        row = fresh.row_for(emission(visit_id="v2"))
        self.assertEqual(row["dataClass"], "PRODUCTION")
        self.assertIsNone(row["commissioningRunId"])

    def test_the_pin_SURVIVES_the_terminal_emission_that_frees_the_accumulator(self):
        """`queue_row` forgets the accumulator on a terminal state so a shop outage cannot
        pin every departed visit in memory. The CLASSIFICATION must outlive that: the
        terminal row is still queued, and a later emission for the same visit would
        otherwise rebuild it under the current mode -- the same bug one step later."""
        fresh = self._mirror()
        fresh.restore_classifications({"v1": ("COMMISSIONING", "C-1")})
        fresh.queue_row(emission(visit_id="v1", state="LEFT", seq=9))   # frees the accumulator
        again = fresh.row_for(emission(visit_id="v1", state="LEFT", seq=10))
        self.assertEqual(again["dataClass"], "COMMISSIONING")

    def test_restoring_nothing_is_a_no_op_and_says_nothing(self):
        fresh = self._mirror()
        self.assertEqual(fresh.restore_classifications({}), 0)


class TransportMustNotTruncateTheHandshakeTest(unittest.TestCase):
    """The commissioning handshake travelled through a LOGGING truncation (P0, 2026-09-09).

    `requests_transport` returned `resp.text[:300]`, a cap meant for log lines, sitting at
    a DATA boundary. But the heartbeat reply is not diagnostic text -- it IS the handshake,
    and `apply_active_run` parses it as JSON to learn which run the operator started.

    MEASURED against production: the reply is 423 chars, so 123 were cut, the truncated
    JSON raised JSONDecodeError, and `apply_active_run` swallowed it by design (it has to
    survive a malformed reply from an older shop). The tail that was lost is exactly the
    payload the feature depends on. Pressing "Start a run" could never reach the producer.

    WHY NO EXISTING TEST CAUGHT IT: every test injects a fake transport that returns the
    whole body, so the truncation existed only on the real network path. These tests pin
    the CONTRACT instead -- a reply longer than any plausible cap must still be adopted.
    """

    def _mirror(self, transport):
        return ShopMirror("https://nickstire.org/api/camera/visits", "k", transport=transport)

    def test_a_LONG_reply_still_arms_the_run(self):
        # A realistic reply: the real one carries state, facets, reason and transition
        # before `activeCommissioningRun`, which is why the run id lands past 300 chars.
        import json as _json

        payload = {
            "accepted": True,
            "state": "CALIBRATION_INVALID",
            "facets": {"producer": "alive", "source": "connected", "frames": "fresh",
                       "pose": "ok", "calibration": "missing", "cloud": "ok"},
            "reason": "no calibration: census mode, arrivals are not authorised",
            "transition": {"from": "CALIBRATION_INVALID", "to": "CALIBRATION_INVALID",
                           "reason": "producer restarted (new instance id)"},
            "activeCommissioningRun": {"runId": "C-20260909-001", "label": None},
        }
        body = _json.dumps(payload)
        self.assertGreater(len(body), 300, "precondition: the run id sits past the old 300-char cap")

        m = self._mirror(lambda *a, **k: (200, body))
        with self.assertLogs("visitd", level="WARNING"):
            m.heartbeat({"camera": "sign"})
        self.assertEqual(m.commissioning_run_id, "C-20260909-001",
                         "a reply longer than the old cap must still arm the run")
        self.assertEqual(m.data_class, "COMMISSIONING")

    def test_a_TRUNCATED_reply_is_the_failure_this_pins(self):
        """The old behaviour, stated explicitly so the regression is unmistakable."""
        import json as _json

        payload = {
            "accepted": True, "state": "CALIBRATION_INVALID",
            "facets": {"producer": "alive", "source": "connected", "frames": "fresh",
                       "pose": "ok", "calibration": "missing", "cloud": "ok"},
            "reason": "no calibration: census mode, arrivals are not authorised",
            "transition": {"from": "CALIBRATION_INVALID", "to": "CALIBRATION_INVALID",
                           "reason": "producer restarted (new instance id)"},
            "activeCommissioningRun": {"runId": "C-20260909-001", "label": None},
        }
        cut = _json.dumps(payload)[:300]          # exactly what the transport used to hand back
        m = self._mirror(lambda *a, **k: (200, cut))
        m.heartbeat({"camera": "sign"})
        self.assertIsNone(m.commissioning_run_id,
                          "a truncated reply cannot arm anything -- this is the bug, pinned")
        self.assertEqual(m.data_class, "PRODUCTION")

    def test_the_real_transport_returns_the_WHOLE_body(self):
        """The fix at its source: no slice at the data boundary."""
        import inspect

        from visitd.cloud_client import requests_transport

        # CODE ONLY, not comments. The fix's own comment quotes the old `resp.text[:300]`
        # to record what went wrong, and a naive substring check flagged that explanation
        # as the defect -- a guard tripping on its own documentation.
        code = [ln.split("#", 1)[0] for ln in inspect.getsource(requests_transport).splitlines()]
        returns = [ln.strip() for ln in code if ln.strip().startswith("return ")]
        self.assertEqual(returns, ["return resp.status_code, resp.text"],
                         "the transport must hand back the WHOLE body; truncation belongs "
                         "where text is PRINTED, not where it is RETURNED")


class ReplayLaneTest(unittest.TestCase):
    """REPLAY is a first-class lane, and leaving commissioning must not promote it.

    Every shop counter filters on `dataClass = 'PRODUCTION'`, so a replay producer can post
    real rows against live data without touching the lot's truth -- which is how a challenger
    gets evaluated against reality. That only holds if the tag SURVIVES a commissioning run.
    """

    def _mirror(self, **kw):
        return ShopMirror("https://nickstire.org/api/camera/visits", "k",
                          transport=Recorder(), **kw)

    def test_leaving_commissioning_RESTORES_the_base_lane_not_a_literal(self):
        """Hardcoding PRODUCTION here promoted a REPLAY producer's rows into the live counters
        the moment a run ended -- and nothing would report it, because a PRODUCTION row is
        exactly what the counters expect to see."""
        m = self._mirror(data_class="REPLAY")
        self.assertEqual(m.base_data_class, "REPLAY")
        with self.assertLogs("visitd", level="WARNING"):
            m.apply_active_run('{"activeCommissioningRun": {"runId": "C-1"}}')
        self.assertEqual(m.data_class, "COMMISSIONING")
        with self.assertLogs("visitd", level="WARNING"):
            m.apply_active_run('{"activeCommissioningRun": null}')
        self.assertEqual(m.data_class, "REPLAY", "a replay lane must come out as replay")

    def test_a_PRODUCTION_producer_still_comes_back_as_PRODUCTION(self):
        """The positive control: the fix must not change the ordinary case."""
        m = self._mirror()
        with self.assertLogs("visitd", level="WARNING"):
            m.apply_active_run('{"activeCommissioningRun": {"runId": "C-2"}}')
        with self.assertLogs("visitd", level="WARNING"):
            m.apply_active_run('{"activeCommissioningRun": null}')
        self.assertEqual(m.data_class, "PRODUCTION")

    def test_COMMISSIONING_is_never_adopted_as_a_BASE(self):
        """A mirror constructed mid-run would otherwise latch COMMISSIONING as its base and
        never be able to leave it -- the exact shape of the `base_mode` defect next door."""
        m = self._mirror(data_class="COMMISSIONING")
        self.assertEqual(m.base_data_class, "PRODUCTION")


class EpisodeTrailReachesTheDurablePath(unittest.TestCase):
    """The trail must ride the MIRROR, not the lab sink.

    `vision/run_live.py`'s VisitSink is the standalone lane; `edge_main.py` never imports
    it. Stamping the episode trail only on the sink left every PRODUCTION visit without a
    trail while the tests stayed green, because the tests drive the sink. This asserts the
    path the shop actually receives. (Codex P1 on #2519.)
    """

    def test_the_mirror_row_carries_the_episode_trail_when_the_emission_has_one(self):
        rec = Recorder()
        m = ShopMirror("u", "k", transport=rec)
        # Real dataclass fields -- `Emission` is FROZEN, so the pipeline stamps them with
        # `dataclasses.replace`, and a test that used setattr would not compile either.
        em = emission(state="CONFIRMED_ARRIVAL", seq=2,
                      episode_id="sign-1758570000-4", member_track_ids=[11, 19, 27])
        row = m.queue_row(em)[3]
        self.assertEqual(row["episodeId"], "sign-1758570000-4")
        self.assertEqual(row["memberTrackIds"], [11, 19, 27])

    def test_an_emission_without_a_trail_reports_NULL_not_an_empty_trail(self):
        """A producer without the stitcher must send "not reported", never [] -- an empty
        list would read as "we looked and folded nothing", which is a different claim."""
        rec = Recorder()
        m = ShopMirror("u", "k", transport=rec)
        row = m.queue_row(emission(state="CONFIRMED_ARRIVAL", seq=2))[3]
        self.assertIsNone(row["episodeId"])
        self.assertIsNone(row["memberTrackIds"])

    def test_the_trail_SURVIVES_a_later_emission_that_does_not_carry_it(self):
        """Same accumulation rule the timings get: learned once, never un-learned."""
        rec = Recorder()
        m = ShopMirror("u", "k", transport=rec)
        first = emission(state="CONFIRMED_ARRIVAL", seq=2,
                         episode_id="sign-1758570000-4", member_track_ids=[11, 19])
        m.queue_row(first)
        later = m.queue_row(emission(state="LEFT", seq=7, zone=None))[3]
        self.assertEqual(later["episodeId"], "sign-1758570000-4",
                         "a later emission without the trail erased it")
        self.assertEqual(later["memberTrackIds"], [11, 19])
