"""Domain operations on top of the engine and the durable store.

Every mutation:
  * requires an Idempotency-Key (a retry returns the original result),
  * requires the expected run id + revision (a stale write gets 409 with the current revision),
  * derives the actor from the server session,
  * commits operational state + audit in one transaction, then invalidates the projection cache.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timedelta
from dataclasses import replace
from contextlib import nullcontext
from typing import Callable

from ..core.coverage import Commitment, project_hospital
from ..core.data import ET, SCENARIO_NOW, SUPPORTED_END, ReferenceData
from ..core.events import Event, event_from_row, read_csv_text, validate_batch
from ..core.replay import replay, on_shift, availability
from ..core.report import build_report, eligible_reassignment_targets
from ..core.staffing import OfferLedgerView, evaluate_candidate, week_key
from .auth import Identity
from .finance import financial_capability
from .store import SCHEMA_VERSION, Store, audit, dumps, utc_now

OFFER_EXPIRY = timedelta(minutes=10)
OPEN_OFFER_STATUSES = ("proposed", "approved", "sent")
WAITING_STAGES = ("Received", "Triaged", "Assigned")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, **extra):
        super().__init__(message)
        self.status, self.code, self.message, self.extra = status, code, message, extra


def _new_id(prefix: str) -> str:
    return f"{prefix}-{datetime.now(ET):%H%M%S}-{secrets.token_hex(3).upper()}"


def require_role(ident: Identity, *roles: str) -> None:
    if ident.role not in roles:
        raise ApiError(403, "forbidden", f"Role '{ident.role}' cannot perform this action")


class Service:
    def __init__(self, ref: ReferenceData, store: Store, release_sha: str = "dev", policy_mode: str = "challenge"):
        self.ref = ref
        self.store = store
        self.release_sha = release_sha
        self.policy_mode = policy_mode
        self.ready = False
        self._cache_lock = threading.Lock()
        self._events_cache: dict[str, tuple[int, list[Event], dict[str, Event]]] = {}
        self._report_cache: tuple[tuple, dict] | None = None
        text = (ref.data_dir / "event_stream.csv").read_text(encoding="utf-8")
        rows, header_errors = read_csv_text(text)
        if header_errors:
            raise RuntimeError(f"original event stream invalid: {header_errors}")
        batch = validate_batch(rows, ref, {})
        if not batch.ok:
            raise RuntimeError(f"original event stream invalid: {batch.errors[:3]}")
        self.original_events = batch.accepted
        self.original_duplicates = batch.duplicates

    # ------------------------------------------------------------------ lifecycle
    def startup(self) -> None:
        """Ensure a current run exists and rebuild its projection from durable state."""
        self.ready = False
        with self.store.tx() as conn:
            if self._current_run(conn, required=False) is None:
                self._create_run(conn, actor="system", role="system", label="Original fixture")
        with self.store.read() as conn:
            run = self._current_run(conn)
        self._report_for_run(run)  # warm projection; raises if state is unusable
        self.ready = True

    # ------------------------------------------------------------------ helpers
    def _current_run(self, conn: sqlite3.Connection, required: bool = True) -> sqlite3.Row | None:
        row = conn.execute("SELECT * FROM runs WHERE is_current=1").fetchone()
        if row is None and required:
            raise ApiError(503, "no_run", "No current scenario run")
        return row

    def _create_run(self, conn: sqlite3.Connection, actor: str, role: str, label: str) -> str:
        run_id = _new_id("RUN")
        conn.execute("UPDATE runs SET is_current=0 WHERE is_current=1")
        conn.execute(
            "INSERT INTO runs(run_id, label, created_at, scenario_clock, revision, event_revision, has_imports, "
            "is_current, source_manifest) VALUES (?,?,?,?,?,?,?,?,?)",
            (run_id, label, utc_now(), self.ref.scenario_now.isoformat(), 1, 1, 0, 1, dumps(self.ref.source_hashes)),
        )
        conn.executemany(
            "INSERT INTO events(run_id, event_id, event_time, ingested_at, consult_id, event_type, physician_id, "
            "hospital_id, description, content_hash, import_id, seq) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            [(run_id, e.event_id, e.event_time.isoformat(), e.ingested_at.isoformat(), e.consult_id, e.event_type,
              e.physician_id, e.hospital_id, e.description, e.content_hash(), "ORIGINAL", i)
             for i, e in enumerate(self.original_events)],
        )
        audit(conn, run_id=run_id, revision=1, scenario_time=self.ref.scenario_now.isoformat(), actor=actor, role=role,
              kind="run_created", entity=run_id,
              detail={"label": label, "events": len(self.original_events),
                      "duplicates_skipped": self.original_duplicates, "source_hashes": self.ref.source_hashes})
        return run_id

    def _bump(self, conn: sqlite3.Connection, run_id: str, **fields) -> int:
        sets = ", ".join(["revision = revision + 1"] + [f"{k} = ?" for k in fields])
        conn.execute(f"UPDATE runs SET {sets} WHERE run_id=?", (*fields.values(), run_id))
        return conn.execute("SELECT revision FROM runs WHERE run_id=?", (run_id,)).fetchone()["revision"]

    def _events(self, conn: sqlite3.Connection, run: sqlite3.Row) -> tuple[list[Event], dict[str, Event]]:
        key = run["run_id"]
        with self._cache_lock:
            cached = self._events_cache.get(key)
            if cached and cached[0] == run["event_revision"]:
                return cached[1], cached[2]
        rows = conn.execute("SELECT * FROM events WHERE run_id=? ORDER BY seq", (key,)).fetchall()
        events = [event_from_row(dict(r)) for r in rows]
        by_id = {e.event_id: e for e in events}
        with self._cache_lock:
            self._events_cache = {key: (run["event_revision"], events, by_id)}
        return events, by_id

    def _ledger(self, conn: sqlite3.Connection, run_id: str, exclude_offer: str | None = None) -> OfferLedgerView:
        rows = conn.execute("SELECT * FROM offers WHERE run_id=?", (run_id,)).fetchall()
        open_ids, accepted, weekly, historical = set(), [], {}, []
        for r in rows:
            if r["offer_id"] == exclude_offer:
                continue
            if r["status"] in OPEN_OFFER_STATUSES:
                open_ids.add(r["physician_id"])
            if r["status"] == "accepted":
                accepted.append(self._commitment(r))
            elif r["status"] == "cancelled" and r["responded_at"] and r["online_at"]:
                historical.append(self._commitment(r))
            if r["sent_at"]:
                k = (r["physician_id"], week_key(datetime.fromisoformat(r["sent_at"])))
                weekly[k] = weekly.get(k, 0) + 1
        return OfferLedgerView(frozenset(open_ids), tuple(accepted), weekly, self.policy_mode,
                               historical_reservations=tuple(historical))

    @staticmethod
    def _commitment(r: sqlite3.Row) -> Commitment:
        return Commitment(r["physician_id"], frozenset(json.loads(r["hospitals"])),
                          datetime.fromisoformat(r["window_start"]), datetime.fromisoformat(r["window_end"]),
                          datetime.fromisoformat(r["online_at"]), r["offer_id"])

    def _clock(self, run: sqlite3.Row) -> datetime:
        return datetime.fromisoformat(run["scenario_clock"])

    def _audit(self, conn, run_id: str, revision: int, clock: str, ident: Identity, kind: str, entity: str,
               detail: dict) -> None:
        audit(conn, run_id=run_id, revision=revision, scenario_time=clock, actor=ident.username, role=ident.role,
              kind=kind, entity=entity, detail=detail)

    def invalidate(self) -> None:
        with self._cache_lock:
            self._report_cache = None

    # ------------------------------------------------------------------ mutation wrapper
    def replay_request(self, ident: Identity, idem_key: str | None, route: str,
                       expected_run: str | None, request_hash: str) -> dict | None:
        if not idem_key or len(idem_key) > 200:
            raise ApiError(400, "idempotency_key_required", "Idempotency-Key header is required for writes")
        with self.store.read() as conn:
            prior = conn.execute("SELECT * FROM idempotency WHERE username=? AND key=?",
                                 (ident.username, idem_key)).fetchone()
        if prior is None:
            return None
        if prior["route"] != route or prior["run_id"] != (expected_run or "") or prior["request_hash"] != request_hash:
            raise ApiError(409, "idempotency_key_reused", "Idempotency-Key was already used with different action, run or material terms")
        return json.loads(prior["response"]) | {"idempotent_replay": True}

    def mutate(self, ident: Identity, idem_key: str | None, route: str, expected_run: str | None,
               expected_revision: int | None, fn: Callable[[sqlite3.Connection, sqlite3.Row], dict],
               request_hash: str = "") -> dict:
        if not idem_key or len(idem_key) > 200:
            raise ApiError(400, "idempotency_key_required", "Idempotency-Key header is required for writes")
        with self.store.tx() as conn:
            prior = conn.execute("SELECT * FROM idempotency WHERE username=? AND key=?",
                                 (ident.username, idem_key)).fetchone()
            if prior is not None:
                if prior["route"] != route or prior["run_id"] != (expected_run or "") or prior["request_hash"] != request_hash:
                    raise ApiError(409, "idempotency_key_reused", "Idempotency-Key was already used with different action, run or material terms")
                body = json.loads(prior["response"])
                body["idempotent_replay"] = True
                return body
            run = self._current_run(conn)
            if expected_run != run["run_id"] or expected_revision != run["revision"]:
                raise ApiError(409, "stale_revision", "State changed since you loaded it; review and retry",
                               current_run_id=run["run_id"], current_revision=run["revision"])
            result = fn(conn, run)
            after = conn.execute("SELECT run_id, revision, scenario_clock FROM runs WHERE is_current=1").fetchone()
            body = {"result": result, "run_id": after["run_id"], "revision": after["revision"],
                    "as_of": after["scenario_clock"]}
            conn.execute("INSERT INTO idempotency(username, key, route, status_code, response, created_at, run_id, request_hash) "
                         "VALUES (?,?,?,?,?,?,?,?)", (ident.username, idem_key, route, 200, dumps(body), utc_now(),
                                                   expected_run, request_hash))
        self.invalidate()
        return body

    def record_decision(self, conn, run, ident: Identity, decision: dict) -> dict:
        require_role(ident, "coordinator", "clinical_lead")
        if decision["run_id"] != run["run_id"] or decision["revision"] != run["revision"]:
            raise ApiError(409, "stale_decision", "State changed while the provider was selecting")
        conn.execute("INSERT INTO decisions(decision_id,run_id,revision,actor,created_at,detail) VALUES(?,?,?,?,?,?)",
                     (decision["decision_id"], run["run_id"], run["revision"], ident.username, utc_now(), dumps(decision)))
        self._audit(conn, run["run_id"], run["revision"], run["scenario_clock"], ident,
                    "decision_previewed", decision["decision_id"], decision)
        return decision

    def actionlab(self, ident: Identity) -> dict:
        require_role(ident, "coordinator", "clinical_lead")
        from ..intelligence.actionlab import build_actionlab
        with self.store.read() as conn:
            run = self._current_run(conn)
            events, _ = self._events(conn, run)
            ledger = self._ledger(conn, run["run_id"])
            saved = conn.execute("SELECT detail FROM decisions WHERE run_id=? AND revision=? ORDER BY created_at DESC LIMIT 1",
                                 (run["run_id"], run["revision"])).fetchone()
            report, _ = self._report_for_run(run, conn)
        return build_actionlab(events, self.ref, self._clock(run), ledger=ledger, report=report,
                               decision=json.loads(saved["detail"]) if saved else None,
                               run_id=run["run_id"], revision=run["revision"])

    # ------------------------------------------------------------------ reads
    def state(self) -> dict:
        with self.store.read() as conn:
            run = self._current_run(conn)
        return {"run_id": run["run_id"], "revision": run["revision"], "as_of": run["scenario_clock"],
                "label": run["label"], "release_sha": self.release_sha, "schema_version": SCHEMA_VERSION}

    def _report_for_run(self, run: sqlite3.Row, connection=None) -> tuple[dict, bool]:
        key = (run["run_id"], run["revision"])
        with self._cache_lock:
            if self._report_cache and self._report_cache[0] == key:
                return self._report_cache[1], True
        with nullcontext(connection) if connection is not None else self.store.read() as conn:
            current = self._current_run(conn)
            if current["run_id"] != run["run_id"] or current["revision"] != run["revision"]:
                raise ApiError(409, "projection_changed", "State changed during projection; refresh")
            events, _ = self._events(conn, run)
            ledger = self._ledger(conn, run["run_id"])
            report = build_report(events, self.ref, self._clock(run), ledger, original_run=not run["has_imports"])
        with self._cache_lock:
            self._report_cache = (key, report)
        return report, False

    def report(self, ident: Identity) -> dict:
        require_role(ident, "coordinator", "clinical_lead")
        with self.store.read() as conn:
            run = self._current_run(conn)
            report, cache_hit = self._report_for_run(run, conn)
            offers = [self._offer_staff(r) for r in conn.execute(
                "SELECT * FROM offers WHERE run_id=? ORDER BY proposed_at, offer_id", (run["run_id"],))]
            gaps = [self._gap(conn, r) for r in conn.execute(
                "SELECT * FROM gaps WHERE run_id=? ORDER BY created_at", (run["run_id"],))]
            actions = [self._action(r) for r in conn.execute(
                "SELECT * FROM actions WHERE run_id=? ORDER BY created_at, action_id", (run["run_id"],))]
            audit_tail = [self._audit_row(r) for r in conn.execute(
                "SELECT * FROM audit WHERE run_id=? ORDER BY seq DESC LIMIT 60", (run["run_id"],))]
            imports = [dict(r) | {"summary": json.loads(r["summary"])} for r in conn.execute(
                "SELECT * FROM imports WHERE run_id=? ORDER BY created_at", (run["run_id"],))]
            for receipt in imports:
                receipt["summary"].pop("replay", None)
            runs = [dict(r) | {"source_manifest": None} for r in conn.execute(
                "SELECT run_id, label, created_at, revision, is_current, has_imports FROM runs ORDER BY created_at DESC")]
        reassigned = {a["consult_id"]: a for a in actions if a["kind"] == "reassignment"}
        consults = [c | {"modeled_reassignment": reassigned.get(c["consult_id"])} for c in report["consults"]]
        return {
            **report,
            "consults": consults,
            "run": {"run_id": run["run_id"], "label": run["label"], "revision": run["revision"],
                    "has_imports": bool(run["has_imports"]), "created_at": run["created_at"]},
            "runs": runs,
            "offers": offers,
            "gaps": gaps,
            "actions": actions,
            "audit_tail": audit_tail,
            "imports": imports,
            "evidence": {
                "release_sha": self.release_sha,
                "schema_version": SCHEMA_VERSION,
                "source_hashes": self.ref.source_hashes,
                "projection_cache_hit": cache_hit,
                "finance": financial_capability(),
                "partners": {"vlada": "not connected", "elevenlabs": "not connected"},
            },
        }

    def _offer_staff(self, r: sqlite3.Row) -> dict:
        d = dict(r)
        d["hospitals"] = json.loads(r["hospitals"])
        d["hospital_names"] = [self.ref.hospitals[h].name for h in d["hospitals"]]
        d["rationale"] = json.loads(r["rationale"])
        d["candidate_audit"] = json.loads(r["candidate_audit"])
        d["physician_name"] = self.ref.physicians[r["physician_id"]].name
        return d

    def _offer_physician(self, r: sqlite3.Row, clock: datetime) -> dict:
        """Physician-facing view: hospital names, hours, start time and status only."""
        hospitals = json.loads(r["hospitals"])
        start, end = datetime.fromisoformat(r["window_start"]), datetime.fromisoformat(r["window_end"])
        secs_left = None
        if r["status"] == "sent" and r["expires_at"]:
            secs_left = max(0, int((datetime.fromisoformat(r["expires_at"]) - clock).total_seconds()))
        return {
            "offer_id": r["offer_id"],
            "hospital_names": [self.ref.hospitals[h].name for h in hospitals],
            "start": r["window_start"],
            "end": r["window_end"],
            "hours": round((end - start).total_seconds() / 3600, 2),
            "status": r["status"],
            "status_reason": r["status_reason"] if r["status"] in ("cancelled", "expired") else "",
            "sent_at": r["sent_at"],
            "expires_at": r["expires_at"],
            "seconds_left_scenario": secs_left,
            "online_at": r["online_at"],
        }

    def _gap(self, conn, r: sqlite3.Row) -> dict:
        claims = conn.execute("SELECT * FROM gap_claims WHERE gap_id=? ORDER BY slot", (r["gap_id"],)).fetchall()
        return dict(r) | {"hospitals": json.loads(r["hospitals"]), "claims": [dict(c) for c in claims]}

    @staticmethod
    def _action(r: sqlite3.Row) -> dict:
        return dict(r) | {"detail": json.loads(r["detail"])}

    @staticmethod
    def _audit_row(r: sqlite3.Row) -> dict:
        return dict(r) | {"detail": json.loads(r["detail"])}

    def physician_offers(self, ident: Identity) -> dict:
        require_role(ident, "physician")
        with self.store.read() as conn:
            run = self._current_run(conn)
            rows = conn.execute(
                "SELECT * FROM offers WHERE run_id=? AND physician_id=? AND sent_at IS NOT NULL "
                "ORDER BY sent_at DESC", (run["run_id"], ident.physician_id)).fetchall()
        clock = self._clock(run)
        return {"physician_id": ident.physician_id, "as_of": run["scenario_clock"],
                "run_id": run["run_id"], "revision": run["revision"],
                "offers": [self._offer_physician(r, clock) for r in rows]}

    def audit_csv(self, ident: Identity) -> str:
        require_role(ident, "coordinator", "clinical_lead")
        with self.store.read() as conn:
            run = self._current_run(conn)
            rows = conn.execute("SELECT * FROM audit WHERE run_id=? ORDER BY seq", (run["run_id"],)).fetchall()
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["seq", "run_id", "revision", "wall_time", "scenario_time", "actor", "role", "kind", "entity", "detail"])
        for r in rows:
            w.writerow([r["seq"], r["run_id"], r["revision"], r["wall_time"], r["scenario_time"], r["actor"],
                        r["role"], r["kind"], r["entity"], r["detail"]])
        return buf.getvalue()

    # ------------------------------------------------------------------ mutations
    def _expire_offers(self, conn, run_id: str, revision: int, clock: datetime, ident: Identity) -> list[str]:
        expired = []
        for r in conn.execute("SELECT offer_id, expires_at FROM offers WHERE run_id=? AND status='sent'", (run_id,)):
            if datetime.fromisoformat(r["expires_at"]) <= clock:
                expired.append(r["offer_id"])
        for oid in expired:
            conn.execute("UPDATE offers SET status='expired', status_reason='no response within 10 minutes', "
                         "updated_at=? WHERE offer_id=?", (utc_now(), oid))
            self._audit(conn, run_id, revision, clock.isoformat(), ident, "offer_expired", oid,
                        {"reason": "no response within 10 minutes"})
        return expired

    def advance_clock(self, conn, run, ident: Identity, minutes: float | None, to: str | None) -> dict:
        require_role(ident, "coordinator", "clinical_lead")
        old = self._clock(run)
        if to:
            try:
                new = datetime.fromisoformat(to)
            except ValueError:
                raise ApiError(422, "invalid_time", "Clock target must be an ISO-8601 timestamp with offset")
            if new.tzinfo is None:
                raise ApiError(422, "invalid_time", "Clock target must include a UTC offset")
        elif minutes is not None:
            new = old + timedelta(minutes=minutes)
        else:
            raise ApiError(422, "invalid_request", "Provide minutes or to")
        if new <= old:
            raise ApiError(422, "clock_backwards", "The scenario clock only moves forward; start a new run to reset")
        if new >= self.ref.supported_end:
            raise ApiError(422, "unsupported_time",
                           "The supplied schedule only covers 17 March 2026; times after 18 Mar 07:00 ET are unsupported")
        new = new.astimezone(ET)
        rev = self._bump(conn, run["run_id"], scenario_clock=new.isoformat())
        expired = self._expire_offers(conn, run["run_id"], rev, new, ident)
        self._audit(conn, run["run_id"], rev, new.isoformat(), ident, "clock_advanced", run["run_id"],
                    {"from": old.isoformat(), "to": new.isoformat(), "expired_offers": expired})
        return {"from": old.isoformat(), "to": new.isoformat(), "expired_offers": expired}

    def validate_import(self, ident: Identity, text: str) -> dict:
        require_role(ident, "coordinator")
        rows, header_errors = read_csv_text(text)
        if header_errors:
            return {"ok": False, "header_errors": header_errors}
        with self.store.read() as conn:
            run = self._current_run(conn)
            _, by_id = self._events(conn, run)
        return validate_batch(rows, self.ref, by_id).summary()

    def import_events(self, conn, run, ident: Identity, text: str, filename: str, advance_clock: bool,
                      input_sha256: str | None = None) -> dict:
        require_role(ident, "coordinator")
        rows, header_errors = read_csv_text(text)
        if header_errors:
            raise ApiError(422, "invalid_csv", "; ".join(header_errors), summary={"header_errors": header_errors})
        if not rows:
            raise ApiError(422, "empty_batch", "The CSV contains no event rows")
        _, by_id = self._events(conn, run)
        batch = validate_batch(rows, self.ref, by_id)
        if not batch.ok:
            raise ApiError(422, "invalid_batch", f"{len(batch.errors)} invalid row(s); nothing was imported",
                           summary=batch.summary())
        # Keep full membership, including duplicate-only uploads, for recorded replay.
        # The public summary stays small; this metadata is read only by replay capture.
        receipt_metadata = {
            "event_ids": list(dict.fromkeys(event_from_row(row).event_id for row in rows)),
            "input_sha256": input_sha256 or hashlib.sha256(text.encode("utf-8")).hexdigest(),
        }
        import_id = _new_id("IMP")
        clock = self._clock(run)
        summary = batch.summary()
        summary["clock_advanced_to"] = None
        if not batch.accepted:
            # Pure retry: record the receipt, change nothing else.
            conn.execute("INSERT INTO imports VALUES (?,?,?,?,?,?,?)",
                         (import_id, run["run_id"], utc_now(), ident.username, filename,
                          dumps(summary | {"replay": receipt_metadata}), run["revision"]))
            self._audit(conn, run["run_id"], run["revision"], clock.isoformat(), ident, "import_duplicate_only",
                        import_id, summary)
            return {"import_id": import_id, **summary}
        seq0 = conn.execute("SELECT COALESCE(MAX(seq), -1) + 1 AS s FROM events WHERE run_id=?",
                            (run["run_id"],)).fetchone()["s"]
        conn.executemany(
            "INSERT INTO events(run_id, event_id, event_time, ingested_at, consult_id, event_type, physician_id, "
            "hospital_id, description, content_hash, import_id, seq) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            [(run["run_id"], e.event_id, e.event_time.isoformat(), e.ingested_at.isoformat(), e.consult_id,
              e.event_type, e.physician_id, e.hospital_id, e.description, e.content_hash(), import_id, seq0 + i)
             for i, e in enumerate(batch.accepted)],
        )
        fields = {"event_revision": run["event_revision"] + 1, "has_imports": 1}
        latest = max(e.ingested_at for e in batch.accepted).astimezone(ET)
        if advance_clock and latest > clock:
            if latest >= self.ref.supported_end:
                raise ApiError(422, "unsupported_time", "Batch ingestion time is beyond the supported schedule")
            fields["scenario_clock"] = latest.isoformat()
            summary["clock_advanced_to"] = latest.isoformat()
            clock = latest
        rev = self._bump(conn, run["run_id"], **fields)
        expired = self._expire_offers(conn, run["run_id"], rev, clock, ident)
        summary["expired_offers"] = expired
        not_visible = sum(1 for e in batch.accepted if e.ingested_at > clock or e.event_time > clock)
        summary["not_yet_visible"] = not_visible
        conn.execute("INSERT INTO imports VALUES (?,?,?,?,?,?,?)",
                     (import_id, run["run_id"], utc_now(), ident.username, filename,
                      dumps(summary | {"replay": receipt_metadata}), rev))
        self._audit(conn, run["run_id"], rev, clock.isoformat(), ident, "events_imported", import_id,
                    {**summary, "event_ids": [e.event_id for e in batch.accepted][:200]})
        return {"import_id": import_id, **summary}

    def new_run(self, conn, run, ident: Identity, label: str) -> dict:
        require_role(ident, "coordinator", "clinical_lead")
        run_id = self._create_run(conn, ident.username, ident.role, label or "Fresh original fixture")
        self._audit(conn, run["run_id"], run["revision"], run["scenario_clock"], ident, "run_superseded",
                    run["run_id"], {"new_run_id": run_id})
        return {"new_run_id": run_id, "previous_run_id": run["run_id"]}

    # ---- offers
    def _analysis(self, conn, run, ledger: OfferLedgerView) -> dict:
        events, _ = self._events(conn, run)
        return build_report(events, self.ref, self._clock(run), ledger, original_run=not run["has_imports"])

    def propose(self, conn, run, ident: Identity, physician_ids: list[str] | None, decision_id: str | None = None) -> dict:
        require_role(ident, "coordinator")
        ledger = self._ledger(conn, run["run_id"])
        rep = self._analysis(conn, run, ledger)
        st = rep["staffing"]
        if not st.get("target"):
            raise ApiError(409, "no_gap", "No projected coverage gap needs a split-shift offer")
        by_id = {c["physician_id"]: c for c in st["candidates"]}
        decision = None
        if decision_id:
            saved = conn.execute("SELECT * FROM decisions WHERE decision_id=? AND run_id=?", (decision_id, run["run_id"])).fetchone()
            if saved is None or saved["revision"] != run["revision"] or saved["actor"] != ident.username:
                raise ApiError(409, "stale_decision", "Decision is absent, owned by another actor, or based on an old revision")
            decision = json.loads(saved["detail"])
            action = decision.get("selected_action") or {}
            if action.get("kind") != "scoped_split_shift":
                raise ApiError(409, "decision_requires_escalation", "This decision does not authorize a staffing proposal")
            ids = action.get("physician_ids") or []
            if physician_ids is not None and sorted(set(physician_ids)) != sorted(ids):
                raise ApiError(409, "decision_terms_changed", "Physicians differ from the recorded selected action")
            if (sorted(action.get("offer_hospitals", [])) != sorted(st["gap_hospitals"]) or
                    action.get("window_start") != st["offer_window"]["start"] or
                    action.get("window_end") != st["offer_window"]["end"]):
                raise ApiError(409, "decision_terms_changed", "Decision scope or offered window no longer matches")
        else:
            raise ApiError(409, "decision_required", "Preview a revision-bound staffing decision before proposing")
        if len(ids) != len(set(ids)):
            raise ApiError(422, "duplicate_candidate", "Each physician may appear only once")
        if not ids:
            raise ApiError(409, "no_eligible_candidate", "No eligible off-shift physician reduces the gap; escalate")
        for pid in ids:
            c = by_id.get(pid)
            if c is None:
                raise ApiError(422, "unknown_candidate", f"{pid} is not an off-shift candidate")
            if not c["eligible"]:
                raise ApiError(409, "candidate_ineligible", f"{pid} is not eligible: {'; '.join(c['failed_rules'])}",
                               failed_rules=c["failed_rules"])
        clock = self._clock(run)
        window = st["offer_window"]
        hospitals = st["gap_hospitals"]
        gap = conn.execute("SELECT * FROM gaps WHERE run_id=? AND hospitals=? AND window_start=? AND status='open'",
                           (run["run_id"], dumps(hospitals), window["start"])).fetchone()
        if gap is None:
            gap_id = _new_id("GAP")
            conn.execute("INSERT INTO gaps VALUES (?,?,?,?,?,?,?,?)",
                         (gap_id, run["run_id"], dumps(hospitals), window["start"], window["end"], st["slots"],
                          "open", utc_now()))
        else:
            gap_id = gap["gap_id"]
        rationale = {
            "target": st["target"], "slots": st["slots"], "objective": st["objective"],
            "baseline_deficit_minutes": st["baseline_deficit_minutes"],
            "projected_deficit_minutes_with_selection": st["projected_deficit_minutes"],
            "deficit_minutes_removed": st["deficit_minutes_removed"],
            "residual_peak_deficit": st["residual_peak_deficit"],
            "note": "Deficit physician-minutes are hospital-access coverage, not patient wait time.",
            "decision_id": decision_id, "decision_source": decision.get("source"),
            "selected_action_id": decision.get("selected_action_id"),
        }
        rev = self._bump(conn, run["run_id"])
        created = []
        for pid in ids:
            c = by_id[pid]
            oid = _new_id("OFF")
            conn.execute(
                "INSERT INTO offers(offer_id, run_id, gap_id, physician_id, hospitals, window_start, window_end, "
                "minutes_to_online, status, proposed_by, proposed_at, rationale, candidate_audit, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (oid, run["run_id"], gap_id, pid, dumps(c["offer_hospitals"]), window["start"], window["end"],
                 c["minutes_to_online"], "proposed", ident.username, clock.isoformat(),
                 dumps(rationale | {"candidate_removal_minutes": c.get("deficit_minutes_removed")}),
                 dumps(st["candidates"]), utc_now()))
            created.append(oid)
            self._audit(conn, run["run_id"], rev, clock.isoformat(), ident, "offer_proposed", oid, {
                "physician_id": pid, "gap_id": gap_id, "hospitals": c["offer_hospitals"], "window": window,
                "considered": [x["physician_id"] for x in st["candidates"]],
                "excluded": {x["physician_id"]: x["failed_rules"] for x in st["candidates"] if not x["eligible"]},
                "rationale": rationale,
            })
        return {"offer_ids": created, "gap_id": gap_id}

    def _offer(self, conn, run, offer_id: str) -> sqlite3.Row:
        r = conn.execute("SELECT * FROM offers WHERE offer_id=? AND run_id=?", (offer_id, run["run_id"])).fetchone()
        if r is None:
            raise ApiError(404, "offer_not_found", "Offer not found in the current run")
        return r

    def _set_offer(self, conn, offer_id: str, **fields) -> None:
        fields["updated_at"] = utc_now()
        sets = ", ".join(f"{k}=?" for k in fields)
        conn.execute(f"UPDATE offers SET {sets} WHERE offer_id=?", (*fields.values(), offer_id))

    def _transition(self, conn, run, ident, offer_id, allowed_from: tuple, to: str, kind: str, **fields) -> dict:
        r = self._offer(conn, run, offer_id)
        if r["status"] not in allowed_from:
            raise ApiError(409, "invalid_transition", f"Offer is {r['status']}; cannot {kind}",
                           offer_status=r["status"], status_reason=r["status_reason"])
        rev = self._bump(conn, run["run_id"])
        self._set_offer(conn, offer_id, status=to, **fields)
        self._audit(conn, run["run_id"], rev, run["scenario_clock"], ident, kind, offer_id,
                    {"from": r["status"], "to": to, "physician_id": r["physician_id"], **fields})
        return {"offer_id": offer_id, "status": to}

    def approve(self, conn, run, ident, offer_id: str) -> dict:
        require_role(ident, "clinical_lead")
        offer = self._offer(conn, run, offer_id)
        candidate = self._revalidate(conn, run, offer)
        if not candidate["eligible"]:
            raise ApiError(409, "candidate_ineligible", "Candidate is no longer eligible", failed_rules=candidate["failed_rules"])
        rationale = json.loads(offer["rationale"])
        rationale["approved_terms_hash"] = self._terms_hash(offer)
        return self._transition(conn, run, ident, offer_id, ("proposed",), "approved", "offer_approved",
                                approved_by=ident.username, approved_at=run["scenario_clock"], rationale=dumps(rationale))

    def reject(self, conn, run, ident, offer_id: str, reason: str) -> dict:
        require_role(ident, "clinical_lead")
        return self._transition(conn, run, ident, offer_id, ("proposed", "approved"), "rejected", "offer_rejected",
                                status_reason=reason or "rejected by clinical lead")

    def cancel(self, conn, run, ident, offer_id: str, reason: str) -> dict:
        require_role(ident, "coordinator", "clinical_lead")
        offer = self._offer(conn, run, offer_id)
        if offer["status"] == "accepted":
            require_role(ident, "clinical_lead")
            result = self._transition(conn, run, ident, offer_id, ("accepted",), "cancelled",
                                      "accepted_commitment_cancelled", status_reason=reason or "commitment invalidated by clinical lead")
            conn.execute("DELETE FROM gap_claims WHERE offer_id=?", (offer_id,))
            events, _ = self._events(conn, run)
            state = replay(events, self.ref, self._clock(run))
            ledger = self._ledger(conn, run["run_id"])
            gap = conn.execute("SELECT * FROM gaps WHERE gap_id=?", (offer["gap_id"],)).fetchone()
            needed = any(project_hospital(state, self.ref, h, list(ledger.accepted))["deficit_minutes"] > 0
                         for h in json.loads(gap["hospitals"]))
            conn.execute("UPDATE gaps SET status=? WHERE gap_id=?", ("open" if needed else "resolved", offer["gap_id"]))
            revision = conn.execute("SELECT revision FROM runs WHERE run_id=?", (run["run_id"],)).fetchone()["revision"]
            self._audit(conn, run["run_id"], revision, run["scenario_clock"], ident,
                        "planned_gap_claim_released", offer_id, {"gap_id": offer["gap_id"], "gap_reopened": needed,
                        "accounting": "Original commitment retained as a conservative work-history reservation",
                        "note": "No online, shift-end, consent or clinical outcome event was manufactured"})
            return result | {"gap_id": offer["gap_id"], "claim_released": True, "gap_reopened": needed,
                             "historical_reservation_retained": True}
        return self._transition(conn, run, ident, offer_id, ("proposed", "approved", "sent"), "cancelled",
                                "offer_cancelled", status_reason=reason or f"cancelled by {ident.role}")

    @staticmethod
    def _terms_hash(r) -> str:
        terms = {key: r[key] for key in ("physician_id", "window_start", "window_end", "minutes_to_online")}
        terms["hospitals"] = sorted(json.loads(r["hospitals"]))
        return hashlib.sha256(json.dumps(terms, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    def _revalidate(self, conn, run, r: sqlite3.Row) -> dict:
        if r["approved_at"] and json.loads(r["rationale"]).get("approved_terms_hash") != self._terms_hash(r):
            return {"eligible": False, "eligibility_status": "ineligible", "failed_rules": ["Approved immutable terms changed"]}
        ledger = self._ledger(conn, run["run_id"], exclude_offer=r["offer_id"])
        events, _ = self._events(conn, run)
        state = replay(events, self.ref, self._clock(run))
        ledger = replace(ledger, observed_work_intervals=state.observed_work_intervals)
        start, end = datetime.fromisoformat(r["window_start"]), datetime.fromisoformat(r["window_end"])
        return evaluate_candidate(self.ref, r["physician_id"], frozenset(json.loads(r["hospitals"])), start, end, ledger, evaluated_at=self._clock(run), observed_state=state)

    def _gap_still_needed(self, conn, run, r: sqlite3.Row, *, include_offer: bool = False) -> bool:
        events, _ = self._events(conn, run)
        state = replay(events, self.ref, self._clock(run))
        accepted = list(self._ledger(conn, run["run_id"], exclude_offer=None if include_offer else r["offer_id"]).accepted)
        hospitals = frozenset(json.loads(r["hospitals"]))
        if include_offer:
            return any(project_hospital(state, self.ref, h, accepted)["deficit_minutes"] > 0 for h in hospitals)
        start, end = datetime.fromisoformat(r["window_start"]), datetime.fromisoformat(r["window_end"])
        online = max(start, self._clock(run)) + timedelta(minutes=r["minutes_to_online"])
        candidate = Commitment(r["physician_id"], hospitals, start, end, online, r["offer_id"])
        # A historical/ETA-before-activation gap alone does not justify duplicate
        # outreach. This specific immutable offer must still reduce future deficit.
        return any(project_hospital(state, self.ref, h, accepted + [candidate])["deficit_minutes"] <
                   project_hospital(state, self.ref, h, accepted)["deficit_minutes"] for h in hospitals)

    def send(self, conn, run, ident, offer_id: str) -> dict:
        require_role(ident, "coordinator")
        r = self._offer(conn, run, offer_id)
        if r["status"] != "approved":
            raise ApiError(409, "invalid_transition",
                           "Only offers approved by the clinical lead can be sent" if r["status"] == "proposed"
                           else f"Offer is {r['status']}; cannot send", offer_status=r["status"])
        check = self._revalidate(conn, run, r)
        if not check["eligible"]:
            raise ApiError(409, "candidate_ineligible", "No longer eligible: " + "; ".join(check["failed_rules"]),
                           failed_rules=check["failed_rules"])
        gap = conn.execute("SELECT * FROM gaps WHERE gap_id=?", (r["gap_id"],)).fetchone()
        claimed = conn.execute("SELECT COUNT(*) AS n FROM gap_claims WHERE gap_id=?", (r["gap_id"],)).fetchone()["n"]
        if gap["status"] != "open" or claimed >= gap["slots"]:
            raise ApiError(409, "gap_filled", "This gap is already filled")
        if not self._gap_still_needed(conn, run, r):
            raise ApiError(409, "gap_resolved", "The projected gap no longer exists; offer not sent")
        clock = self._clock(run)
        expires = clock + OFFER_EXPIRY
        hospitals = [self.ref.hospitals[h].name for h in json.loads(r["hospitals"])]
        start, end = datetime.fromisoformat(r["window_start"]), datetime.fromisoformat(r["window_end"])
        message = (f"Split-shift offer: {', '.join(hospitals)}. {start.astimezone(ET):%H:%M}-"
                   f"{end.astimezone(ET):%H:%M} ET ({(end - start).total_seconds() / 3600:g}h), "
                   f"start {start.astimezone(ET):%H:%M} ET. Reply in the app within 10 minutes.")
        phy = self.ref.physicians[r["physician_id"]]
        rev = self._bump(conn, run["run_id"])
        self._set_offer(conn, offer_id, status="sent", sent_by=ident.username, sent_at=clock.isoformat(),
                        expires_at=expires.isoformat())
        self._audit(conn, run["run_id"], rev, clock.isoformat(), ident, "offer_sent", offer_id, {
            "physician_id": r["physician_id"], "approved_by": r["approved_by"],
            "delivery": f"SIMULATED via {phy.preferred_channel or 'app'}; no real message was sent",
            "notification_text": message, "expires_at": expires.isoformat()})
        return {"offer_id": offer_id, "status": "sent", "expires_at": expires.isoformat(),
                "notification_text": message, "delivery": "simulated"}

    def accept(self, conn, run, ident, offer_id: str) -> dict:
        require_role(ident, "physician")
        r = self._offer(conn, run, offer_id)
        if r["physician_id"] != ident.physician_id or r["sent_at"] is None:
            raise ApiError(404, "offer_not_found", "Offer not found")
        if r["status"] != "sent":
            raise ApiError(409, "offer_not_open", f"This offer is {r['status']}",
                           offer_status=r["status"], status_reason=r["status_reason"])
        clock = self._clock(run)
        if clock >= datetime.fromisoformat(r["expires_at"]):
            raise ApiError(409, "offer_not_open", "This offer has expired", offer_status="expired")
        check = self._revalidate(conn, run, r)
        if not check["eligible"]:
            raise ApiError(409, "candidate_ineligible", "No longer eligible: " + "; ".join(check["failed_rules"]))
        gap = conn.execute("SELECT * FROM gaps WHERE gap_id=?", (r["gap_id"],)).fetchone()
        claimed = conn.execute("SELECT COUNT(*) AS n FROM gap_claims WHERE gap_id=?", (r["gap_id"],)).fetchone()["n"]
        if claimed >= gap["slots"] or not self._gap_still_needed(conn, run, r):
            raise ApiError(409, "gap_filled", "Another physician already filled this gap or demand no longer needs it")
        # Unique (gap_id, slot) is the last line of defence against two winners.
        conn.execute("INSERT INTO gap_claims(run_id, gap_id, slot, offer_id, claimed_at) VALUES (?,?,?,?,?)",
                     (run["run_id"], r["gap_id"], claimed + 1, offer_id, clock.isoformat()))
        online = max(clock, datetime.fromisoformat(r["window_start"])) + timedelta(minutes=r["minutes_to_online"])
        rev = self._bump(conn, run["run_id"])
        self._set_offer(conn, offer_id, status="accepted", responded_at=clock.isoformat(), online_at=online.isoformat(),
                        accepted_start=r["window_start"], accepted_end=r["window_end"])
        self._audit(conn, run["run_id"], rev, clock.isoformat(), ident, "offer_accepted", offer_id,
                    {"gap_id": r["gap_id"], "slot": claimed + 1, "online_at": online.isoformat(),
                     "note": "Planned capacity, not verified presence"})
        cancelled = []
        if claimed + 1 >= gap["slots"] or not self._gap_still_needed(conn, run, r, include_offer=True):
            conn.execute("UPDATE gaps SET status='filled' WHERE gap_id=?", (r["gap_id"],))
            for peer in conn.execute("SELECT offer_id FROM offers WHERE gap_id=? AND offer_id<>? AND status IN "
                                     "('proposed','approved','sent')", (r["gap_id"], offer_id)).fetchall():
                self._set_offer(conn, peer["offer_id"], status="cancelled", status_reason="gap filled")
                cancelled.append(peer["offer_id"])
                self._audit(conn, run["run_id"], rev, clock.isoformat(), ident, "offer_cancelled", peer["offer_id"],
                            {"reason": "gap filled", "filled_by": offer_id})
        return {"offer_id": offer_id, "status": "accepted", "online_at": online.isoformat(),
                "peer_offers_cancelled": cancelled}

    def decline(self, conn, run, ident, offer_id: str) -> dict:
        require_role(ident, "physician")
        r = self._offer(conn, run, offer_id)
        if r["physician_id"] != ident.physician_id or r["sent_at"] is None:
            raise ApiError(404, "offer_not_found", "Offer not found")
        return self._transition(conn, run, ident, offer_id, ("sent",), "declined", "offer_declined",
                                responded_at=run["scenario_clock"])

    # ---- immediate actions
    def escalate(self, conn, run, ident, risk_id: str, consult_id: str | None, note: str,
                 kind: str = "escalation", target_physician_id: str | None = None) -> dict:
        """Escalation to the clinical lead, or a nudge (simulated internal message) to an on-shift physician."""
        require_role(ident, "coordinator", "clinical_lead")
        if kind not in ("escalation", "nudge"):
            raise ApiError(422, "invalid_kind", "kind must be 'escalation' or 'nudge'")
        if kind == "escalation":
            dup = conn.execute("SELECT 1 FROM actions WHERE run_id=? AND kind='escalation' AND risk_id=? "
                               "AND status='open'", (run["run_id"], risk_id)).fetchone()
            if dup:
                raise ApiError(409, "already_escalated", "This is already escalated and waiting for the clinical lead")
        else:
            if not target_physician_id or target_physician_id not in self.ref.physicians:
                raise ApiError(422, "invalid_target", "A nudge needs an on-shift physician")
            active = next((c for c in self._ledger(conn, run["run_id"]).accepted
                           if c.physician_id == target_physician_id and c.start <= self._clock(run) < c.end), None)
            if not on_shift(self.ref, target_physician_id, self._clock(run)):
                events, _ = self._events(conn, run)
                state = replay(events, self.ref, self._clock(run))
                if active is None or not availability(state, self.ref, target_physician_id, active_commitment=active)["verified"]:
                    raise ApiError(409, "target_off_shift", "Off-shift outreach must use the approved offer workflow")
            dup = conn.execute("SELECT 1 FROM actions WHERE run_id=? AND kind='nudge' AND risk_id=? AND created_at=?",
                               (run["run_id"], risk_id, run["scenario_clock"])).fetchone()
            if dup:
                raise ApiError(409, "already_nudged", "Already nudged at this scenario time")
        aid = _new_id("ESC" if kind == "escalation" else "NDG")
        status = "open" if kind == "escalation" else "sent"
        rev = self._bump(conn, run["run_id"])
        conn.execute("INSERT INTO actions(action_id, run_id, kind, status, consult_id, risk_id, target_physician_id, "
                     "note, created_by, created_at, detail) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                     (aid, run["run_id"], kind, status, consult_id, risk_id, target_physician_id, note[:500],
                      ident.username, run["scenario_clock"], dumps({"internal_only": True, "simulated": True})))
        self._audit(conn, run["run_id"], rev, run["scenario_clock"], ident,
                    "escalation_created" if kind == "escalation" else "nudge_sent", aid,
                    {"risk_id": risk_id, "consult_id": consult_id, "to": target_physician_id or "clinical_lead",
                     "note": note[:500], "delivery": "SIMULATED internal message; no external contact"})
        return {"action_id": aid, "status": status, "kind": kind}

    def acknowledge(self, conn, run, ident, action_id: str, decision: str) -> dict:
        require_role(ident, "clinical_lead")
        r = conn.execute("SELECT * FROM actions WHERE action_id=? AND run_id=?", (action_id, run["run_id"])).fetchone()
        if r is None or r["kind"] != "escalation":
            raise ApiError(404, "action_not_found", "Escalation not found")
        if r["status"] != "open":
            raise ApiError(409, "invalid_transition", f"Escalation is {r['status']}")
        rev = self._bump(conn, run["run_id"])
        conn.execute("UPDATE actions SET status='acknowledged', resolved_by=?, resolved_at=?, resolution=? "
                     "WHERE action_id=?", (ident.username, run["scenario_clock"], decision[:500], action_id))
        self._audit(conn, run["run_id"], rev, run["scenario_clock"], ident, "escalation_acknowledged", action_id,
                    {"decision": decision[:500]})
        return {"action_id": action_id, "status": "acknowledged"}

    def reassign(self, conn, run, ident, consult_id: str, physician_id: str, note: str) -> dict:
        require_role(ident, "coordinator")
        events, _ = self._events(conn, run)
        ledger = self._ledger(conn, run["run_id"])
        consult, targets = eligible_reassignment_targets(events, self.ref, self._clock(run), consult_id,
                                                         list(ledger.accepted))
        if consult is None:
            raise ApiError(404, "consult_not_found", "Consult is not open in the current state")
        if consult["stage"] not in WAITING_STAGES:
            raise ApiError(409, "consult_not_waiting",
                           f"{consult_id} is in {consult['stage']}; active encounters are not reassigned")
        reserved = {r["target_physician_id"] for r in conn.execute(
            "SELECT target_physician_id FROM actions WHERE run_id=? AND kind='reassignment' AND created_at=?",
            (run["run_id"], run["scenario_clock"]))}
        eligible = [t for t in targets if t["physician_id"] not in reserved]
        if physician_id not in {t["physician_id"] for t in eligible}:
            raise ApiError(409, "target_ineligible",
                           f"{physician_id} is not an eligible free credentialed physician for {consult_id} right now",
                           eligible_targets=[t["physician_id"] for t in eligible])
        aid = _new_id("RSN")
        rev = self._bump(conn, run["run_id"])
        conn.execute("INSERT INTO actions(action_id, run_id, kind, status, consult_id, target_physician_id, note, "
                     "created_by, created_at, detail) VALUES (?,?,?,?,?,?,?,?,?,?)",
                     (aid, run["run_id"], "reassignment", "recorded", consult_id, physician_id, note[:500],
                      ident.username, run["scenario_clock"],
                      dumps({"from": consult["physician_id"], "modeled": True, "routing_order": eligible[:5]})))
        self._audit(conn, run["run_id"], rev, run["scenario_clock"], ident, "reassignment_recorded", aid,
                    {"consult_id": consult_id, "from": consult["physician_id"], "to": physician_id,
                     "modeled": True, "note": "Recorded in the operations model; Synapse routing was not changed"})
        return {"action_id": aid, "consult_id": consult_id, "physician_id": physician_id}

    def reassignment_targets(self, ident: Identity, consult_id: str) -> dict:
        require_role(ident, "coordinator", "clinical_lead")
        with self.store.read() as conn:
            run = self._current_run(conn)
            events, _ = self._events(conn, run)
            ledger = self._ledger(conn, run["run_id"])
        consult, targets = eligible_reassignment_targets(events, self.ref, self._clock(run), consult_id,
                                                         list(ledger.accepted))
        if consult is None:
            raise ApiError(404, "consult_not_found", "Consult is not open in the current state")
        return {"consult": consult, "targets": targets, "waiting": consult["stage"] in WAITING_STAGES}


def timed(fn: Callable[[], dict]) -> tuple[dict, float]:
    t0 = time.perf_counter()
    out = fn()
    return out, round((time.perf_counter() - t0) * 1000, 3)
