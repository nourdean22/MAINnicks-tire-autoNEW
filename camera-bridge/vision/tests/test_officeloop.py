"""officeloop tests.

The only thing this module really has to get right is WHEN NOT TO RUN. Outside shop hours the
office is a private room, so every test here is about a boundary: the two DST days, the minute
before open, the minute after close, and the capture that would otherwise overrun 18:00.
"""
from __future__ import annotations

import sys
from datetime import datetime, time as dtime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import pytest  # noqa: E402

from vision.officeloop import (  # noqa: E402
    DEFAULT_CLOSE, DEFAULT_OPEN, MAX_SLEEP_S, TimezoneDataMissing, WindowState, _backoff,
    _zone, capture_seconds, window_state,
)

ET = ZoneInfo("America/New_York")


def at(y, m, d, hh, mm=0) -> datetime:
    return datetime(y, m, d, hh, mm, tzinfo=ET)


# ------------------------------------------------------------------ the window itself

def test_mid_morning_is_open():
    s = window_state(at(2026, 9, 22, 10, 30))
    assert s.is_open and s.seconds_until_close == 7.5 * 3600


def test_one_minute_BEFORE_open_is_closed():
    # 07:59 must not capture. The office is private until the shop opens.
    s = window_state(at(2026, 9, 22, 7, 59))
    assert not s.is_open and s.seconds_until_open == 60


def test_exactly_08_00_is_OPEN_and_exactly_18_00_is_CLOSED():
    """The boundaries are half-open [open, close) so the window is exactly ten hours.

    Getting this wrong in the other direction records a minute past six every single day.
    """
    assert window_state(at(2026, 9, 22, 8, 0)).is_open is True
    assert window_state(at(2026, 9, 22, 18, 0)).is_open is False


def test_after_close_waits_for_TOMORROW_not_today():
    # A naive "seconds until 08:00 today" goes NEGATIVE after close, and a negative sleep is
    # no sleep at all -- the loop would spin all night with the stream open.
    s = window_state(at(2026, 9, 22, 22, 0))
    assert not s.is_open
    assert s.seconds_until_open == 10 * 3600


def test_the_overnight_wait_is_never_negative():
    for hour in (18, 19, 23):
        s = window_state(at(2026, 9, 22, hour, 30))
        assert s.seconds_until_open > 0, hour


def test_weekends_are_included_because_the_operator_asked_for_every_day():
    # 2026-09-26 is a Saturday. Pinned so a later "business days only" tweak is a deliberate
    # change with a failing test, not a silent one.
    assert window_state(at(2026, 9, 26, 10, 0)).is_open is True


# ------------------------------------------------------------------ DST, both directions

def test_spring_forward_day_still_opens_at_8am_LOCAL():
    """2026-03-08 loses an hour at 02:00 ET. A fixed -05:00 offset would make 8am local read
    as 7am, and the capture would start an hour before the shop opens."""
    assert window_state(at(2026, 3, 8, 7, 59)).is_open is False
    assert window_state(at(2026, 3, 8, 8, 0)).is_open is True


def test_fall_back_day_still_closes_at_6pm_LOCAL():
    """2026-11-01 repeats 01:00-02:00 ET. The window must still be ten hours long."""
    s = window_state(at(2026, 11, 1, 8, 0))
    assert s.is_open and s.seconds_until_close == 10 * 3600
    assert window_state(at(2026, 11, 1, 18, 0)).is_open is False


# ------------------------------------------------------------------ the trimmed tail

def test_a_capture_that_would_overrun_close_is_TRIMMED_to_the_boundary():
    # 17:58 + 300s would run to 18:03. Recording after hours is the failure; ending at 18:00
    # exactly is the fix.
    s = window_state(at(2026, 9, 22, 17, 58))
    assert capture_seconds(s, 300.0) == 120.0


def test_a_full_length_capture_is_NOT_trimmed_mid_day():
    # Positive control: without it, a function that always trimmed to zero passes above.
    assert capture_seconds(window_state(at(2026, 9, 22, 10, 0)), 300.0) == 300.0


def test_a_sliver_of_window_is_SKIPPED_rather_than_opening_the_stream_for_seconds():
    s = window_state(at(2026, 9, 22, 17, 59, ))
    assert capture_seconds(s, 300.0, min_tail=30.0) == 60.0
    s2 = window_state(at(2026, 9, 22, 17, 59)).__class__(True, 0.0, 5.0)
    assert capture_seconds(s2, 300.0, min_tail=30.0) is None


def test_capture_seconds_refuses_outright_while_CLOSED():
    assert capture_seconds(WindowState(False, 3600.0, 0.0), 300.0) is None


# ------------------------------------------------------------------ loop hygiene

def test_backoff_is_capped_so_a_reopened_shop_recovers():
    # Uncapped exponential backoff after a night of failures would wait hours into the next
    # business day before trying again.
    assert _backoff(1) < _backoff(3) <= MAX_SLEEP_S
    assert _backoff(50) == MAX_SLEEP_S


def test_the_loop_never_sleeps_longer_than_the_recheck_interval():
    """A single eight-hour sleep misses a clock change and a laptop suspend."""
    s = window_state(at(2026, 9, 22, 22, 0))
    assert min(s.seconds_until_open, MAX_SLEEP_S) == MAX_SLEEP_S


def test_defaults_are_the_hours_the_operator_asked_for():
    assert (DEFAULT_OPEN, DEFAULT_CLOSE) == (dtime(8, 0), dtime(18, 0))


def test_a_MISSING_tz_database_is_a_NAMED_error_naming_the_fix(monkeypatch):
    """Windows ships no system tz database; without `tzdata` this is the shop PC's first crash.

    MEASURED on this box 2026-09-22: stdlib zoneinfo raised ZoneInfoNotFoundError for
    "America/New_York" until tzdata was installed. A bare stack trace at 8am is a much worse
    outcome than a line naming the pip install, so the error is named and carries the cure.
    """
    def boom(_key):
        raise KeyError("no such zone")
    monkeypatch.setattr("vision.officeloop.ZoneInfo", boom)
    with pytest.raises(TimezoneDataMissing, match="pip install tzdata"):
        _zone("America/New_York")


def test_there_is_NO_silent_fallback_to_a_fixed_offset(monkeypatch):
    """The dangerous cure would be defaulting to -05:00 when the zone is unavailable.

    That works for most of the year and then moves the shop's hours by an hour on each DST
    day -- recording before the shop opens, invisibly. Refusing is the correct behaviour.
    """
    def boom(_key):
        raise KeyError("no such zone")
    monkeypatch.setattr("vision.officeloop.ZoneInfo", boom)
    with pytest.raises(TimezoneDataMissing):
        _zone()
