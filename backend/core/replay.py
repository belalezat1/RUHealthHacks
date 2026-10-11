"""Rebuild physician state and consult state from the event stream.

Physician activity and consult lifecycle are tracked independently. Events are applied
in event_time order (not arrival order); a historical replay only sees events whose
event_time AND ingested_at are at or before the cutoff, so it never uses knowledge
that had not yet arrived.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from .data import ET, ReferenceData
from .events import Event

if TYPE_CHECKING:
    from .coverage import Commitment

STAGES = (
    "Received", "Triaged", "Assigned", "Provider Contacted", "CT/CTA or Imaging Pending",
    "Imaging Review", "Video Consult In Progress", "Note Pending", "Documentation", "Signed Off",
)
STAGE_RANK = {s: i for i, s in enumerate(STAGES)}
OPEN_NOTE_STAGES = ("Note Pending", "Documentation")
POST_CALL_COOLDOWN = timedelta(minutes=2)

# Stage an event moves a consult to. Stages only ever advance, so a follow-up call
# (e.g. "Provider calls hospital to check CT/CTA status") never moves a consult backward.
EVENT_STAGE = {
    "consult_received": "Received",
    "consult_triaged": "Triaged",
    "physician_assigned": "Assigned",
    "incoming_call_started": "Provider Contacted",
    "outgoing_call_started": "Provider Contacted",
    "imaging_requested": "CT/CTA or Imaging Pending",
    "imaging_returned": "Imaging Review",
    "video_started": "Video Consult In Progress",
    "video_ended": "Note Pending",
    "note_started": "Documentation",
    "note_signed": "Signed Off",
}


@dataclass
class ConsultState:
    consult_id: str
    hospital_id: str
    consult_type: str  # "Stroke" | "General Neuro" | "Unknown"
    received_at: datetime | None = None
    physician_id: str | None = None
    stage: str = "Received"
    stage_entered_at: datetime | None = None
    clinical_end_at: datetime | None = None  # end of video or phone-only call: documentation clock origin
    clinical_end_reason: str = ""
    phone_only: bool = False
    routing_failures: int = 0
    last_routing_failure_at: datetime | None = None
    ringing_physician: str | None = None
    ringing_since: datetime | None = None
    signed_off_at: datetime | None = None
    event_ids: list[str] = field(default_factory=list)
    receipt_event_ids: list[str] = field(default_factory=list)
    conflicting_hospital_ids: set[str] = field(default_factory=set)

    @property
    def is_open(self) -> bool:
        return self.stage != "Signed Off"


@dataclass
class PhysicianState:
    physician_id: str
    status: str = "Available"  # self-reported
    status_signal_at: datetime | None = None
    agent_online: bool = True
    camera_active: bool = False
    camera_signal_at: datetime | None = None
    active_call: tuple[str, str, datetime] | None = None  # (incoming|outgoing, consult_id, started)
    active_video: tuple[str, datetime] | None = None  # (consult_id, started)
    ringing: tuple[str, datetime] | None = None  # (consult_id, since)
    active_calls: dict[tuple[str, str], datetime] = field(default_factory=dict)
    active_videos: dict[str, datetime] = field(default_factory=dict)
    ringing_calls: dict[str, datetime] = field(default_factory=dict)
    last_call_ended_at: datetime | None = None
    last_answered_at: datetime | None = None
    shift_started_at: datetime | None = None
    consults_this_shift: set[str] = field(default_factory=set)
    calls_this_shift: int = 0
    assignment_history: list[tuple[datetime, str]] = field(default_factory=list)
    call_history: list[datetime] = field(default_factory=list)
    online_evidence: list[tuple[datetime, str, str]] = field(default_factory=list)
    conflicting_signals: dict[str, tuple[datetime, tuple[str, ...]]] = field(default_factory=dict)


@dataclass
class State:
    as_of: datetime
    consults: dict[str, ConsultState]
    physicians: dict[str, PhysicianState]
    events_applied: int
    events_excluded_future: int
    received_times: dict[str, list[datetime]]  # hospital -> consult received instants
    orphan_event_ids: list[str]
    observed_work_intervals: dict[str, list[tuple[datetime, datetime]]] = field(default_factory=dict)


def _consult_type(description: str) -> str:
    text = description.lower()
    if text.startswith("stroke"):
        return "Stroke"
    if text.startswith("general neuro"):
        return "General Neuro"
    return "Unknown"


def _advance(c: ConsultState, stage: str, at: datetime) -> None:
    if STAGE_RANK[stage] > STAGE_RANK[c.stage] or c.stage_entered_at is None:
        c.stage = stage
        c.stage_entered_at = at


def replay(events: list[Event], ref: ReferenceData, cutoff: datetime) -> State:
    physicians = {pid: PhysicianState(pid) for pid in ref.physicians}
    consults: dict[str, ConsultState] = {}
    received: dict[str, list[datetime]] = {h: [] for h in ref.hospitals}
    orphans: list[str] = []
    applied = excluded = 0

    visible = [e for e in events if e.event_time <= cutoff and e.ingested_at <= cutoff]
    excluded = len(events) - len(visible)
    # Latest records for each independent signal are reconciled as a set. This
    # avoids inventing a winner when equal-time source records disagree.
    signals: dict[tuple[str, str], tuple[datetime, dict[str, list[str]]]] = {}
    work_intervals: dict[str, list[tuple[datetime, datetime]]] = {p: [] for p in physicians}
    work_starts: dict[tuple[str, str], datetime] = {}
    for ev in sorted(visible, key=Event.sort_key):
        applied += 1
        t = ev.event_time
        p = physicians.get(ev.physician_id) if ev.physician_id else None
        c = consults.get(ev.consult_id) if ev.consult_id else None
        et = ev.event_type

        channel = value = None
        if p:
            if et == "physician_status_changed":
                channel, value = "status", ev.description.split(":", 1)[-1].strip()
            elif et in ("camera_active", "camera_inactive"):
                channel, value = "camera", et
            elif et in ("incoming_call_started", "outgoing_call_started", "incoming_call_ended", "outgoing_call_ended"):
                channel, value = "call", "started" if et.endswith("started") else "ended"
            elif et in ("video_started", "video_ended"):
                channel, value = "video", et
            if channel:
                key = (p.physician_id, channel)
                if key not in signals or signals[key][0] < t:
                    signals[key] = (t, {})
                signals[key][1].setdefault(value, []).append(ev.event_id)
            if et in ("shift_started", "incoming_call_started", "outgoing_call_started", "video_started"):
                p.online_evidence.append((t, ev.event_id, et))
            work_channel = ("shift" if et == "shift_started" else
                            "incoming_call:" + ev.consult_id if et.startswith("incoming_call_") else
                            "outgoing_call:" + ev.consult_id if et.startswith("outgoing_call_") else
                            "video:" + ev.consult_id if et.startswith("video_") else None)
            if work_channel and et.endswith(("started", "ended")):
                key = (p.physician_id, work_channel)
                if et.endswith("started"):
                    work_starts.setdefault(key, t)
                elif key in work_starts:
                    work_intervals[p.physician_id].append((work_starts.pop(key), t))

        if et == "consult_received":
            c = consults.setdefault(ev.consult_id, ConsultState(ev.consult_id, ev.hospital_id, _consult_type(ev.description)))
            c.receipt_event_ids.append(ev.event_id)
            if c.received_at is None:
                c.hospital_id = ev.hospital_id
                c.consult_type = _consult_type(ev.description)
                c.received_at = t
                received.setdefault(ev.hospital_id, []).append(t)
            elif c.hospital_id != ev.hospital_id:
                c.conflicting_hospital_ids.update({c.hospital_id, ev.hospital_id})
        elif ev.consult_id and c is None:
            # Consult event before its consult_received has arrived: keep it visible but flagged.
            c = consults.setdefault(ev.consult_id, ConsultState(ev.consult_id, ev.hospital_id, "Unknown"))
            orphans.append(ev.event_id)
        if c is not None:
            c.event_ids.append(ev.event_id)

        if et == "shift_started" and p:
            p.shift_started_at = t
            p.consults_this_shift.clear()
            p.calls_this_shift = 0
        elif et == "physician_status_changed" and p:
            p.status = ev.description.split(":", 1)[-1].strip()
            p.status_signal_at = t
        elif et == "agent_heartbeat_lost" and p:
            # No heartbeat-restored event exists in the format; camera state is unknown from here on.
            p.agent_online = False
        elif et in ("camera_active", "camera_inactive") and p:
            p.camera_active = et == "camera_active"
            p.camera_signal_at = t
        elif et == "physician_assigned" and p and c:
            c.physician_id = ev.physician_id
            p.consults_this_shift.add(ev.consult_id)
            p.assignment_history.append((t, ev.consult_id))
        elif et == "incoming_call_ringing" and p and c:
            p.ringing_calls[ev.consult_id] = t
            p.ringing = min(p.ringing_calls.items(), key=lambda item: (item[1], item[0]))
            c.ringing_physician, c.ringing_since = ev.physician_id, t
        elif et in ("incoming_call_started", "outgoing_call_started") and p:
            kind = "incoming" if et.startswith("incoming") else "outgoing"
            p.active_calls[(kind, ev.consult_id)] = t
            (kind, cid), started = min(p.active_calls.items(), key=lambda item: (item[1], item[0]))
            p.active_call = (kind, cid, started)
            p.calls_this_shift += 1
            p.call_history.append(t)
            p.last_answered_at = t
            p.ringing_calls.pop(ev.consult_id, None)
            p.ringing = min(p.ringing_calls.items(), key=lambda item: (item[1], item[0])) if p.ringing_calls else None
            if c and c.ringing_physician == ev.physician_id:
                c.ringing_physician = c.ringing_since = None
        elif et in ("incoming_call_ended", "outgoing_call_ended") and p:
            kind = "incoming" if et.startswith("incoming") else "outgoing"
            p.active_calls.pop((kind, ev.consult_id), None)
            if p.active_calls:
                (kind, cid), started = min(p.active_calls.items(), key=lambda item: (item[1], item[0]))
                p.active_call = (kind, cid, started)
            else:
                p.active_call = None
            p.last_call_ended_at = t
            if c and "phone-only" in ev.description.lower():
                # Description-based inference: the synthetic format has no explicit phone-only flag.
                c.phone_only = True
                c.clinical_end_at, c.clinical_end_reason = t, "phone-only call ended"
                _advance(c, "Note Pending", t)
        elif et == "video_started" and p:
            p.active_videos[ev.consult_id] = t
            p.active_video = min(p.active_videos.items(), key=lambda item: (item[1], item[0]))
        elif et == "video_ended" and p:
            p.active_videos.pop(ev.consult_id, None)
            p.active_video = min(p.active_videos.items(), key=lambda item: (item[1], item[0])) if p.active_videos else None
            if c:
                c.clinical_end_at, c.clinical_end_reason = t, "video ended"
        elif et == "routing_attempt_failed" and c:
            c.routing_failures += 1
            c.last_routing_failure_at = t
        elif et == "note_signed" and c:
            c.signed_off_at = t

        stage = EVENT_STAGE.get(et)
        if c is not None and stage:
            if et == "consult_received":
                # A hospital retry never regresses clinical stage or its clock.
                if c.stage_entered_at is None:
                    c.stage_entered_at = t
            else:
                _advance(c, stage, t)

    for (pid, channel), (at, values) in signals.items():
        if len(values) > 1:
            physicians[pid].conflicting_signals[channel] = (
                at, tuple(sorted(eid for ids in values.values() for eid in ids)))
    for (pid, channel), start in work_starts.items():
        stop = cutoff
        if channel == "shift":
            intervals = ref.physicians[pid].scheduled_intervals()
            stop = min([cutoff] + [end for begin, end in intervals if begin <= start < end])
        if start < stop:
            work_intervals[pid].append((start, stop))

    return State(as_of=cutoff, consults=consults, physicians=physicians, events_applied=applied,
                 events_excluded_future=excluded, received_times=received, orphan_event_ids=orphans,
                 observed_work_intervals=work_intervals)


# ---------------------------------------------------------------------------
# Derived physician activity
# ---------------------------------------------------------------------------

def on_shift(ref: ReferenceData, physician_id: str, at: datetime) -> bool:
    phy = ref.physicians[physician_id]
    return any(start <= at < end for start, end in phy.scheduled_intervals())


def current_shift(ref: ReferenceData, physician_id: str, at: datetime) -> tuple[datetime, datetime] | None:
    for start, end in ref.physicians[physician_id].scheduled_intervals():
        if start <= at < end:
            return start, end
    return None


def open_consults_for(state: State, physician_id: str) -> list[ConsultState]:
    return [c for c in state.consults.values() if c.is_open and c.physician_id == physician_id]


def derived_state(state: State, ref: ReferenceData, physician_id: str, *, active_commitment: "Commitment | None" = None) -> str:
    p = state.physicians[physician_id]
    if not on_shift(ref, physician_id, state.as_of) and active_commitment is None:
        return "Off Shift"
    if p.status == "Temporarily Unavailable":
        return "Temporarily Unavailable"
    if p.active_call:
        return "Incoming Hospital Call" if p.active_call[0] == "incoming" else "Outgoing Hospital Call"
    if p.active_video:
        return "Video Consult In Progress"
    if p.conflicting_signals:
        return "Availability Unverified"
    if p.agent_online and p.camera_active and p.status != "In Meeting":
        return "Camera Active - No Synapse Session"
    if p.status == "In Meeting":
        return "In Meeting"
    if any(c.stage == "Documentation" for c in open_consults_for(state, physician_id)):
        return "Documentation / Note"
    return "Available"


def availability(state: State, ref: ReferenceData, physician_id: str, *, active_commitment: "Commitment | None" = None) -> dict:
    """Reconcile the signals into a routing-relevant availability record."""
    p = state.physicians[physician_id]
    ds = derived_state(state, ref, physician_id, active_commitment=active_commitment)
    busy = ds in ("Incoming Hospital Call", "Outgoing Hospital Call", "Video Consult In Progress",
                  "Camera Active - No Synapse Session")
    unavailable = ds in ("Temporarily Unavailable", "Off Shift", "Availability Unverified")
    cooldown_until = p.last_call_ended_at + POST_CALL_COOLDOWN if p.last_call_ended_at else None
    in_cooldown = bool(cooldown_until and state.as_of < cooldown_until)
    flags = []
    evidence = p.online_evidence
    if active_commitment is not None:
        evidence = [e for e in evidence if active_commitment.start <= e[0] < active_commitment.end]
        if not evidence:
            unavailable = True
            flags.append("Accepted offer and ETA are planned capacity; imported online evidence is still required")
    if p.conflicting_signals:
        flags.append("Equal-time availability records conflict; no source winner is assumed")
    if len(p.active_calls) > 1 or len(p.active_videos) > 1:
        flags.append("Multiple active operational interactions remain recorded; ending one cannot free this physician")
    if ds == "Camera Active - No Synapse Session":
        flags.append("Camera active with no Synapse session: probable external video, treated as busy")
    if not p.agent_online and ds not in ("Off Shift",):
        flags.append("Desktop presence agent offline: camera state unknown, availability unverified")
    if ds == "In Meeting" and p.camera_active and p.agent_online:
        flags.append("Camera active while In Meeting: internal meeting, interruptible")
    return {
        "derived_state": ds,
        "busy": busy,
        "unavailable": unavailable,
        "ringing": p.ringing[0] if p.ringing else None,
        "in_cooldown": in_cooldown,
        "cooldown_until": cooldown_until,
        "verified": p.agent_online and bool(evidence) and not p.conflicting_signals,
        "verification_basis": "imported operational participation (shift/call/video start), challenge presence assumption until heartbeat loss; not a live desktop heartbeat",
        "desktop_presence_basis": "challenge assumes agent online until supplied heartbeat loss" if p.agent_online else "supplied heartbeat loss; camera presence remains unverified",
        "online_evidence_event_ids": [e[1] for e in evidence],
        "conflicting_signal_event_ids": sorted({eid for _, ids in p.conflicting_signals.values() for eid in ids}),
        "routable": not (busy or unavailable or p.ringing or in_cooldown),
        "flags": flags,
    }


def fmt_et_time(dt: datetime | None) -> str:
    return dt.astimezone(ET).strftime("%H:%M:%S") if dt else ""


def minutes_between(start: datetime | None, end: datetime) -> int | None:
    if start is None:
        return None
    return int((end - start).total_seconds() // 60)
