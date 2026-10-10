"""Consistent online SQLite backup (safe while the API is running; uses SQLite's backup API).

Inside the API container:
    python scripts/backup.py --out /state/backups/pre-release.sqlite3
Optionally upload to a versioned S3 bucket from the host (see infra/scripts/backup-to-s3.sh).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.path.join(os.environ.get("SEVARO_STATE_DIR", "state"), "sevaro.sqlite3"))
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    src_path = Path(args.db)
    if not src_path.exists():
        print(f"no database at {src_path}", file=sys.stderr)
        return 1
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = Path(args.out or src_path.parent / "backups" / f"sevaro-{stamp}.sqlite3")
    out.parent.mkdir(parents=True, exist_ok=True)
    src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
    dst = sqlite3.connect(str(out))
    try:
        src.backup(dst)
        ok = dst.execute("PRAGMA integrity_check").fetchone()[0]
        schema = dst.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0]
        runs = dst.execute("SELECT run_id, revision FROM runs WHERE is_current=1").fetchone()
    finally:
        dst.close()
        src.close()
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    info = {"backup": str(out), "sha256": digest, "integrity": ok, "schema_version": int(schema),
            "current_run": runs[0] if runs else None, "revision": runs[1] if runs else None, "created_at": stamp}
    Path(str(out) + ".json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    print(json.dumps(info, indent=2))
    return 0 if ok == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
