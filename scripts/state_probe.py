"""Print a deterministic summary of the live state (for restart / restore comparisons).

    python scripts/state_probe.py --base http://localhost:8080 --password sevaro-demo
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke_live import Client  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8080")
    ap.add_argument("--origin", default=None)
    ap.add_argument("--password", default="sevaro-demo")
    args = ap.parse_args()
    c = Client(args.base, args.origin)
    c.login("coordinator", args.password)
    _, st, _ = c.call("GET", "/api/v1/state")
    _, rep, _ = c.call("GET", "/api/v1/report")
    _, audit, _ = c.call("GET", "/api/v1/audit.csv")
    d = rep["data"]
    print(json.dumps({
        "run_id": st["run_id"],
        "revision": st["revision"],
        "as_of": st["as_of"],
        "events_applied": d["counts"]["events_applied"],
        "open_consults": d["counts"]["open_consults"],
        "offers": sorted((o["offer_id"], o["status"]) for o in d["offers"]),
        "actions": sorted((a["action_id"], a["status"]) for a in d["actions"]),
        "audit_rows": len(audit.strip().splitlines()) - 1,
        "imports": len(d["imports"]),
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
