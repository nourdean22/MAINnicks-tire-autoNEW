"""Every column the shop STORES must have a producer, or it is a card that renders blank.

The shop's `camera_runtime` table has 30 heartbeat columns. Five of them had no producer:
`gitSha`, `lastFrameAt`, `lastCloudAckAt`, `diskFreeBytes` and `state`. Four were rendered on
the camera detail card and could only ever be empty; the fifth is derived server-side and is
correctly absent. `CouncilResult.latency_ms` was being measured on every frame and discarded
while `inferenceP95Ms` sat blank on the screen next to it.

A READER WITH NO WRITER is the mirror of the orphan writer this repo already hunts, and it is
harder to see: an unused export shows up in a lint, whereas a column nobody fills shows up as
a slightly emptier screen that everyone gets used to. `lot.ts:257` carries a comment from
someone who hit it -- they wanted `lastFrameAt`, grepped camera-bridge, found zero producers,
and rerouted a health gate rather than fill the column.

So this file is the gate. It reads the route's own `HEARTBEAT_COLUMNS` list and the keys the
producer's real heartbeat body carries, and fails on any column with no producer.
"""
from __future__ import annotations

import os
import re
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import edge_main                                                       # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROUTE = os.path.join(REPO, "..", "apps", "nickstire", "server", "routes",
                     "cameraVisitsRoutes.ts")

# Columns the producer is NOT expected to send, each with the reason. An entry here is a
# decision, and `test_no_exemption_has_gone_STALE` keeps it from becoming a place to hide a
# field somebody could not be bothered to wire.
NOT_SENT_BY_DESIGN = {
    "state": "derived server-side by deriveStateAtIngest from the facets the producer DOES "
             "send. A producer asserting its own health verdict would let a broken one "
             "declare itself fine.",
}


def route_heartbeat_columns():
    """The column list the shop writes a heartbeat into, read from the route itself."""
    with open(ROUTE, encoding="utf-8") as fh:
        src = fh.read()
    m = re.search(r"HEARTBEAT_COLUMNS\s*=\s*\[(.*?)\]", src, re.S)
    if not m:
        raise AssertionError(
            "HEARTBEAT_COLUMNS is gone from cameraVisitsRoutes.ts. This gate is reading "
            "nothing and would pass no matter what the producer sends -- fix the parse, do "
            "not delete the test.")
    return [c for c in re.findall(r'"([A-Za-z0-9_]+)"', m.group(1))]


def producer_heartbeat_keys():
    """Keys a REAL heartbeat body carries, built the way the producer builds it.

    Deliberately not a hand-written list: a fixture would drift from the function exactly the
    way `_args()` drifted from the parser, and this gate would then be comparing the route
    against a copy of itself.
    """
    ledger = SimpleNamespace(path=os.path.join(REPO, "data", "edge-sign.sqlite"),
                             shop_outbox_depth=lambda: 0, dead_letter_depth=lambda: 0,
                             shop_outbox_oldest_age=lambda now: None)
    vision = SimpleNamespace(tracker=SimpleNamespace(open_visits=lambda: []))
    body = edge_main.edge_heartbeat_body(
        camera="sign", seq=1, now=1000.0, mode="PRODUCTION",
        source=SimpleNamespace(), vision=vision, ledger=ledger,
        health_state=None, scene_state=None, calibration_version=None,
        detector_name="fake", model_sha256=None, last_healthy_frame_at=None,
        last_inference_at=1000.0, inference_p95_ms=12.0,
        last_frame_at=1000.0, last_cloud_ack_at=1000.0)
    return body


class HeartbeatContractTest(unittest.TestCase):

    def setUp(self):
        if not os.path.exists(ROUTE):
            self.skipTest("nickstire is not checked out beside camera-bridge")
        self.columns = route_heartbeat_columns()
        self.body = producer_heartbeat_keys()

    def test_EVERY_stored_column_has_a_producer(self):
        orphans = sorted(c for c in self.columns
                         if c not in self.body and c not in NOT_SENT_BY_DESIGN)
        self.assertEqual(
            orphans, [],
            f"the shop stores {orphans} and no producer sends them, so those cards can only "
            f"ever render blank. Send them from `edge_heartbeat_body`, or add each to "
            f"NOT_SENT_BY_DESIGN with the reason it has no producer.")

    def test_no_exemption_has_gone_STALE(self):
        """Two ways an exemption rots: the column is gone, or someone wired it anyway. Both
        leave a reason on file that is no longer true, and a list of untrue reasons is worse
        than no list."""
        gone = sorted(c for c in NOT_SENT_BY_DESIGN if c not in self.columns)
        self.assertEqual(gone, [], f"{gone} are exempted but are not stored columns any more")
        wired = sorted(c for c in NOT_SENT_BY_DESIGN if c in self.body)
        self.assertEqual(
            wired, [],
            f"{wired} are listed as having no producer, but the heartbeat sends them. "
            f"Delete the exemption; the reason recorded against it is now false.")

    def test_the_producer_INVENTS_no_field_the_shop_will_drop(self):
        """The other direction. A key the route does not store is parsed and discarded, so
        the producer pays to compute and send something nobody will ever read -- and it
        looks, from the producer side, exactly like a field that works."""
        ignored = sorted(k for k in self.body if k not in self.columns)
        self.assertEqual(
            ignored, [],
            f"the heartbeat sends {ignored}, which the shop does not store. Either add the "
            f"column or stop sending it -- it is silently dropped on arrival today.")

    def test_the_gate_can_actually_SEE_the_columns(self):
        """The positive control. A parse that returned [] would make every assertion above
        pass vacuously, forever, and this whole file would be decoration."""
        self.assertGreater(len(self.columns), 20,
                           f"only parsed {len(self.columns)} columns out of the route")
        for expected in ("camera", "heartbeatSeq", "mode", "outboxDepth"):
            self.assertIn(expected, self.columns)


class HeartbeatValueTest(unittest.TestCase):
    """The fields newly filled, and the shape of their absences."""

    def setUp(self):
        if not os.path.exists(ROUTE):
            self.skipTest("nickstire is not checked out beside camera-bridge")

    def test_disk_free_is_a_real_number_not_a_confident_zero(self):
        body = producer_heartbeat_keys()
        self.assertIsNotNone(body["diskFreeBytes"])
        self.assertGreater(body["diskFreeBytes"], 0)

    def test_disk_free_is_NONE_when_it_cannot_be_read_never_zero(self):
        """A zero says "the disk is full", the most alarming value this field can take.
        Reporting it because a stat call failed pages someone to a disk that is fine."""
        self.assertIsNone(edge_main._disk_free_bytes(SimpleNamespace(path="\\\\?\\nope\\x")))
        self.assertIsNone(edge_main._disk_free_bytes(None))

    def test_the_git_sha_is_a_sha_or_NOTHING_never_a_placeholder(self):
        """A producer confidently reporting a SHA it invented is worse than one reporting
        nothing: the string is rendered, and "unknown" in a version field gets read as a
        version."""
        sha = edge_main._git_sha()
        if sha is not None:
            self.assertRegex(sha, r"^[0-9a-f]{7,40}$", f"not a git sha: {sha!r}")

    def test_the_git_sha_is_resolved_ONCE(self):
        """It cannot change while the process runs, and the heartbeat fires every 30
        seconds. Shelling out to git on each one is a subprocess per heartbeat, forever."""
        edge_main._GIT_SHA_CACHE.clear()
        first = edge_main._git_sha()
        cached = dict(edge_main._GIT_SHA_CACHE)
        self.assertIn("sha", cached, "nothing was cached, so every heartbeat will shell out")
        self.assertEqual(edge_main._git_sha(), first)

    def test_an_env_baked_sha_wins_so_a_box_without_git_can_still_report_one(self):
        edge_main._GIT_SHA_CACHE.clear()
        os.environ["EDGE_GIT_SHA"] = "abc1234def5678"
        try:
            self.assertEqual(edge_main._git_sha(), "abc1234def5678")
        finally:
            del os.environ["EDGE_GIT_SHA"]
            edge_main._GIT_SHA_CACHE.clear()

    def test_the_model_digest_covers_WEIGHTS_as_well_as_topology(self):
        """An OpenVINO model is an `.xml` topology beside a `.bin` of weights, and a change
        to either changes what the detector does. A digest of the xml alone would report a
        MATCH across two different sets of weights -- the one thing a provenance field must
        never do, and the failure is invisible because the value still looks like a hash."""
        import hashlib
        import tempfile

        d = tempfile.mkdtemp()
        xml = os.path.join(d, "m.xml")
        with open(xml, "wb") as fh:
            fh.write(b"<net/>")
        with open(os.path.join(d, "m.bin"), "wb") as fh:
            fh.write(b"WEIGHTS-A")
        first = edge_main._model_sha256(xml)
        with open(os.path.join(d, "m.bin"), "wb") as fh:
            fh.write(b"WEIGHTS-B")          # same topology, different weights
        second = edge_main._model_sha256(xml)
        self.assertIsNotNone(first)
        self.assertNotEqual(first, second,
                            "swapping the weights did not change the digest, so it is "
                            "hashing the topology only")
        xml_only = "ov:" + hashlib.sha256(b"<net/>").hexdigest()[:56]
        self.assertNotEqual(first, xml_only)

    def test_the_model_digest_is_SELF_DESCRIBING(self):
        """Bare hex invites someone to compare it against a single-file digest from
        elsewhere and conclude two identical models differ."""
        import tempfile

        d = tempfile.mkdtemp()
        xml = os.path.join(d, "m.xml")
        with open(xml, "wb") as fh:
            fh.write(b"<net/>")
        self.assertTrue(edge_main._model_sha256(xml).startswith("ov:"))

    def test_a_missing_model_file_is_NONE_not_the_digest_of_nothing(self):
        """`hashlib.sha256()` of no input is a perfectly valid-looking 64-char hash, and it
        is the SAME one for every producer that cannot find its model -- so a fleet of
        broken boxes would agree with each other and look consistent."""
        self.assertIsNone(edge_main._model_sha256("no/such/model.xml"))
        self.assertIsNone(edge_main._model_sha256(None))

    def test_the_digest_FITS_the_column(self):
        """`modelSha256` is VARCHAR(64) and TiDB runs STRICT_TRANS_TABLES: an over-width
        write is REJECTED and the row is lost, which for a heartbeat means the producer
        silently stops appearing healthy at all."""
        import tempfile

        d = tempfile.mkdtemp()
        xml = os.path.join(d, "m.xml")
        with open(xml, "wb") as fh:
            fh.write(b"<net/>")
        self.assertLessEqual(len(edge_main._model_sha256(xml)), 64)

    def test_absent_timestamps_render_as_NULL_not_as_the_epoch(self):
        """`_iso(0)` is 1970, which the shop would store as a real timestamp and the admin
        would render as a camera last seen 56 years ago."""
        ledger = SimpleNamespace(path=":memory:", shop_outbox_depth=lambda: 0,
                                 dead_letter_depth=lambda: 0,
                                 shop_outbox_oldest_age=lambda now: None)
        body = edge_main.edge_heartbeat_body(
            camera="sign", seq=1, now=1000.0, mode="PRODUCTION",
            source=SimpleNamespace(),
            vision=SimpleNamespace(tracker=SimpleNamespace(open_visits=lambda: [])),
            ledger=ledger, health_state=None, scene_state=None, calibration_version=None,
            detector_name="fake", model_sha256=None, last_healthy_frame_at=None)
        for field in ("lastFrameAt", "lastCloudAckAt", "lastInferenceAt"):
            self.assertIsNone(body[field], f"{field} rendered a value from nothing")


if __name__ == "__main__":
    unittest.main()
