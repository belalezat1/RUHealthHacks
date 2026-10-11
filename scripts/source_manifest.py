"""Record or verify SHA-256 hashes of the original source fixtures.

    python scripts/source_manifest.py           # write data/original/MANIFEST.sha256
    python scripts/source_manifest.py --check   # fail if any source file changed
"""
from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data" / "original"
MANIFEST = DATA / "MANIFEST.sha256"


def current() -> dict[str, str]:
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(DATA.glob("*.csv"))}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    now = current()
    if not args.check:
        MANIFEST.write_text("".join(f"{h}  {n}\n" for n, h in now.items()), encoding="utf-8")
        print(f"wrote {MANIFEST} ({len(now)} files)")
        return 0
    expected = {}
    for line in MANIFEST.read_text(encoding="utf-8").splitlines():
        h, n = line.split(maxsplit=1)
        expected[n.strip()] = h
    bad = [n for n in expected if now.get(n) != expected[n]] + [n for n in now if n not in expected]
    for n in sorted(expected):
        print(f"{'OK  ' if n not in bad else 'FAIL'} {n}")
    if bad:
        print(f"source data changed: {bad}")
        return 1
    print(f"all {len(expected)} source files match the manifest")
    return 0


if __name__ == "__main__":
    sys.exit(main())
