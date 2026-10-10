"""End-to-end live check against a running deployment (local, Docker or CloudFront).

Proves the real-time path works without a restart:
  1. sign in as coordinator, read the report and snapshot verification
  2. import a new event batch and confirm the revision and report change
  3. re-import the same batch and confirm nothing changes (idempotent)
  4. run the full offer loop: propose -> approve -> send -> accept
  5. confirm accepted capacity shows in the projection and the audit trail

Uses only the standard library so it runs anywhere:
    python scripts/smoke_live.py --base http://localhost:8080 --password sevaro-demo
Exit code 0 = every check passed. Run it against a FRESH run (it starts one itself with --reset).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
import uuid

BATCH = """event_id,event_time,ingested_at,consult_id,event_type,physician_id,hospital_id,description
EVT-SMOKE-{tag}-1,2026-03-17T18:21:00-04:00,2026-03-17T18:21:02-04:00,CON-SMK{tag},consult_received,,SYN-005,Stroke consult request received
EVT-SMOKE-{tag}-2,2026-03-17T18:21:30-04:00,2026-03-17T18:21:33-04:00,CON-SMK{tag},consult_triaged,,SYN-005,Consult triaged
"""


class Client:
    def __init__(self, base: str, origin: str | None):
        self.base = base.rstrip("/")
        self.origin = origin or self.base
        # Cookies are handled by hand: the session cookie is marked Secure in hosted mode, and
        # Python's cookiejar refuses to send Secure cookies to http://localhost (browsers do).
        self.cookies: dict[str, str] = {}
        self.csrf = ""

    def call(self, method: str, path: str, body=None, headers=None, raw: str | None = None):
        h = {"Accept": "application/json", "Origin": self.origin}
        data = None
        if raw is not None:
            data, h["Content-Type"] = raw.encode(), "text/csv"
        elif body is not None:
            data, h["Content-Type"] = json.dumps(body).encode(), "application/json"
        h.update(headers or {})
        if self.cookies:
            h["Cookie"] = "; ".join(f"{k}={v}" for k, v in self.cookies.items())
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        t0 = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                text = resp.read().decode()
                status = resp.status
                set_cookies = resp.headers.get_all("Set-Cookie") or []
        except urllib.error.HTTPError as e:
            text, status = e.read().decode(), e.code
            set_cookies = e.headers.get_all("Set-Cookie") or []
        ms = (time.perf_counter() - t0) * 1000
        for c in set_cookies:
            name, _, rest = c.partition("=")
            value = rest.split(";", 1)[0]
            if value and "max-age=0" not in c.lower():
                self.cookies[name.strip()] = value
            else:
                self.cookies.pop(name.strip(), None)
        return status, (json.loads(text) if text.startswith("{") else text), ms

    def login(self, user: str, password: str):
        s, b, _ = self.call("POST", "/api/v1/session", {"username": user, "password": password})
        if s != 200:
            raise SystemExit(f"login failed for {user}: {s} {b}")
        self.csrf = b["csrf_token"]

    def write(self, path: str, body=None, raw: str | None = None):
        _, st, _ = self.call("GET", "/api/v1/state")
        return self.call("POST", path, body, raw=raw, headers={
            "X-CSRF-Token": self.csrf, "Idempotency-Key": uuid.uuid4().hex,
            "X-Expected-Run": st["run_id"], "X-Expected-Revision": str(st["revision"])})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8080")
    ap.add_argument("--origin", default=None, help="Origin header to send (defaults to --base)")
    ap.add_argument("--password", default="sevaro-demo")
    ap.add_argument("--reset", action="store_true", help="start a fresh run first (keeps history)")
    args = ap.parse_args()
    failures = []

    def check(name: str, ok: bool, detail: str = ""):
        print(f"[{'PASS' if ok else 'FAIL'}] {name}{' - ' + detail if detail else ''}")
        if not ok:
            failures.append(name)

    s, b, ms = Client(args.base, args.origin).call("GET", "/health/ready")
    check("health ready", s == 200, f"{ms:.0f} ms {b}")

    coord, lead, grace = (Client(args.base, args.origin) for _ in range(3))
    coord.login("coordinator", args.password)
    lead.login("lead", args.password)
    grace.login("phy-009", args.password)

    if args.reset:
        s, b, _ = coord.write("/api/v1/runs", {"label": "smoke test"})
        check("new run", s == 200, str(b.get("result", b)))

    s, rep, ms = coord.call("GET", "/api/v1/report")
    check("report readable", s == 200, f"{ms:.0f} ms")
    v = rep["data"]["verification"]
    check("snapshot 208/208 on fresh run", v["matched"] == 208 and v["compared"] == 208, v["label"])
    rev0 = rep["revision"]

    tag = uuid.uuid4().hex[:6].upper()
    batch = BATCH.format(tag=tag)
    s, b, ms = coord.write("/api/v1/events/import?filename=smoke.csv", raw=batch)
    check("import accepted", s == 200 and b["result"]["accepted"] == 2, f"{ms:.0f} ms")
    deadline = time.time() + 3
    seen = False
    while time.time() < deadline and not seen:
        _, rep2, _ = coord.call("GET", "/api/v1/report")
        seen = rep2["revision"] > rev0 and any(c["consult_id"] == f"CON-SMK{tag}" for c in rep2["data"]["consults"])
    check("new event visible without restart (<=3 s)", seen)

    _, st, _ = coord.call("GET", "/api/v1/state")
    s, b, _ = coord.write("/api/v1/events/import", raw=batch)
    _, st2, _ = coord.call("GET", "/api/v1/state")
    check("duplicate import is idempotent", s == 200 and b["result"]["accepted"] == 0 and st2["revision"] == st["revision"])

    s, b, _ = coord.write("/api/v1/offers/propose", {})
    check("propose offer", s == 200, str(b.get("result", b)))
    if s == 200:
        oid = b["result"]["offer_ids"][0]
        s, b, _ = coord.write(f"/api/v1/offers/{oid}/send")
        check("send blocked before approval", s == 409)
        s, b, _ = lead.write(f"/api/v1/offers/{oid}/approve")
        check("lead approves", s == 200)
        s, b, _ = coord.write(f"/api/v1/offers/{oid}/send")
        check("simulated send", s == 200)
        s, b, _ = grace.call("GET", "/api/v1/me/offers")
        mine = b["data"]["offers"] if s == 200 else []
        check("physician sees only own offer, no clinical detail",
              len(mine) == 1 and "rationale" not in mine[0] and mine[0]["offer_id"] == oid)
        s, b, _ = grace.write(f"/api/v1/offers/{oid}/accept")
        check("physician accepts", s == 200, str(b.get("result", b)))
        _, rep3, _ = coord.call("GET", "/api/v1/report")
        phy = next(p for p in rep3["data"]["physicians"] if p["physician_id"] == "PHY-009")
        check("accepted capacity in projection", phy["planned_capacity"] is not None)
        kinds = {a["kind"] for a in rep3["data"]["audit_tail"]}
        check("audit has full loop", {"offer_proposed", "offer_approved", "offer_sent", "offer_accepted"} <= kinds)

    s, _, _ = grace.call("GET", "/api/v1/report")
    check("physician cannot read network report", s == 403)

    print(f"\n{'ALL CHECKS PASSED' if not failures else f'{len(failures)} FAILED: ' + ', '.join(failures)}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
