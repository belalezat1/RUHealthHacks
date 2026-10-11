"""Engine benchmarks on the original fixture, with the full distribution and the machine recorded.

  warm:  report computation + JSON serialization, data already in memory   (target p95 <= 50 ms)
  full:  read all CSVs + validate + replay + analysis + JSON               (target p95 <= 150 ms)
Interpreter startup is excluded; the OS file cache may be warm (stated in the output).

    python scripts/bench.py --runs 300 --out output/evidence/bench.json
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.core.data import load_reference  # noqa: E402
from backend.core.events import read_csv_text, validate_batch  # noqa: E402
from backend.core.report import build_report  # noqa: E402


def dist(samples: list[float]) -> dict:
    s = sorted(samples)
    pick = lambda q: s[min(len(s) - 1, int(round(q * (len(s) - 1))))]  # noqa: E731
    return {"n": len(s), "min": round(s[0], 3), "p50": round(statistics.median(s), 3), "p95": round(pick(0.95), 3),
            "p99": round(pick(0.99), 3), "max": round(s[-1], 3), "mean": round(statistics.fmean(s), 3)}


def git_sha() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return os.environ.get("SEVARO_RELEASE_SHA", "unknown")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=300)
    ap.add_argument("--full-runs", type=int, default=100)
    ap.add_argument("--warmup", type=int, default=10)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    ref = load_reference()
    text = (ref.data_dir / "event_stream.csv").read_text(encoding="utf-8")
    rows, _ = read_csv_text(text)
    events = validate_batch(rows, ref, {}).accepted

    for _ in range(args.warmup):
        json.dumps(build_report(events, ref, ref.scenario_now), default=str)
    warm = []
    for _ in range(args.runs):
        t0 = time.perf_counter()
        json.dumps(build_report(events, ref, ref.scenario_now), default=str)
        warm.append((time.perf_counter() - t0) * 1000)

    full = []
    for _ in range(args.full_runs):
        t0 = time.perf_counter()
        r = load_reference()
        rws, _ = read_csv_text((r.data_dir / "event_stream.csv").read_text(encoding="utf-8"))
        ev = validate_batch(rws, r, {}).accepted
        json.dumps(build_report(ev, r, r.scenario_now), default=str)
        full.append((time.perf_counter() - t0) * 1000)

    out = {
        "measured_at": datetime.now(timezone.utc).isoformat(),
        "release_sha": git_sha(),
        "machine": {"platform": platform.platform(), "python": platform.python_version(),
                    "processor": platform.processor() or platform.machine(), "cpus": os.cpu_count()},
        "scenario": "original fixture, 18:20 ET",
        "notes": "Interpreter startup excluded; OS file cache likely warm; no projection cache used.",
        "warm_analysis_plus_json_ms": dist(warm) | {"target_p95": 50},
        "full_load_replay_analysis_json_ms": dist(full) | {"target_p95": 150},
    }
    out["warm_analysis_plus_json_ms"]["meets_target"] = out["warm_analysis_plus_json_ms"]["p95"] <= 50
    out["full_load_replay_analysis_json_ms"]["meets_target"] = out["full_load_replay_analysis_json_ms"]["p95"] <= 150
    print(json.dumps(out, indent=2))
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(out, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
