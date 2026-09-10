"""An HTTP 200 is not a model.

The OpenVINO storage host answers a path that does not exist in a given release with a
DIRECTORY-LISTING PAGE at status 200 and `text/html`. Measured while adding a new pin: the
requested `.xml` and `.bin` came back byte-identical at 1,061 bytes.

The sha256 pin catches that on every later run -- but not on the run that matters, which is
the FIRST one, where whoever records a new pin would compute and enshrine the hash of the
error page. After that the corpus verifies perfectly forever against the wrong bytes.
"""
from __future__ import annotations

from vision.fetch_models import MIN_PLAUSIBLE_BYTES, _implausible


def test_an_HTML_content_type_is_refused_however_large():
    reason = _implausible("text/html; charset=utf-8", b"x" * (MIN_PLAUSIBLE_BYTES * 4))
    assert reason and "web page" in reason


def test_the_MEASURED_error_page_is_refused():
    """The real body this host returned, at the real length."""
    body = (b"<!DOCTYPE html>\n<html>\n<head>\n  <meta charset=\"UTF-8\">\n"
            b"  <title>storage.openvinotoolkit.org</title>\n</head><body></body></html>")
    body = body + b" " * (1061 - len(body))
    assert _implausible("text/html", body)


def test_an_HTML_BODY_is_refused_even_when_the_content_type_lies():
    """A misconfigured host can serve `application/octet-stream` for an error page. The bytes
    are the thing that cannot lie."""
    body = b"<!doctype html>\n<html><body>nope</body></html>" + b" " * MIN_PLAUSIBLE_BYTES
    assert _implausible("application/octet-stream", body)


def test_a_TINY_body_is_refused_even_without_html():
    assert _implausible("application/octet-stream", b"\x00" * 100)


def test_a_PLAUSIBLE_IR_PAYLOAD_is_accepted():
    """The positive control. Without it a guard that rejected everything would pass every
    test above while making the fetcher unable to download anything at all."""
    xml = b"<?xml version=\"1.0\"?><net name=\"vehicle-detection\">" + b"<layer/>" * 2000
    assert _implausible("application/xml", xml) == ""
    weights = bytes(range(256)) * 400
    assert _implausible("application/octet-stream", weights) == ""
