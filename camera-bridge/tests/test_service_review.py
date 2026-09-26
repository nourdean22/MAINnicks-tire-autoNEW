from types import SimpleNamespace

import edge_main


class _Recorder:
    cooldown_seconds = 60.0

    def __init__(self, accept=True):
        self.accept = accept
        self.fired = []

    def trigger(self, reason, at, context=None):
        self.fired.append((reason, at, context or {}))
        return self.accept

    def flush_ready(self, _now):
        return []


def _track(track_id=1, *, stationary=45.0, zones=None, evidence="arrival", misses=0):
    return SimpleNamespace(
        track_id=track_id,
        evidence=evidence,
        misses=misses,
        zones=list(zones or ["front_lot"]),
        stationary_for=lambda _now: stationary,
    )


def _loop(track, recorder=None, *, threshold=30.0):
    loop = edge_main.EdgeLoop.__new__(edge_main.EdgeLoop)
    loop.hard_cases = recorder or _Recorder()
    loop.vision = SimpleNamespace(
        tracks=SimpleNamespace(tracks={track.track_id: track}),
        bays=SimpleNamespace(bays={"bay1": object(), "bay2": object()}),
    )
    loop._last_layout_epoch = None
    loop.service_review_seconds = threshold
    loop._service_review_armed = set()
    loop._service_review_attempted = {}
    loop.pipeline = SimpleNamespace(metrics=SimpleNamespace(inc=lambda _name: None))
    return loop


def _frame(ts=1000.0):
    return SimpleNamespace(ts=ts, meta={})


def test_arrived_stationary_vehicle_outside_bays_arms_one_review_clip():
    rec = _Recorder()
    loop = _loop(_track(), rec)

    loop._note_hard_cases(_frame(), {})
    loop._note_hard_cases(_frame(1001.0), {})

    assert len(rec.fired) == 1
    reason, _at, context = rec.fired[0]
    assert reason == "NO_BAY_ACTIVITY_REVIEW"
    assert context["trackId"] == 1
    assert context["stationarySeconds"] == 45.0
    assert "NOT proof" in context["meaning"]


def test_inside_bay_is_not_a_no_bay_review_case():
    rec = _Recorder()
    loop = _loop(_track(zones=["front_lot", "bay1"]), rec)
    loop._note_hard_cases(_frame(), {})
    assert rec.fired == []


def test_waiting_for_stationary_floor_is_not_service_evidence():
    rec = _Recorder()
    loop = _loop(_track(stationary=12.0), rec, threshold=30.0)
    loop._note_hard_cases(_frame(), {})
    assert rec.fired == []


def test_nonarrival_track_is_not_sampled_as_customer_service_case():
    rec = _Recorder()
    loop = _loop(_track(evidence="preexisting"), rec)
    loop._note_hard_cases(_frame(), {})
    assert rec.fired == []


def test_global_cooldown_rejection_retries_later_without_spamming_each_frame():
    rec = _Recorder(accept=False)
    loop = _loop(_track(), rec)

    loop._note_hard_cases(_frame(1000.0), {})
    loop._note_hard_cases(_frame(1001.0), {})
    loop._note_hard_cases(_frame(1059.0), {})
    loop._note_hard_cases(_frame(1060.0), {})

    assert [x[1] for x in rec.fired] == [1000.0, 1060.0]
