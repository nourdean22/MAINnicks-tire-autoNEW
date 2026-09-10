"""One incident as a replayable EPISODE, not a folder of pictures.

A hard case is currently 66 JPEGs and a `case.json`. You can look at the pictures, and that
is all -- you cannot see what the detector believed at frame 31, which scene the locator
thought it was on, or whether the generation broke a second before the trigger. Every
question about WHY needs a different log, opened in a different tool, aligned by hand.

This writes the same incident as an MCAP file: append-only, indexed, self-contained, one
message stream per topic, all on one clock. Foxglove and Rerun open it directly -- scrub the
whole system through time instead of reading logs. MCAP is MIT.

RECOVERABILITY, AS MEASURED RATHER THAN AS ADVERTISED
-----------------------------------------------------
"An interrupted MCAP is still readable" is true, and badly misleading as usually stated.
Truncating a real 30-message file at 90/50/25% and reading it back:

    reader                        90% cut   50% cut   25% cut
    indexed (make_reader)           0/30      0/30      0/30
    streaming, chunked (default)   30/30     30/30      0/30
    streaming, use_chunking=False  27/30     15/30      7/30

Three things follow, and all three are wired below.
  1. The DEFAULT reader recovers nothing. It needs the summary section, which a killed
     process never writes, so a perfectly recoverable episode reads as total corruption.
     `verify()` therefore falls back to the streaming reader and reports what survived.
  2. Chunked recovery is all-or-nothing PER CHUNK -- that is why the 50% cut recovered
     everything and the 25% cut recovered nothing, rather than degrading smoothly. So the
     chunk size, not the format, is what bounds the loss. `CHUNK_BYTES` is small on purpose.
  3. Unchunked degrades message-by-message but cost 12.6x the bytes on that sample. Not
     worth it against a byte budget whose whole job is keeping clips on disk.

`verify()` distinguishes COMPLETE from TRUNCATED, and only a complete episode may justify
deleting the frames it replaces. A file that opens is not a file that has your data in it.

WHAT IS AND IS NOT IN AN EPISODE
--------------------------------
Only channels with a REAL producer are written. The tempting move is to declare
`/tracks`, `/detections`, `/emissions`, `/shadow` and `/world_points` now and fill them
later -- which ships a format whose channels are permanently empty and indistinguishable
from an incident in which nothing happened.

So every episode records BOTH the channels this build knows about and the channels it
actually wired, in `/episode/meta`. A reader can then tell "not recorded" from "recorded,
and empty" -- the same empty-vs-error line the rest of this system holds, applied to a data
format, where getting it wrong is worse because the file outlives the code that wrote it.

Add a channel by feeding it: `note(topic, ts, payload)` takes anything JSON-shaped, and
`WIRED` grows when a real caller appears. Nothing else needs to change.
"""
from __future__ import annotations

import base64
import json
import os
import time
from typing import Any, Dict, List, Optional

try:  # MCAP is optional on purpose: a producer must start on a box that lacks it.
    from mcap.writer import Writer as _McapWriter
    AVAILABLE = True
except Exception:  # noqa: BLE001 - any import failure means "no episodes", never "no producer"
    _McapWriter = None  # type: ignore[assignment]
    AVAILABLE = False

# Every channel this build UNDERSTANDS. Presence here is a promise about the vocabulary, not
# about the data -- see WIRED.
KNOWN = (
    "/camera/image",
    "/hardcase/trigger",
    "/episode/meta",
    "/detections",
    "/tracks",
    "/emissions",
    "/scene",
    "/generation",
    "/health",
    "/shadow",
    "/world_points",
)

# Channels with a real caller TODAY. The rest are declared above so a reader knows the word
# exists, and are absent from the file so a reader knows they were never recorded.
WIRED = ("/camera/image", "/hardcase/trigger", "/episode/meta")

_IMAGE_SCHEMA = {
    "type": "object",
    "properties": {
        "timestamp": {"type": "object", "properties": {
            "sec": {"type": "integer"}, "nsec": {"type": "integer"}}},
        "frame_id": {"type": "string"},
        "data": {"type": "string", "contentEncoding": "base64"},
        "format": {"type": "string"},
    },
}
_JSON_SCHEMA = {"type": "object"}


# Small on purpose. A chunk is the unit of loss when a producer is killed mid-write (see the
# measurement above), so this trades a little compression for a bounded blast radius: at the
# ~4 fps these clips sample at, 256 KB of JPEG is a couple of seconds.
CHUNK_BYTES = 256 * 1024


def _ns(ts: float) -> int:
    return int(ts * 1e9)


class EpisodeStats:
    __slots__ = ("messages", "images", "bytes", "dropped", "last_error")

    def __init__(self) -> None:
        self.messages = 0
        self.images = 0
        self.bytes = 0
        self.dropped = 0
        self.last_error: Optional[str] = None

    def describe(self) -> str:
        if not AVAILABLE:
            return "episodes OFF (mcap not importable)"
        base = f"{self.messages} msg / {self.images} img / {self.bytes / 1e6:.1f} MB"
        return base if not self.dropped else f"{base}, {self.dropped} dropped ({self.last_error})"


class EpisodeWriter:
    """Writes ONE episode. Never raises at the caller; every failure is counted.

    Losing an episode is losing a training sample. Losing the producer is losing the lot,
    and the lot is what the shop is paying for -- so this swallows its own failures the same
    way `HardCaseRecorder` does, and makes the swallowing visible in `stats`.
    """

    def __init__(self, path: str, *, frame_id: str = "camera", jpeg_quality: int = 80):
        self.path = path
        self.frame_id = frame_id
        self.jpeg_quality = jpeg_quality
        self.stats = EpisodeStats()
        self._fh = None
        self._writer = None
        self._channels: Dict[str, int] = {}
        self._used: List[str] = []
        self._open()

    # ---- lifecycle ----------------------------------------------------------------
    def _open(self) -> None:
        if not AVAILABLE:
            return
        try:
            os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
            self._fh = open(self.path, "wb")
            self._writer = _McapWriter(self._fh, chunk_size=CHUNK_BYTES)
            self._writer.start(profile="", library="nick-edge")
        except Exception as exc:  # noqa: BLE001
            self._fail(exc, "open")
            self._fh = None
            self._writer = None

    @property
    def open(self) -> bool:
        return self._writer is not None

    def _fail(self, exc: Exception, where: str) -> None:
        self.stats.dropped += 1
        self.stats.last_error = f"{where}: {type(exc).__name__}: {exc}"

    def _channel(self, topic: str, schema: dict, schema_name: str) -> Optional[int]:
        if topic in self._channels:
            return self._channels[topic]
        sid = self._writer.register_schema(  # type: ignore[union-attr]
            name=schema_name, encoding="jsonschema", data=json.dumps(schema).encode())
        cid = self._writer.register_channel(  # type: ignore[union-attr]
            topic=topic, message_encoding="json", schema_id=sid)
        self._channels[topic] = cid
        self._used.append(topic)
        return cid

    # ---- writing ------------------------------------------------------------------
    def add_image(self, ts: float, jpeg: bytes, topic: str = "/camera/image") -> bool:
        """One already-compressed frame. Takes JPEG bytes, never a raw array: re-encoding
        the same pixels a second time to satisfy a file format is pure waste, and the caller
        has already made the quality decision."""
        if not self.open:
            return False
        try:
            cid = self._channel(topic, _IMAGE_SCHEMA, "foxglove.CompressedImage")
            sec = int(ts)
            payload = {
                "timestamp": {"sec": sec, "nsec": int((ts - sec) * 1e9)},
                "frame_id": self.frame_id,
                "data": base64.b64encode(jpeg).decode("ascii"),
                "format": "jpeg",
            }
            self._emit(cid, ts, payload)
            self.stats.images += 1
            return True
        except Exception as exc:  # noqa: BLE001
            self._fail(exc, topic)
            return False

    def note(self, topic: str, ts: float, payload: Any) -> bool:
        """Any JSON-shaped observation on any topic.

        `topic` is checked against KNOWN so a typo becomes a counted drop rather than a
        channel nobody ever looks for. A new topic is added to KNOWN deliberately, which is
        the point at which someone decides what the word means.
        """
        if not self.open:
            return False
        if topic not in KNOWN:
            self.stats.dropped += 1
            self.stats.last_error = f"unknown topic {topic!r} (add it to episode.KNOWN)"
            return False
        try:
            cid = self._channel(topic, _JSON_SCHEMA, "nick.Json")
            self._emit(cid, ts, payload if isinstance(payload, dict) else {"value": payload})
            return True
        except Exception as exc:  # noqa: BLE001
            self._fail(exc, topic)
            return False

    def _emit(self, cid: int, ts: float, payload: dict) -> None:
        raw = json.dumps(payload, default=str).encode()
        self._writer.add_message(  # type: ignore[union-attr]
            channel_id=cid, log_time=_ns(ts), publish_time=_ns(ts), data=raw)
        self.stats.messages += 1
        self.stats.bytes += len(raw)

    def close(self, meta: Optional[dict] = None) -> Optional[str]:
        """Finish the file and return its path, or None if nothing usable was written."""
        if not self.open:
            return None
        try:
            full = dict(meta or {})
            # The channel census. Written LAST so it reports what the episode really holds.
            full["channelsKnown"] = list(KNOWN)
            full["channelsWired"] = list(WIRED)
            full["channelsPresent"] = sorted(self._used)
            full["writtenAt"] = time.time()
            cid = self._channel("/episode/meta", _JSON_SCHEMA, "nick.Json")
            self._emit(cid, full.get("at", time.time()), full)
            self._writer.finish()  # type: ignore[union-attr]
        except Exception as exc:  # noqa: BLE001
            self._fail(exc, "close")
        finally:
            try:
                if self._fh:
                    self._fh.close()
            except Exception as exc:  # noqa: BLE001
                self._fail(exc, "close-fh")
            self._writer = None
            self._fh = None
        if not os.path.exists(self.path) or os.path.getsize(self.path) == 0:
            return None
        return self.path


def verify(path: str) -> Optional[Dict[str, Any]]:
    """Re-read an episode and report what is actually in it.

    Returns `{"topics": {...}, "messages": n, "complete": bool}`, or None if nothing at all
    could be read. `complete` is False when only the streaming fallback worked -- i.e. the
    file has no summary section, which is exactly what a killed producer leaves behind.

    Anything about to DELETE on the strength of this must require `complete`. A truncated
    episode is worth keeping and worth reading, and is not evidence that whatever it
    replaced is safe to remove.
    """
    if not AVAILABLE:
        return None
    try:
        from mcap.reader import make_reader

        counts: Dict[str, int] = {}
        with open(path, "rb") as fh:
            for _schema, channel, _msg in make_reader(fh).iter_messages():
                counts[channel.topic] = counts.get(channel.topic, 0) + 1
        return {"topics": counts, "messages": sum(counts.values()), "complete": True}
    except Exception:  # noqa: BLE001 - fall through to the reader that survives truncation
        pass
    try:
        from mcap.stream_reader import StreamReader
        import mcap.records as records

        # Channel records arrive as records here, not resolved for us, so topics have to be
        # rebuilt from the stream. A message whose channel record was itself lost is counted
        # under its id rather than dropped: "we recovered a message we cannot name" is a
        # different and more useful fact than "we recovered nothing".
        # Accumulate OUTSIDE the try. `StreamReader.records` is a generator, and on a
        # truncated file it raises PART WAY THROUGH -- after yielding the records that did
        # survive. Counting inside the try threw those away with the exception and returned
        # None, so a recoverable episode reported as unreadable: the precise empty-vs-error
        # defect this codebase keeps hunting, written here by hand. Measured: a 70% cut went
        # from None to 40 recovered messages by moving these two lines up.
        counts: Dict[str, int] = {}
        by_id: Dict[int, str] = {}
        try:
            with open(path, "rb") as fh:
                for rec in StreamReader(fh, emit_chunks=False).records:
                    if isinstance(rec, records.Channel):
                        by_id[rec.id] = rec.topic
                    elif isinstance(rec, records.Message):
                        topic = by_id.get(rec.channel_id, f"<channel {rec.channel_id}>")
                        counts[topic] = counts.get(topic, 0) + 1
        except Exception:  # noqa: BLE001 - the truncation itself; keep what we already have
            pass
        if not counts:
            return None
        return {"topics": counts, "messages": sum(counts.values()), "complete": False}
    except Exception:  # noqa: BLE001 - an unreadable episode is a None, never an exception
        return None
