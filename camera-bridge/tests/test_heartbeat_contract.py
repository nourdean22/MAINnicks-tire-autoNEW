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

import importlib.util
import os
import re
import sys
from datetime import datetime, timezone
import tempfile
import types
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import edge_main                                                       # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROUTE = os.path.join(REPO, "..", "apps", "nickstire", "server", "routes",
                     "cameraVisitsRoutes.ts")
EUFY_AGENT = os.path.join(REPO, "..", "apps", "statenour", "local-agent", "eufy_agent.py")

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
    # A TEMP directory that certainly exists. Pointing this at `data/` made the fixture
    # depend on a gitignored directory: `_disk_free_bytes` correctly returns None for a path
    # that is not there, so the disk-free test passed on the box holding the corpus and
    # failed in CI -- and it was the TEST that was wrong, not the function.
    ledger = SimpleNamespace(path=os.path.join(tempfile.mkdtemp(), "edge-sign.sqlite"),
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


def load_eufy_agent_module():
    """Load the REAL StateNour producer in Camera Bridge's intentionally minimal CI.

    The contract needs to EXECUTE build_office_camera_heartbeat, not merely grep its source,
    but Camera Bridge CI deliberately does not install StateNour's smart-home/network
    dependencies. Stub only the two import-time modules the pure builder never touches;
    restore sys.modules immediately after import so this test cannot mask dependency use in
    any other test or production path.
    """
    if not os.path.exists(EUFY_AGENT):
        return None
    local_agent_dir = os.path.dirname(EUFY_AGENT)
    if local_agent_dir not in sys.path:
        sys.path.insert(0, local_agent_dir)
    spec = importlib.util.spec_from_file_location("heartbeat_contract_eufy_agent", EUFY_AGENT)
    if spec is None or spec.loader is None:
        raise AssertionError("could not load StateNour Eufy producer module")

    previous = {name: sys.modules.get(name) for name in ("requests", "dotenv")}
    requests_stub = types.ModuleType("requests")
    dotenv_stub = types.ModuleType("dotenv")
    dotenv_stub.load_dotenv = lambda *_args, **_kwargs: None
    sys.modules["requests"] = requests_stub
    sys.modules["dotenv"] = dotenv_stub
    try:
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    finally:
        for name, prior in previous.items():
            if prior is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = prior
    return module


def interaction_heartbeat_keys(module=None):
    """Keys emitted by the REAL build_office_camera_heartbeat function."""
    module = module or load_eufy_agent_module()
    if module is None:
        return set()
    runtime = {
        "eventPlaneOk": True,
        "controlPlaneOk": False,
        "mediaPlaneOk": True,
        "ptzHomeOk": False,
        "lastEventProofAt": "2026-09-27T10:00:01+00:00",
        "lastControlProofAt": "2026-09-27T10:00:02+00:00",
        "lastMediaProofAt": "2026-09-27T10:00:03+00:00",
        "lastPtzNotifyAt": "2026-09-27T10:00:04+00:00",
        "conversationWorkerOk": True,
        "conversationWorkerState": "OFF_HOURS",
        "conversationWorkerHeartbeatAt": "2026-09-27T10:00:05+00:00",
        "conversationAudioSource": "eufy-office",
        "conversationCaptureHost": "NICKSMAX",
        "conversationSttEngine": "whisper-cli.exe",
        "conversationQueueDepth": 0,
        "conversationLastTrigger": "personDetected",
        "lastConversationEventAt": "2026-09-27T09:59:59+00:00",
        "lastConversationCaptureAt": "2026-09-27T09:58:00+00:00",
        "lastConversationSttAt": "2026-09-27T09:58:20+00:00",
        "lastConversationPostAt": "2026-09-27T09:58:21+00:00",
        "lastConversationSummaryAt": "2026-09-27T09:58:21+00:00",
        "lastConversationCoverage": 0.91,
        "conversationFailuresToday": 0,
        "conversationLastError": "fixture-only prior error",
        # 0143 listening windows. Present here so the contract proves the builder FORWARDS
        # them and the shop STORES them -- a key missing from either side fails above.
        "conversationListeningCoverage60m": 0.42,
        "conversationCaptureSecondsLast60m": 1512,
        "conversationCapturesLast60m": 13,
        "conversationCaptureFailuresLast60m": 1,
        "conversationWakeTriggersLast60m": 19,
        "conversationTranscribeBacklog": 2,
    }
    payload = module.build_office_camera_heartbeat(
        auth_ok=True,
        runtime_health=runtime,
        seq=1,
        observed_at=datetime(2026, 9, 27, 10, 0, tzinfo=timezone.utc),
    )
    return set(payload)


class HeartbeatContractTest(unittest.TestCase):

    def setUp(self):
        if not os.path.exists(ROUTE):
            self.skipTest("nickstire is not checked out beside camera-bridge")
        self.columns = route_heartbeat_columns()
        self.body = producer_heartbeat_keys()
        self.interaction = interaction_heartbeat_keys()

    def test_EVERY_stored_column_has_a_producer(self):
        authored = set(self.body) | set(self.interaction)
        orphans = sorted(c for c in self.columns
                         if c not in authored and c not in NOT_SENT_BY_DESIGN)
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
        wired = sorted(
            c for c in NOT_SENT_BY_DESIGN
            if c in self.body or c in self.interaction
        )
        self.assertEqual(
            wired, [],
            f"{wired} are listed as having no producer, but the heartbeat sends them. "
            f"Delete the exemption; the reason recorded against it is now false.")

    def test_the_producer_INVENTS_no_field_the_shop_will_drop(self):
        """The other direction. A key the route does not store is parsed and discarded, so
        the producer pays to compute and send something nobody will ever read -- and it
        looks, from the producer side, exactly like a field that works."""
        ignored = sorted(
            k for k in (set(self.body) | set(self.interaction))
            if k not in self.columns
        )
        self.assertEqual(
            ignored, [],
            f"the heartbeat sends {ignored}, which the shop does not store. Either add the "
            f"column or stop sending it -- it is silently dropped on arrival today.")

    def test_interaction_fields_have_a_REAL_external_producer_contract(self):
        expected = {
            "authPlaneOk", "eventPlaneOk", "controlPlaneOk", "mediaPlaneOk", "ptzHomeOk",
            "lastEventProofAt", "lastControlProofAt", "lastMediaProofAt", "lastPtzNotifyAt",
            "conversationWorkerOk", "conversationWorkerState", "conversationWorkerHeartbeatAt",
            "conversationAudioSource", "conversationCaptureHost", "conversationSttEngine",
            "conversationQueueDepth", "conversationLastTrigger", "lastConversationEventAt",
            "lastConversationCaptureAt", "lastConversationSttAt", "lastConversationPostAt",
            "lastConversationSummaryAt", "lastConversationCoverage", "conversationFailuresToday",
            "conversationLastError",
        }
        self.assertTrue(
            expected.issubset(self.interaction),
            f"real StateNour heartbeat builder omitted {sorted(expected - self.interaction)}",
        )

    def test_interaction_gate_detects_a_mutated_producer_that_drops_one_field(self):
        module = load_eufy_agent_module()
        if module is None:
            self.skipTest("statenour local agent is not checked out beside camera-bridge")
        original = module.INTERACTION_HEARTBEAT_FIELDS
        try:
            module.INTERACTION_HEARTBEAT_FIELDS = tuple(
                key for key in original if key != "mediaPlaneOk"
            )
            mutated = interaction_heartbeat_keys(module)
        finally:
            module.INTERACTION_HEARTBEAT_FIELDS = original

        authored = set(self.body) | set(mutated)
        orphans = sorted(
            field for field in self.columns
            if field not in authored and field not in NOT_SENT_BY_DESIGN
        )
        self.assertIn(
            "mediaPlaneOk",
            orphans,
            "mutation canary failed: dropping a real interaction field must break the contract",
        )

    def test_interaction_gate_detects_a_mutated_producer_that_drops_conversation_field(self):
        module = load_eufy_agent_module()
        if module is None:
            self.skipTest("statenour local agent is not checked out beside camera-bridge")
        original = module.INTERACTION_HEARTBEAT_FIELDS
        try:
            module.INTERACTION_HEARTBEAT_FIELDS = tuple(
                key for key in original if key != "conversationWorkerState"
            )
            mutated = interaction_heartbeat_keys(module)
        finally:
            module.INTERACTION_HEARTBEAT_FIELDS = original

        authored = set(self.body) | set(mutated)
        orphans = sorted(
            field for field in self.columns
            if field not in authored and field not in NOT_SENT_BY_DESIGN
        )
        self.assertIn(
            "conversationWorkerState",
            orphans,
            "mutation canary failed: dropping a real conversation field must break the contract",
        )
    def test_the_gate_can_actually_SEE_the_columns(self):
        """The positive control. A parse that returned [] would make every assertion above
        pass vacuously, forever, and this whole file would be decoration."""
        self.assertGreater(len(self.columns), 20,
                           f"only parsed {len(self.columns)} columns out of the route")
        for expected in ("camera", "heartbeatSeq", "mode", "outboxDepth"):
            self.assertIn(expected, self.columns)


class ModeIsAlwaysValidTest(unittest.TestCase):
    """`mode` must land inside the shop's enum whatever else is on the command line.

    THE DEFECT THIS CATCHES, which shipped and ran against the live shop: the hard-case
    block in `main()` used a local called `mode` for the EPISODE mode, clobbering the
    producer's own `mode` computed 400 lines earlier in the same function scope. `EdgeLoop`
    was then constructed with mode="both", its first heartbeat went out as "BOTH", and the
    shop rejected it 400.

    Every property of that bug conspired to hide it. It appeared ONLY with `--hard-cases`.
    It appeared ONLY on the first heartbeat, because `EdgeLoop` repairs `self.mode` from
    `base_mode` at the end of each send -- so heartbeats 2 onward were clean. And the
    failure was a return value nobody counted, so a run "with 0 rejections" was a run whose
    log I had grepped for the wrong string. I recorded it as unreproducible once before
    catching it here.

    So this asserts the OUTPUT, across a matrix of flags, against the enum read from the
    route -- not against a copy of it.
    """

    def _modes_the_shop_accepts(self):
        with open(ROUTE, encoding="utf-8") as fh:
            src = fh.read()
        m = re.search(r"HEARTBEAT_MODES\s*=\s*\[(.*?)\]", src, re.S)
        self.assertIsNotNone(m, "HEARTBEAT_MODES is gone; this gate is comparing nothing")
        modes = re.findall(r'"([A-Z_]+)"', m.group(1))
        self.assertGreaterEqual(len(modes), 2, f"only parsed {modes}")
        return modes

    def test_mode_is_in_the_shops_enum_for_EVERY_flag_combination(self):
        import argparse
        import itertools
        import sys as _sys

        sys.path.insert(0, os.path.join(REPO, "tests"))
        from test_edge_main import _cfg                                  # noqa: E402

        if not os.path.exists(ROUTE):
            self.skipTest("nickstire is not checked out beside camera-bridge")
        accepted = self._modes_the_shop_accepts()

        combos = itertools.product(
            (None, "production", "shadow", "commissioning"),   # --mode
            (None, "run-7"),                                    # --commissioning-run
            (None, "data/hard-cases"),                          # --hard-cases
            ("off", "both", "replace"),                         # --hard-case-episodes
            (False, True),                                      # --replay
        )
        for mode_arg, run, cases, episodes, replay in combos:
            args = edge_main.parse_args([])
            args.mode, args.commissioning_run = mode_arg, run
            args.hard_cases, args.hard_case_episodes, args.replay = cases, episodes, replay
            args.calibration = None
            args.camera = "lot"          # the camera the test config declares
            # A TEMP ledger. `build_edge` opens a real SQLite file, and the default path is
            # under gitignored `data/` -- which exists on the box that recorded the corpus
            # and does not exist in CI, so this passed locally and failed there with 96
            # `unable to open database file`. A test whose fixture is a gitignored directory
            # is broken by construction; it just happens to be broken somewhere else.
            args.ledger = os.path.join(tempfile.mkdtemp(), "edge.sqlite")
            with self.subTest(mode=mode_arg, run=run, cases=bool(cases),
                              episodes=episodes, replay=replay):
                # NO skipTest here. Swallowing the exception made every one of the 96
                # combinations skip, and the file reported "1 passed" -- a matrix that
                # measured nothing while looking like coverage. If build_edge cannot run,
                # this test has to say so loudly rather than quietly stand down.
                out = edge_main.build_edge(_cfg(), args)
                mode, base_mode = out[5], out[7]
                self.assertIn(mode, accepted,
                              f"build_edge produced mode={mode!r}, which the shop rejects")
                self.assertIn(base_mode, accepted,
                              f"base_mode={base_mode!r} is not a mode the shop accepts, and "
                              f"EdgeLoop falls back to it after every heartbeat")


class EdgeLoopRefusesABadModeTest(unittest.TestCase):
    """The gate that actually catches the bug that shipped.

    `ModeIsAlwaysValidTest` above checks `build_edge`'s OUTPUT, and the real defect was a
    local in `main()` clobbering that output on its way into `EdgeLoop` -- so reintroducing
    the exact shadowing left that test green. Asserting the output of one function cannot
    protect a value that is reassigned after it returns.

    So the constructor refuses. A bad mode is a bug in edge_main.py; it should stop the
    process at startup where the traceback names the line, rather than crossing the network
    to be diagnosed from a Zod error in a truncated log -- which is how it was found.
    """

    def _construct(self, mode, base_mode=None):
        sys.path.insert(0, os.path.join(REPO, "tests"))
        from test_edge_main import _loop, make_pipeline                  # noqa: E402

        class _Src:
            def read(self):
                return None

        class _Vision:
            health = SimpleNamespace(state=lambda ts: None)
            tracks = SimpleNamespace(tracks={})

            def step(self, frame):
                return {"emissions": []}

        kw = {"mode": mode}
        if base_mode is not None:
            kw["base_mode"] = base_mode
        return _loop(make_pipeline(), _Vision(), _Src(), **kw)

    def test_the_EPISODE_mode_leaking_into_mode_is_refused(self):
        """The exact value that shipped. `--hard-case-episodes both` reached `mode`, became
        "BOTH", and the shop rejected every first heartbeat."""
        for leaked in ("both", "replace", "off"):
            with self.subTest(leaked=leaked):
                with self.assertRaises(ValueError) as caught:
                    self._construct(leaked)
                self.assertIn("not one of", str(caught.exception))

    def test_a_VALID_mode_is_accepted_in_either_case(self):
        """The control. A constructor that refused everything would pass the test above and
        stop the producer from starting at all."""
        for good in ("PRODUCTION", "production", "SHADOW", "commissioning"):
            with self.subTest(mode=good):
                loop = self._construct(good)
                self.assertEqual(loop.mode, good.upper())

    def test_an_invalid_BASE_mode_is_refused_too(self):
        """`base_mode` is what `self.mode` falls back to after every heartbeat, so a bad one
        poisons every send from the SECOND onward -- quieter still, because the first
        heartbeat would look perfectly fine."""
        with self.assertRaises(ValueError):
            self._construct("PRODUCTION", base_mode="both")

    def test_VALID_MODES_matches_the_shops_enum(self):
        """A copy that drifts is worse than no copy: the producer would refuse a mode the
        shop accepts, or accept one it rejects."""
        if not os.path.exists(ROUTE):
            self.skipTest("nickstire is not checked out beside camera-bridge")
        with open(ROUTE, encoding="utf-8") as fh:
            src = fh.read()
        m = re.search(r"HEARTBEAT_MODES\s*=\s*\[(.*?)\]", src, re.S)
        self.assertEqual(set(re.findall(r'"([A-Z_]+)"', m.group(1))),
                         set(edge_main.VALID_MODES))


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
        # A directory that cannot exist on ANY platform. The first version used a
        # Windows-style bad path, which is a perfectly valid RELATIVE path on Linux:
        # dirname returned an empty string, abspath made that the cwd, and CI got a real
        # number for a disk the test believed was unreachable. Passed here, failed there.
        missing = os.path.join(tempfile.mkdtemp(), "no-such-dir", "edge.sqlite")
        self.assertFalse(os.path.isdir(os.path.dirname(missing)))
        self.assertIsNone(edge_main._disk_free_bytes(SimpleNamespace(path=missing)))
        self.assertIsNone(edge_main._disk_free_bytes(None))
        self.assertIsNone(edge_main._disk_free_bytes(SimpleNamespace(path=":memory:")))

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


class UnmeasuredIsNotZeroTest(unittest.TestCase):
    """NULL means "this producer does not report it". 0 means "it looked and found none".

    Two of the heartbeat's counters exist only on producers new enough to keep them, and the
    shop stores both columns NULLABLE precisely so the two claims stay apart -- migration 0124
    says so, the admin card renders a number only when it is greater than zero, and the whole
    justification for a nullable column rather than `NOT NULL DEFAULT 0` rests on it.

    None of which was TESTED. A mutation replacing `None if x is None else int(x)` with
    `int(x or 0)` passed all 19 contract tests: the producer would have reported a confident
    zero for a question nobody asked, the card would have shown a clean "0 missed arrivals"
    for a producer that has never counted them, and every gate stayed green. That is the same
    failed-read-renders-as-a-confident-zero shape this repo has spent whole days removing, and
    the argument against it lived only in prose.
    """

    def _body(self, **over):
        vision = SimpleNamespace(
            tracker=SimpleNamespace(open_visits=lambda: []),
            stats=SimpleNamespace(**over.pop("stats", {})),
        )
        # Mirrors the fixture above: a real temp path so `_disk_free_bytes` has something to
        # measure, and `shop_outbox_oldest_age` under its actual name.
        ledger = SimpleNamespace(
            path=os.path.join(tempfile.mkdtemp(), "edge-sign.sqlite"),
            shop_outbox_depth=lambda: 0, dead_letter_depth=lambda: 0,
            shop_outbox_oldest_age=lambda now: None)
        kwargs = dict(
            camera="sign", seq=1, now=1000.0, mode="PRODUCTION",
            source=SimpleNamespace(), vision=vision, ledger=ledger,
            health_state=None, scene_state=None, calibration_version=None,
            detector_name="fake", model_sha256=None, last_healthy_frame_at=None,
            last_inference_at=1000.0, inference_p95_ms=12.0,
            last_frame_at=1000.0, last_cloud_ack_at=1000.0)
        kwargs.update(over)
        return edge_main.edge_heartbeat_body(**kwargs)

    def test_an_UNREPORTED_counter_is_null_and_never_zero(self):
        body = self._body()
        for field in ("relocateFailures", "preexistingCrossed"):
            self.assertIn(field, body, f"{field} must be PRESENT so the shop can store null")
            self.assertIsNone(
                body[field],
                f"{field} came back {body[field]!r} for a producer that does not report it. "
                f"NULL is 'not measured'; 0 is 'looked and found none', and the admin card "
                f"and migration 0124 both depend on telling them apart.")

    def test_a_REAL_zero_survives_as_zero(self):
        """The other direction, and the one a truthiness test breaks. A producer that HAS
        looked and found none must report 0 -- suppressing it would hide a healthy reading
        behind the same null as a producer that cannot count."""
        body = self._body(relocate_failures=0, preexisting_crossed=0)
        self.assertEqual(body["relocateFailures"], 0)
        self.assertEqual(body["preexistingCrossed"], 0)

    def test_a_real_COUNT_is_carried_through(self):
        body = self._body(relocate_failures=7, preexisting_crossed=3)
        self.assertEqual(body["relocateFailures"], 7)
        self.assertEqual(body["preexistingCrossed"], 3)


if __name__ == "__main__":
    unittest.main()
