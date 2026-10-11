"""Isolated browser fixture: withhold existing source rows, then test their live import.

Rejects every database except the disposable e2e harness database. Creates no events.
"""
import os
import sys
import psycopg
from psycopg.conninfo import conninfo_to_dict

url = os.environ['SEVARO_E2E_DATABASE_URL']
if not conninfo_to_dict(url)['dbname'].startswith('sevaro_e2e_'):
    raise RuntimeError('Only an isolated browser test database is allowed')
with psycopg.connect(url) as connection:
    run = connection.execute('SELECT run_id,label FROM runs WHERE is_current=1').fetchone()
    if not run or run[1] != 'Isolated browser CSV verification':
        raise RuntimeError('Only the specifically labelled CSV verification run is allowed')
    cutoff = '2026-03-17T18:17:00-04:00'
    deleted = connection.execute('DELETE FROM events WHERE run_id=%s AND ingested_at::timestamptz > %s::timestamptz', (run[0], cutoff)).rowcount
    if deleted <= 0:
        raise RuntimeError('No supplied records were withheld')
    connection.execute('UPDATE runs SET scenario_clock=%s,revision=revision+1,event_revision=event_revision+1,has_imports=1 WHERE run_id=%s', (cutoff, run[0]))
print(deleted)
