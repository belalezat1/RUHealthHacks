"""Demo-scale load test: N users poll the full report every 2 s while a writer imports events.

Measures report HTTP latency (p50/p95/p99), errors, and revision lag (time from a committed
write until a polling reader sees that revision). Standard library only.

    python scripts/loadtest.py --base http://localhost:8080 --password sevaro-demo --users 20 --seconds 120

Targets (plan): single client p95 <= 300 ms; 20 users p95 <= 500 ms. Note: on Windows use
127.0.0.1 rather than "localhost" to avoid a ~2 s IPv6 fallback that is not server time.
"""
from __future__ import annotations

import argparse
import json
import platform
import statistics
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke_live import Client  # noqa: E402

HEADER = "event_id,event_time,ingested_at,consult_id,event_type,physician_id,hospital_id,description\n"


def pct(s: list[float], q: float) -> float:
    s = sorted(s)
    return round(s[min(len(s) - 1, int(round(q * (len(s) - 1))))], 2) if s else float("nan")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8080")
    ap.add_argument("--origin", default=None)
    ap.add_argument("--password", default="sevaro-demo")
    ap.add_argument("--users", type=int, default=20)
    ap.add_argument("--seconds", type=int, default=120)
    ap.add_argument("--interval", type=float, default=2.0)
    ap.add_argument("--write-every", type=float, default=10.0, help="seconds between synthetic writes (0 = none)")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    lat: list[float] = []
    errors: list[str] = []
    seen_at: dict[int, float] = {}
    committed_at: dict[int, float] = {}
    lock = threading.Lock()
    stop = time.time() + args.seconds

    def reader(i: int):
        c = Client(args.base, args.origin)
        c.login("coordinator", args.password)
        time.sleep(i * args.interval / max(1, args.users))  # spread polls evenly
        while time.time() < stop:
            t0 = time.time()
            s, body, ms = c.call("GET", "/api/v1/report")
            with lock:
                if s == 200:
                    lat.append(ms)
                    seen_at.setdefault(body["revision"], time.time())
                else:
                    errors.append(f"{s}")
            time.sleep(max(0.0, args.interval - (time.time() - t0)))

    def writer():
        c = Client(args.base, args.origin)
        c.login("coordinator", args.password)
        n = 0
        while time.time() < stop - 5:
            time.sleep(args.write_every)
            _, st, _ = c.call("GET", "/api/v1/state")
            at = datetime.fromisoformat(st["as_of"]) + timedelta(seconds=1)
            n += 1
            eid = f"EVT-LOAD-{int(time.time())}-{n}"
            row = f"{eid},{at.isoformat()},{(at + timedelta(seconds=1)).isoformat()},,physician_status_changed,PHY-004,,Self-reported status: Available\n"
            s, body, _ = c.write("/api/v1/events/import?filename=load.csv", raw=HEADER + row)
            with lock:
                if s == 200:
                    committed_at[body["revision"]] = time.time()
                else:
                    errors.append(f"write {s}")

    threads = [threading.Thread(target=reader, args=(i,), daemon=True) for i in range(args.users)]
    if args.write_every > 0:
        threads.append(threading.Thread(target=writer, daemon=True))
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    lags = [round((seen_at[r] - committed_at[r]) * 1000, 1) for r in committed_at if r in seen_at]
    out = {
        "measured_at": datetime.now(timezone.utc).isoformat(),
        "base": args.base,
        "client_machine": platform.platform(),
        "users": args.users, "seconds": args.seconds, "poll_interval_s": args.interval,
        "operation": "GET /api/v1/report (full report, cookie auth) incl. network",
        "requests": len(lat), "errors": len(errors), "error_samples": errors[:10],
        "latency_ms": {"p50": round(statistics.median(lat), 2) if lat else None, "p95": pct(lat, 0.95),
                       "p99": pct(lat, 0.99), "max": round(max(lat), 2) if lat else None},
        "writes": len(committed_at),
        "revision_lag_ms": {"p50": pct(lags, 0.5), "max": max(lags) if lags else None, "n": len(lags)},
        "target_p95_ms": 300 if args.users == 1 else 500,
    }
    out["meets_target"] = bool(lat) and out["latency_ms"]["p95"] <= out["target_p95_ms"] and not errors
    print(json.dumps(out, indent=2))
    if args.out:
        Path(args.out).write_text(json.dumps(out, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
