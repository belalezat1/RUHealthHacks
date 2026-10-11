"""Event parsing, validation and de-duplication.

A batch is validated as a whole before anything is committed. Event identity is the
event_id; a repeated id with the same content (ingested_at may differ, since a retry
arrives later) is a duplicate, a repeated id with different content is a conflict.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
from dataclasses import dataclass, field
from datetime import datetime

from .data import ReferenceData, parse_instant

EVENT_COLUMNS = (
    "event_id", "event_time", "ingested_at", "consult_id",
    "event_type", "physician_id", "hospital_id", "description",
)

CONSULT_EVENT_TYPES = frozenset({
    "consult_received", "consult_triaged", "physician_assigned", "imaging_requested",
    "imaging_returned", "video_started", "video_ended", "note_started", "note_signed",
    "routing_attempt_failed", "incoming_call_ringing", "incoming_call_started",
    "incoming_call_ended", "outgoing_call_started", "outgoing_call_ended",
})
PHYSICIAN_EVENT_TYPES = frozenset({
    "physician_assigned", "incoming_call_ringing", "incoming_call_started", "incoming_call_ended",
    "outgoing_call_started", "outgoing_call_ended", "video_started", "video_ended",
    "note_started", "note_signed", "physician_status_changed", "camera_active",
    "camera_inactive", "agent_heartbeat_lost", "shift_started",
})
EVENT_TYPES = CONSULT_EVENT_TYPES | PHYSICIAN_EVENT_TYPES
# Events whose state effect is undefined without a physician.
REQUIRES_PHYSICIAN = frozenset({
    "physician_assigned", "incoming_call_ringing", "incoming_call_started", "incoming_call_ended",
    "outgoing_call_started", "outgoing_call_ended", "video_started", "video_ended",
    "physician_status_changed", "camera_active", "camera_inactive", "agent_heartbeat_lost", "shift_started",
})
STATUS_VALUES = ("Available", "In Meeting", "Temporarily Unavailable")


@dataclass(frozen=True)
class Event:
    event_id: str
    event_time: datetime
    ingested_at: datetime
    consult_id: str
    event_type: str
    physician_id: str
    hospital_id: str
    description: str

    def content_key(self) -> tuple:
        """Identity used for duplicate detection; excludes ingested_at (retries arrive later)."""
        return (self.event_id, self.event_time, self.consult_id, self.event_type,
                self.physician_id, self.hospital_id, self.description)

    def content_hash(self) -> str:
        raw = json.dumps([self.event_id, self.event_time.isoformat(), self.consult_id, self.event_type,
                          self.physician_id, self.hospital_id, self.description], separators=(",", ":"))
        return hashlib.sha256(raw.encode()).hexdigest()

    def sort_key(self) -> tuple:
        # Ingestion time controls visibility, never the meaning of equal-time
        # records. Logical stage order makes replay stable across arrival batches.
        order = {"consult_received": 0, "consult_triaged": 1, "physician_assigned": 2,
                 "incoming_call_ringing": 3, "incoming_call_started": 4,
                 "outgoing_call_started": 4, "imaging_requested": 5,
                 "imaging_returned": 6, "video_started": 7, "video_ended": 8,
                 "note_started": 9, "note_signed": 10}
        return (self.event_time, order.get(self.event_type, 0), self.event_id)

    def to_row(self) -> dict:
        return {
            "event_id": self.event_id,
            "event_time": self.event_time.isoformat(),
            "ingested_at": self.ingested_at.isoformat(),
            "consult_id": self.consult_id,
            "event_type": self.event_type,
            "physician_id": self.physician_id,
            "hospital_id": self.hospital_id,
            "description": self.description,
        }


@dataclass
class BatchResult:
    """Outcome of validating a batch against already-committed events."""
    rows_read: int = 0
    accepted: list[Event] = field(default_factory=list)
    duplicates: list[str] = field(default_factory=list)  # event ids already known (retries)
    errors: list[dict] = field(default_factory=list)  # {"row": n, "event_id": ..., "error": ...}

    @property
    def ok(self) -> bool:
        return not self.errors

    def summary(self) -> dict:
        return {
            "rows_read": self.rows_read,
            "accepted": len(self.accepted),
            "duplicates": len(self.duplicates),
            "duplicate_ids": self.duplicates[:50],
            "errors": self.errors[:100],
            "error_count": len(self.errors),
            "ok": self.ok,
        }


def event_from_row(row: dict) -> Event:
    return Event(
        event_id=(row.get("event_id") or "").strip(),
        event_time=parse_instant(row["event_time"]),
        ingested_at=parse_instant(row["ingested_at"]),
        consult_id=(row.get("consult_id") or "").strip(),
        event_type=(row.get("event_type") or "").strip(),
        physician_id=(row.get("physician_id") or "").strip(),
        hospital_id=(row.get("hospital_id") or "").strip(),
        description=(row.get("description") or "").strip(),
    )


def _validate_event(ev: Event, ref: ReferenceData) -> str | None:
    if not ev.event_id:
        return "event_id is required"
    if ev.event_type not in EVENT_TYPES:
        return f"unknown event_type {ev.event_type!r}"
    if ev.ingested_at < ev.event_time:
        return "ingested_at is earlier than event_time"
    if not (ref.supported_start <= ev.event_time < ref.supported_end):
        return f"event_time is outside the supplied scenario window ({ref.supported_start.isoformat()} to {ref.supported_end.isoformat()})"
    if ev.physician_id and ev.physician_id not in ref.physicians:
        return f"unknown physician_id {ev.physician_id!r}"
    if ev.hospital_id and ev.hospital_id not in ref.hospitals:
        return f"unknown hospital_id {ev.hospital_id!r}"
    if ev.event_type in CONSULT_EVENT_TYPES and not ev.consult_id:
        return f"{ev.event_type} requires consult_id"
    if ev.event_type in REQUIRES_PHYSICIAN and not ev.physician_id:
        return f"{ev.event_type} requires physician_id"
    if ev.event_type == "consult_received":
        if not ev.hospital_id:
            return "consult_received requires hospital_id"
    if ev.event_type == "physician_status_changed":
        status = ev.description.split(":", 1)[-1].strip()
        if status not in STATUS_VALUES:
            return f"unknown self-reported status {status!r}"
    if ev.physician_id and ev.hospital_id and ev.event_type == "physician_assigned":
        if not ref.credentialed(ev.physician_id, ev.hospital_id):
            return f"{ev.physician_id} is not credentialed at {ev.hospital_id}"
    return None


def validate_batch(rows: list[dict], ref: ReferenceData, existing: dict[str, Event]) -> BatchResult:
    """Validate rows against reference data and the already-committed events of the run.

    Nothing is mutated; the caller commits ``result.accepted`` atomically only if ``result.ok``.
    """
    result = BatchResult(rows_read=len(rows))
    seen: dict[str, Event] = {}
    for i, row in enumerate(rows, start=2):  # row 1 is the header
        eid = (row.get("event_id") or "").strip()
        try:
            ev = event_from_row(row)
        except (KeyError, ValueError, TypeError) as exc:
            result.errors.append({"row": i, "event_id": eid, "error": f"unparseable row: {exc}"})
            continue
        err = _validate_event(ev, ref)
        if err:
            result.errors.append({"row": i, "event_id": eid, "error": err})
            continue
        prior = existing.get(ev.event_id) or seen.get(ev.event_id)
        if prior is not None:
            if prior.content_key() == ev.content_key():
                result.duplicates.append(ev.event_id)
            else:
                result.errors.append({"row": i, "event_id": eid,
                                      "error": "event_id already exists with different content (conflict)"})
            continue
        seen[ev.event_id] = ev
        result.accepted.append(ev)
    return result


def read_csv_text(text: str) -> tuple[list[dict], list[str]]:
    """Return (rows, header_errors)."""
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    header = [h.strip() for h in (reader.fieldnames or [])]
    missing = [c for c in EVENT_COLUMNS if c not in header]
    if missing:
        return [], [f"missing required columns: {', '.join(missing)}"]
    if len(set(header)) != len(header):
        return [], ["duplicate CSV column names"]
    extra = [c for c in header if c not in EVENT_COLUMNS]
    if extra:
        return [], [f"unexpected columns: {', '.join(extra)}; the judge event format has eight columns"]
    reader.fieldnames = header
    rows = []
    for row_number, row in enumerate(reader, start=2):
        if None in row:
            return [], [f"row {row_number} has more values than the eight-column header"]
        if any((v or "").strip() for v in row.values() if isinstance(v, str)):
            rows.append(row)
    return rows, []
