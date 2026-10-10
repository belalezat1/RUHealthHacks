"""SQLite persistence: runs, events, offers, gap claims, actions, audit, sessions, idempotency.

One API worker owns the database. Every write happens in a single ``BEGIN IMMEDIATE``
transaction together with its audit rows, so operational state and audit never diverge.
"""
from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

SCHEMA_VERSION = 1

MIGRATIONS: dict[int, str] = {
    1: """
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE runs (
        run_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL,
        scenario_clock TEXT NOT NULL,
        revision INTEGER NOT NULL,
        event_revision INTEGER NOT NULL,
        has_imports INTEGER NOT NULL DEFAULT 0,
        is_current INTEGER NOT NULL DEFAULT 0,
        source_manifest TEXT NOT NULL
    );
    CREATE TABLE events (
        run_id TEXT NOT NULL REFERENCES runs(run_id),
        event_id TEXT NOT NULL,
        event_time TEXT NOT NULL,
        ingested_at TEXT NOT NULL,
        consult_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        physician_id TEXT NOT NULL,
        hospital_id TEXT NOT NULL,
        description TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        import_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        PRIMARY KEY (run_id, event_id)
    );
    CREATE TABLE imports (
        import_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(run_id),
        created_at TEXT NOT NULL,
        actor TEXT NOT NULL,
        filename TEXT NOT NULL,
        summary TEXT NOT NULL,
        revision INTEGER NOT NULL
    );
    CREATE TABLE gaps (
        gap_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(run_id),
        hospitals TEXT NOT NULL,
        window_start TEXT NOT NULL,
        window_end TEXT NOT NULL,
        slots INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE TABLE offers (
        offer_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(run_id),
        gap_id TEXT NOT NULL REFERENCES gaps(gap_id),
        physician_id TEXT NOT NULL,
        hospitals TEXT NOT NULL,
        window_start TEXT NOT NULL,
        window_end TEXT NOT NULL,
        minutes_to_online INTEGER NOT NULL,
        status TEXT NOT NULL,
        status_reason TEXT NOT NULL DEFAULT '',
        proposed_by TEXT NOT NULL,
        proposed_at TEXT NOT NULL,
        approved_by TEXT,
        approved_at TEXT,
        sent_by TEXT,
        sent_at TEXT,
        expires_at TEXT,
        responded_at TEXT,
        online_at TEXT,
        rationale TEXT NOT NULL,
        candidate_audit TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX offers_run ON offers(run_id, status);
    CREATE TABLE gap_claims (
        run_id TEXT NOT NULL,
        gap_id TEXT NOT NULL,
        slot INTEGER NOT NULL,
        offer_id TEXT NOT NULL UNIQUE,
        claimed_at TEXT NOT NULL,
        PRIMARY KEY (gap_id, slot)
    );
    CREATE TABLE actions (
        action_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(run_id),
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        consult_id TEXT,
        risk_id TEXT,
        target_physician_id TEXT,
        note TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_by TEXT,
        resolved_at TEXT,
        resolution TEXT,
        detail TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE audit (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        wall_time TEXT NOT NULL,
        scenario_time TEXT NOT NULL,
        actor TEXT NOT NULL,
        role TEXT NOT NULL,
        kind TEXT NOT NULL,
        entity TEXT NOT NULL,
        detail TEXT NOT NULL
    );
    CREATE INDEX audit_run ON audit(run_id, seq);
    CREATE TABLE users (
        username TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        physician_id TEXT,
        password_hash TEXT NOT NULL
    );
    CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        username TEXT NOT NULL REFERENCES users(username),
        csrf_token TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE idempotency (
        username TEXT NOT NULL,
        key TEXT NOT NULL,
        route TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        response TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (username, key)
    );
    """,
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def dumps(value) -> str:
    return json.dumps(value, separators=(",", ":"), default=str)


class Store:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self.conn = sqlite3.connect(str(self.path), check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=FULL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.migrate()

    def schema_version(self) -> int:
        has_meta = self.conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta'").fetchone()
        if not has_meta:
            return 0
        row = self.conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
        return int(row["value"]) if row else 0

    def migrate(self) -> None:
        with self._lock:
            current = self.schema_version()
            if current > SCHEMA_VERSION:
                raise RuntimeError(f"database schema {current} is newer than this release ({SCHEMA_VERSION})")
            for version in range(current + 1, SCHEMA_VERSION + 1):
                self.conn.execute("BEGIN IMMEDIATE")
                try:
                    for stmt in MIGRATIONS[version].split(";"):
                        if stmt.strip():
                            self.conn.execute(stmt)
                    self.conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES('schema_version', ?)",
                                      (str(version),))
                    self.conn.execute("COMMIT")
                except Exception:
                    self.conn.execute("ROLLBACK")
                    raise

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        """Serialized write transaction. Any exception rolls back everything."""
        with self._lock:
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                yield self.conn
            except BaseException:
                self.conn.execute("ROLLBACK")
                raise
            else:
                self.conn.execute("COMMIT")

    @contextmanager
    def read(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            yield self.conn

    def backup_to(self, dest: Path | str) -> Path:
        """Consistent online backup using SQLite's backup API."""
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            target = sqlite3.connect(str(dest))
            try:
                self.conn.backup(target)
            finally:
                target.close()
        return dest

    def close(self) -> None:
        with self._lock:
            self.conn.close()


def audit(conn: sqlite3.Connection, *, run_id: str, revision: int, scenario_time: str, actor: str,
          role: str, kind: str, entity: str, detail: dict) -> None:
    conn.execute(
        "INSERT INTO audit(run_id, revision, wall_time, scenario_time, actor, role, kind, entity, detail) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (run_id, revision, utc_now(), scenario_time, actor, role, kind, entity, dumps(detail)),
    )
