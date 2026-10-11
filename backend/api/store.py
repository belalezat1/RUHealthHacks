"""Canonical PostgreSQL persistence with an explicit isolated SQLite test adapter."""
from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

SCHEMA_VERSION = 2

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

MIGRATIONS[2] = """
ALTER TABLE idempotency ADD COLUMN run_id TEXT NOT NULL DEFAULT '';
ALTER TABLE idempotency ADD COLUMN request_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE offers ADD COLUMN accepted_start TEXT;
ALTER TABLE offers ADD COLUMN accepted_end TEXT;
CREATE UNIQUE INDEX one_open_offer_per_physician ON offers(run_id, physician_id)
    WHERE status IN ('proposed','approved','sent');
CREATE UNIQUE INDEX one_current_run ON runs(is_current) WHERE is_current=1;
CREATE TABLE decisions (
    decision_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id),
    revision INTEGER NOT NULL,
    actor TEXT NOT NULL,
    created_at TEXT NOT NULL,
    detail TEXT NOT NULL
);
CREATE INDEX decisions_run ON decisions(run_id, revision);
"""



def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def dumps(value) -> str:
    return json.dumps(value, separators=(",", ":"), default=str)


class _PostgresConnection:
    """Keep the domain SQL portable; parameter values are always bound."""
    def __init__(self, conn):
        self.raw = conn

    def execute(self, query, params=()):
        return self.raw.execute(query.replace("?", "%s"), params)

    def executemany(self, query, params):
        cur = self.raw.cursor()
        cur.executemany(query.replace("?", "%s"), params)
        return cur


class Store:
    """PostgreSQL is the runtime owner. SQLite is only an explicit test adapter.

    A transaction-scoped advisory lock serializes policy mutations across workers.
    Database unique/exclusion constraints remain the final integrity boundary.
    """
    def __init__(self, target: Path | str, *, auto_migrate: bool = True):
        self.postgres = str(target).startswith(("postgresql://", "postgres://"))
        self.target = str(target)
        self._lock = threading.RLock()
        if self.postgres:
            self.path = None
            self.conn = None
            if auto_migrate:
                from alembic import command
                from alembic.config import Config
                cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
                cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "migrations"))
                cfg.attributes["database_url"] = self.target.replace("postgresql://", "postgresql+psycopg://").replace("postgres://", "postgresql+psycopg://")
                command.upgrade(cfg, "head")
            if self.schema_version() != SCHEMA_VERSION:
                raise RuntimeError("Database migration required; run python -m backend.api.admin migrate")
        else:
            self.path = Path(target)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.conn = sqlite3.connect(str(self.path), check_same_thread=False, isolation_level=None)
            self.conn.row_factory = sqlite3.Row
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.execute("PRAGMA synchronous=FULL")
            self.conn.execute("PRAGMA foreign_keys=ON")
            self.migrate()

    def schema_version(self) -> int:
        if self.postgres:
            with self.read() as conn:
                if not conn.execute("SELECT to_regclass('meta') AS name").fetchone()["name"]:
                    return 0
                row = conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
                return int(row["value"]) if row else 0
        has_meta = self.conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta'").fetchone()
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
                    self.conn.execute("INSERT INTO meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(version),))
                    self.conn.execute("COMMIT")
                except Exception:
                    self.conn.execute("ROLLBACK")
                    raise

    def _pg(self):
        import psycopg
        from psycopg.rows import dict_row
        return psycopg.connect(self.target, row_factory=dict_row, connect_timeout=5)

    @contextmanager
    def tx(self):
        if self.postgres:
            with self._pg() as raw:
                raw.execute("SELECT pg_advisory_xact_lock(728414021)")
                yield _PostgresConnection(raw)
            return
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
    def read(self):
        if self.postgres:
            with self._pg() as raw:
                raw.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
                yield _PostgresConnection(raw)
            return
        with self._lock:
            yield self.conn

    def backup_to(self, dest: Path | str) -> Path:
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            raise FileExistsError("Backup target already exists; choose a new destination")
        if self.postgres:
            import os
            import subprocess
            from psycopg.conninfo import conninfo_to_dict, make_conninfo
            parameters = conninfo_to_dict(self.target)
            password = parameters.pop("password", None)
            environment = os.environ.copy()
            if password is not None:
                environment["PGPASSWORD"] = password
            subprocess.run(["pg_dump", "--format=custom", "--file", str(dest), make_conninfo(**parameters)],
                           env=environment, check=True, capture_output=True)
        else:
            with self._lock:
                target = sqlite3.connect(str(dest))
                try:
                    self.conn.backup(target)
                finally:
                    target.close()
        return dest

    def close(self) -> None:
        if self.conn is not None:
            with self._lock:
                self.conn.close()


def audit(conn: sqlite3.Connection, *, run_id: str, revision: int, scenario_time: str, actor: str,
          role: str, kind: str, entity: str, detail: dict) -> None:
    conn.execute(
        "INSERT INTO audit(run_id, revision, wall_time, scenario_time, actor, role, kind, entity, detail) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (run_id, revision, utc_now(), scenario_time, actor, role, kind, entity, dumps(detail)),
    )
