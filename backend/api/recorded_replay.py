"""Private, temporary recorded-data previews. Never write operational state."""
from __future__ import annotations

import asyncio
import json
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from starlette.concurrency import run_in_threadpool

from ..core.events import Event
from ..core.replay import replay, availability, on_shift
from ..core.report import build_report
from ..core.routing import route_order, DAY_LOW_VOLUME, NIGHT_LOW_VOLUME
from ..core.staffing import EMPTY_LEDGER
from .auth import Identity
from .service import ApiError, Service, require_role
from .finance import financial_capability
from .store import SCHEMA_VERSION


@dataclass
class Snapshot:
    replay_id: str
    owner: str
    created: float
    run: dict
    receipt: dict
    events: tuple[Event, ...]
    imported: tuple[Event, ...]
    timeline: list[datetime]
    hospital_id: str
    frames: dict[int, dict] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class RecordedReplay:
    def __init__(self, service: Service, engine, clock=time.monotonic):
        self.service, self.engine, self.clock = service, engine, clock
        self.snapshots: dict[str, Snapshot] = {}

    def _prune(self):
        self.snapshots = {k: v for k, v in self.snapshots.items() if self.clock() - v.created < 1800}

    def _capture(self, ident: Identity) -> Snapshot:
        service = self.service
        with service.store.read() as conn:
            run = dict(service._current_run(conn))
            row = conn.execute("SELECT * FROM imports WHERE run_id=? ORDER BY created_at DESC, import_id DESC LIMIT 1",
                               (run["run_id"],)).fetchone()
            if row is None:
                raise ApiError(404, "no_import", "Import an event CSV in Scenario lab before starting playback.")
            receipt = dict(row)
            summary = json.loads(receipt["summary"])
            events, by_id = service._events(conn, run)
            metadata = summary.get("replay")
            if metadata:
                ids = metadata["event_ids"]
            else:
                # Legacy summaries truncate duplicates at 50. Do not guess missing membership.
                duplicates = summary.get("duplicate_ids", [])
                if summary.get("duplicates", 0) > len(duplicates):
                    raise ApiError(422, "replay_membership_missing",
                                   "This older import has incomplete replay metadata. Reimport the same CSV to enable playback.")
                accepted = conn.execute("SELECT event_id FROM events WHERE run_id=? AND import_id=? ORDER BY seq",
                                        (run["run_id"], receipt["import_id"])).fetchall()
                if len(accepted) != summary.get("accepted", 0):
                    raise ApiError(422, "replay_membership_missing", "Reimport the same CSV to restore complete replay metadata.")
                ids = list(dict.fromkeys([r["event_id"] for r in accepted] + duplicates))
            if not ids or any(pid not in by_id for pid in ids):
                raise ApiError(422, "replay_membership_missing", "Reimport the same CSV to restore its recorded replay.")
            imported = tuple(by_id[pid] for pid in ids)
        timeline = sorted({event.ingested_at for event in imported})
        if timeline[0] < service.ref.supported_start or timeline[-1] >= service.ref.supported_end:
            raise ApiError(422, "unsupported_time", "The imported timeline is outside the supplied schedule window.")
        receipt["summary"] = {k: v for k, v in summary.items() if k != "replay"}
        receipt["input_sha256"] = metadata.get("input_sha256") if metadata else None
        receipt["membership_recovered"] = metadata is None
        hospital = next((e.hospital_id for e in sorted(imported, key=lambda e: (e.ingested_at, e.sort_key()))
                         if e.hospital_id), next(iter(service.ref.hospitals)))
        return Snapshot("RPL-" + secrets.token_hex(16), ident.username, self.clock(), run, receipt,
                        tuple(events), imported, timeline, hospital)

    def _check(self, snap: Snapshot):
        state = self.service.state()
        with self.service.store.read() as conn:
            latest = conn.execute("SELECT import_id FROM imports WHERE run_id=? ORDER BY created_at DESC, import_id DESC LIMIT 1",
                                  (state["run_id"],)).fetchone()
        if (state["run_id"] != snap.run["run_id"] or state["revision"] != snap.run["revision"]
                or latest is None or latest["import_id"] != snap.receipt["import_id"]):
            raise ApiError(409, "replay_changed", "The current run changed. Return to current state and load the latest import.")

    def _project(self, snap: Snapshot, index: int):
        at = snap.timeline[index] if index >= 0 else snap.timeline[0] - timedelta(microseconds=1)
        ref = self.service.ref
        # Empty operational ledger is intentional: this is a CSV-only reconstruction.
        report = build_report(list(snap.events), ref, at, EMPTY_LEDGER, original_run=False)
        report.update({"run": {"run_id": snap.run["run_id"], "revision": snap.run["revision"],
                              "label": "Recorded CSV replay", "has_imports": True, "created_at": snap.run["created_at"]},
                       "runs": [], "offers": [], "gaps": [], "actions": [], "audit_tail": [],
                       "imports": [snap.receipt],
                       "evidence": {"release_sha": self.service.release_sha, "schema_version": SCHEMA_VERSION,
                                    "source_hashes": ref.source_hashes, "projection_cache_hit": False,
                                    "finance": financial_capability(), "partners": {}}})
        state = replay(list(snap.events), ref, at)
        routing = {}
        for hid in ref.hospitals:
            order = route_order(state, ref, hid, [])
            evidence = []
            for pid, phy in sorted(ref.physicians.items()):
                a = availability(state, ref, pid)
                p = state.physicians[pid]
                reasons = []
                if not ref.credentialed(pid, hid):
                    reasons.append("Not credentialed at this hospital")
                if not on_shift(ref, pid, at):
                    reasons.append("Not on shift")
                if a["busy"]:
                    reasons.append("Busy")
                if a["ringing"]:
                    reasons.append("Ringing")
                if a["in_cooldown"]:
                    reasons.append("Within two-minute cooldown")
                if not a["routable"] and not reasons:
                    reasons.append(a["derived_state"])
                evidence.append({"physician_id": pid, "name": phy.name, "eligible": not reasons,
                                 "reasons": reasons, "consults_this_shift": len(p.consults_this_shift),
                                 "last_answered_at": p.last_answered_at.isoformat() if p.last_answered_at else None,
                                 "low_volume_threshold": NIGHT_LOW_VOLUME if phy.is_night else DAY_LOW_VOLUME,
                                 "presence_verified": a["verified"], "flags": a["flags"]})
            routing[hid] = {"hospital_name": ref.hospitals[hid].name, "selected": order[0] if order else None,
                            "order": order, "evidence": evidence}
        return report, routing

    async def latest(self, ident: Identity) -> dict:
        require_role(ident, "coordinator", "clinical_lead")
        snap = await run_in_threadpool(self._capture, ident)
        self._check(snap)
        self._prune()
        # One active preview per user; expired snapshots and frame caches are released.
        self.snapshots = {k: v for k, v in self.snapshots.items() if v.owner != ident.username}
        self.snapshots[snap.replay_id] = snap
        baseline = await self.frame(ident, snap.replay_id, -1)
        return {"replay_id": snap.replay_id, "run_id": snap.run["run_id"], "revision": snap.run["revision"],
                "filename": snap.receipt["filename"], "import_id": snap.receipt["import_id"],
                "input_sha256": snap.receipt["input_sha256"], "summary": snap.receipt["summary"],
                "default_hospital_id": snap.hospital_id, "timeline": [at.isoformat() for at in snap.timeline],
                "baseline": baseline, "expires_in_seconds": 1800, "preview_only": True}

    async def frame(self, ident: Identity, replay_id: str, index: int) -> dict:
        require_role(ident, "coordinator", "clinical_lead")
        self._prune()
        snap = self.snapshots.get(replay_id)
        if snap is None or snap.owner != ident.username:
            raise ApiError(404, "replay_expired", "Replay expired or unavailable. Load the latest import again.")
        if index < -1 or index >= len(snap.timeline):
            raise ApiError(422, "invalid_frame", "Frame index is outside the imported timeline.")
        self._check(snap)
        async with snap.lock:
            self._check(snap)
            if index not in snap.frames:
                report, routing = await run_in_threadpool(self._project, snap, index)
                decision = await self.engine.select(report, run_id=snap.run["run_id"], revision=snap.run["revision"])
                self._check(snap)  # Provider latency must not return a stale result.
                decision = {**decision, "preview_only": True}
                # A preview ID is deliberately never entered in the executable decisions table.
                decision["decision_id"] = "RPLDEC-" + secrets.token_hex(12)
                snap.frames[index] = {"index": index, "as_of": report["as_of"], "report": report,
                                      "routing": routing, "decision": decision, "preview_only": True,
                                      "events": [e.to_row() for e in snap.imported if index >= 0 and e.ingested_at == snap.timeline[index]]}
            return snap.frames[index]
