"""Restore drill: copy a backup into a SEPARATE temporary state path and prove it is usable.

Never touches the live database. Rebuilds the projection from the restored copy and checks
the run, revision, offers and audit are readable, exactly as a real restore would.

    python scripts/restore_check.py /state/backups/sevaro-....sqlite3
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.api.service import Service  # noqa: E402
from backend.api.store import Store  # noqa: E402
from backend.core.data import load_reference  # noqa: E402


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    backup = Path(sys.argv[1])
    with tempfile.TemporaryDirectory(prefix="sevaro-restore-") as tmp:
        target = Path(tmp) / "sevaro.sqlite3"
        shutil.copy2(backup, target)
        store = Store(target)  # runs migrations if the backup is from an older schema
        try:
            ok = store.conn.execute("PRAGMA integrity_check").fetchone()[0]
            service = Service(load_reference(), store, "restore-check")
            service.startup()  # rebuilds the projection from durable state
            st = service.state()
            with store.read() as conn:
                offers = conn.execute("SELECT status, COUNT(*) n FROM offers WHERE run_id=? GROUP BY status",
                                      (st["run_id"],)).fetchall()
                audit_rows = conn.execute("SELECT COUNT(*) n FROM audit").fetchone()["n"]
                runs = conn.execute("SELECT COUNT(*) n FROM runs").fetchone()["n"]
            report, _ = service._report_for_run(store.conn.execute("SELECT * FROM runs WHERE is_current=1").fetchone())
            result = {
                "restored_from": str(backup),
                "restored_to": str(target),
                "integrity": ok,
                "run_id": st["run_id"],
                "revision": st["revision"],
                "as_of": st["as_of"],
                "runs": runs,
                "audit_rows": audit_rows,
                "offers_by_status": {r["status"]: r["n"] for r in offers},
                "report_builds": bool(report["risks"] is not None),
                "engine_ms": report["engine_timing_ms"]["total"],
            }
        finally:
            store.close()
    print(json.dumps(result, indent=2))
    return 0 if result["integrity"] == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
