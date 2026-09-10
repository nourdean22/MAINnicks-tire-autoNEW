"""A challenger records its disagreements and never gets a vote.

Every test names the failure it prevents. The failures here are all quiet: a ledger that
never wrote, a rate computed over nothing, a challenger that could influence truth.
"""
from __future__ import annotations

import json
import os

import pytest

from vision.shadow import SUBJECTS, ShadowLedger, read_rows, summarise


def _led(tmp_path, **kw):
    return ShadowLedger(path=str(tmp_path / "shadow.jsonl"),
                        champion_model="champ-v1", challenger_model="chal-v2", **kw)


def test_a_DISAGREEMENT_is_written_with_BOTH_model_names(tmp_path):
    """Model names go on every row, not in a header. A ledger is read long after both models
    have been replaced, and a row that cannot name what it compared is an anecdote."""
    led = _led(tmp_path)
    assert led.note("ARRIVAL", champion=False, challenger=True, at=1000.0,
                    context={"trackId": "t7"})
    rows = read_rows(led.path)
    assert len(rows) == 1
    assert rows[0]["champion"]["model"] == "champ-v1"
    assert rows[0]["challenger"]["model"] == "chal-v2"
    assert rows[0]["champion"]["decision"] is False
    assert rows[0]["challenger"]["decision"] is True
    assert rows[0]["agreed"] is False
    assert rows[0]["context"]["trackId"] == "t7"


def test_an_AGREEMENT_is_counted_but_not_written(tmp_path):
    """Agreement is the common case. Writing it turns a signal into a log -- but a promotion
    gate measuring a RATE needs the denominator, which the stats carry without disk cost."""
    led = _led(tmp_path)
    assert not led.note("VEHICLE_COUNT", 3, 3, at=1.0)
    assert led.stats.agreements == 1 and led.stats.considered == 1
    assert read_rows(led.path) == []
    assert led.stats.disagreement_rate == 0.0


def test_agreements_CAN_be_recorded_when_the_caller_asks(tmp_path):
    led = _led(tmp_path, record_agreements=True)
    assert led.note("VEHICLE_COUNT", 3, 3, at=1.0)
    assert read_rows(led.path)[0]["agreed"] is True


def test_the_disagreement_rate_is_NONE_when_nothing_was_considered(tmp_path):
    """'The challenger never ran' and 'the challenger agreed every time' are opposite
    findings. Rendering both as 0.0 means a promotion gate can pass while measuring
    nothing."""
    led = _led(tmp_path)
    assert led.stats.disagreement_rate is None
    led.note("ARRIVAL", True, True, at=1.0)
    assert led.stats.disagreement_rate == 0.0


def test_an_UNKNOWN_subject_is_refused_and_counted(tmp_path):
    """Guessing would scatter one decision class across two names and make every later query
    quietly incomplete."""
    led = _led(tmp_path)
    assert not led.note("ARRIVEL", False, True, at=1.0)
    assert led.stats.dropped_unknown_subject == 1
    assert led.stats.considered == 0, "a rejected call must not inflate the denominator"


def test_the_ledger_NEVER_raises_and_a_failed_write_is_visible(tmp_path):
    """Research data never outranks watching the lot -- but a broken ledger must not look
    like a ledger with nothing to say."""
    blocked = tmp_path / "blocked"
    blocked.write_text("a file where a directory needs to be", encoding="utf-8")
    led = ShadowLedger(path=str(blocked / "shadow.jsonl"), champion_model="c",
                       challenger_model="x")
    assert not led.note("ARRIVAL", False, True, at=1.0)
    assert led.stats.dropped_write_error == 1
    assert not led.stats.healthy
    assert led.stats.last_error


def test_an_EMPTY_ledger_is_healthy_because_agreement_is_a_good_outcome(tmp_path):
    led = _led(tmp_path)
    assert led.stats.healthy and led.stats.written == 0


def test_a_NON_SERIALISABLE_decision_is_kept_as_its_repr_rather_than_lost(tmp_path):
    """The caller hands over a domain object precisely because it is domain-specific. A row
    that cannot be serialised would take the whole append down, and a repr is worth more
    later than a missing row."""
    class _Weird:
        def __repr__(self):
            return "<Verdict LIKELY_SAME 0.82>"

    led = _led(tmp_path)
    assert led.note("TRACK_IDENTITY", _Weird(), None, at=1.0)
    assert "LIKELY_SAME" in read_rows(led.path)[0]["champion"]["decision"]


def test_the_file_ROTATES_instead_of_growing_without_bound(tmp_path):
    led = _led(tmp_path, max_bytes=400)
    for i in range(60):
        led.note("VEHICLE_COUNT", i, i + 1, at=float(i))
    assert led.stats.rotated >= 1
    assert os.path.getsize(led.path) < 400 * 4
    assert os.path.exists(led.path + ".1"), "one generation must be kept"


def test_a_CORRUPT_LINE_does_not_destroy_the_rest_of_the_ledger(tmp_path):
    """A process killed mid-write leaves a partial last line. Refusing to read the file
    because of its last 40 bytes would throw away every disagreement before the crash."""
    led = _led(tmp_path)
    led.note("ARRIVAL", False, True, at=1.0)
    with open(led.path, "a", encoding="utf-8") as fh:
        fh.write('{"at": 2.0, "subj')          # killed mid-write
    rows = read_rows(led.path)
    assert len(rows) == 2
    assert rows[0]["subject"] == "ARRIVAL"
    assert "_unreadable" in rows[1]
    assert summarise(rows)["unreadableRows"] == 1


def test_summarise_groups_by_SUBJECT_because_that_is_how_the_question_is_asked(tmp_path):
    """'Would this model have created visits that never happened?' is a question about
    ARRIVAL rows. An overall disagreement count cannot answer it."""
    led = _led(tmp_path)
    led.note("ARRIVAL", False, True, at=1.0)
    led.note("ARRIVAL", False, True, at=2.0)
    led.note("VEHICLE_COUNT", 2, 5, at=3.0)
    led.note("DEPARTURE", True, True, at=4.0)          # agreement, not written
    out = summarise(read_rows(led.path))
    assert out["bySubject"] == {"ARRIVAL": 2, "VEHICLE_COUNT": 1}
    assert out["disagreements"] == 3


def test_the_subject_vocabulary_is_closed_and_screaming_snake():
    """These names end up in every query anyone writes against this ledger. An open
    vocabulary becomes a pile of one-off strings nothing can group."""
    assert len(set(SUBJECTS)) == len(SUBJECTS)
    for name in SUBJECTS:
        assert name == name.upper() and " " not in name


def test_the_ledger_exposes_NO_WAY_for_a_challenger_to_influence_a_decision(tmp_path):
    """The structural guarantee, asserted rather than assumed. A challenger that could
    promote itself on its own evidence is a system marking its own exam, so the surface has
    to be write-only by construction rather than by convention.

    Asserted on an INSTANCE, not the class: dataclass fields without defaults never become
    class attributes, so `dir(ShadowLedger)` silently omits half the real surface and the
    check would pass while measuring the wrong object."""
    surface = {n for n in dir(_led(tmp_path)) if not n.startswith("_")}
    assert surface == {"note", "path", "champion_model", "challenger_model", "max_bytes",
                       "record_agreements", "stats"}, sorted(surface)
    # The only method is a recorder. Nothing here returns a verdict, exposes a threshold, or
    # offers a hook a caller could route a decision through.
    assert [n for n in surface if callable(getattr(_led(tmp_path), n))] == ["note"]


def test_summarise_EXCLUDES_agreements_even_when_they_are_recorded(tmp_path):
    """With `record_agreements` on, agreed rows sit in the file alongside disagreements. A
    summariser that counted them would report a disagreement rate of 100% for a challenger
    that never once differed -- and a mutation deleting that filter survived until this test
    existed, because the default ledger writes no agreed rows for it to miscount."""
    led = _led(tmp_path, record_agreements=True)
    led.note("ARRIVAL", False, True, at=1.0)          # a real disagreement
    led.note("ARRIVAL", True, True, at=2.0)           # agreement, now ON DISK
    led.note("VEHICLE_COUNT", 4, 4, at=3.0)           # agreement, now ON DISK
    rows = read_rows(led.path)
    assert len(rows) == 3, "all three rows must have been written"
    out = summarise(rows)
    assert out["disagreements"] == 1, out
    assert out["bySubject"] == {"ARRIVAL": 1}
    assert out["rows"] == 3, "the denominator still counts every row"
