"""Bounded HTTP report-read benchmark using explicitly provisioned local accounts.

Usage: python scripts/bench_api.py --accounts .local/browser-accounts.json --out docs/evidence/api-benchmark.json
No staffing mutations or provider calls. Never writes passwords or report bodies to output.
"""
import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import httpx
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.bench import dist

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--accounts', required=True, type=Path)
parser.add_argument('--url', default='http://127.0.0.1:8000')
parser.add_argument('--out', required=True, type=Path)
args = parser.parse_args()
if not args.url.startswith(('http://127.0.0.1:', 'http://localhost:')):
    parser.error('Benchmark is local-only')
account = next(a for a in json.loads(args.accounts.read_text()) if a['role'] == 'coordinator')
with httpx.Client(base_url=args.url, timeout=10) as client:
    response = client.post('/api/v1/session', json={'username': account['username'], 'password': account['password']})
    response.raise_for_status()
    for _ in range(5):
        client.get('/api/v1/report').raise_for_status()
    def read(_):
        start = time.perf_counter()
        response = client.get('/api/v1/report')
        response.raise_for_status()
        result = response.json()
        assert result['data']['evidence']['projection_cache_hit']
        return (time.perf_counter() - start) * 1000
    sequential = [read(i) for i in range(50)]
    start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=4) as pool:
        concurrent = list(pool.map(read, range(40)))
    elapsed = time.perf_counter() - start
result = {'sequential_http_report_read_ms': dist(sequential), 'four_concurrent_clients_report_read_ms': dist(concurrent),
          'concurrent_completed_reads_per_second': round(40 / elapsed, 2), 'failed_requests': 0,
          'database': 'local PostgreSQL', 'server_workers': 1, 'projection_cache': 'warm',
          'includes': 'HTTP, fresh database read connection, report enrichment and serialization',
          'excludes': 'Jev, mutations, external integrations, production network latency',
          'note': 'Bounded local smoke benchmark; not a capacity or 200-hospital load test.'}
args.out.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
