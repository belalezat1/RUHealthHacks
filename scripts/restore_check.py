"""Restore a PostgreSQL backup into a NEW disposable database; never overwrite the source.

Requires CREATE DATABASE access. Usage: python scripts/restore_check.py backup.dump
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path
import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.api.config import load_settings
from backend.api.service import Service
from backend.api.store import Store
from backend.core.data import load_reference


def inventory(connection):
    tables = connection.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").fetchall()
    return {name: connection.execute(sql.SQL('SELECT COUNT(*) FROM {}').format(sql.Identifier(name))).fetchone()[0]
            for (name,) in tables}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('backup', type=Path)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    settings = load_settings()
    if not str(settings.db_path).startswith('postgresql://'):
        parser.error('Recovery drill requires PostgreSQL')
    if not args.backup.is_file():
        parser.error('Backup file does not exist')
    source = conninfo_to_dict(str(settings.db_path))
    admin = source | {'dbname': 'postgres'}
    name = 'sevaro_restore_' + uuid.uuid4().hex[:12]
    restored = source | {'dbname': name}
    with psycopg.connect(**admin, autocommit=True) as connection:
        connection.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
    store = None
    try:
        environment = os.environ.copy()
        safe = dict(restored)
        password = safe.pop('password', None)
        if password is not None:
            environment['PGPASSWORD'] = password
        subprocess.run(['pg_restore', '--exit-on-error', '--no-owner', '--dbname', make_conninfo(**safe), str(args.backup)],
                       env=environment, check=True, capture_output=True)
        from urllib.parse import quote, urlencode
        target = 'postgresql://' + quote(restored.get('user', ''), safe='')
        if 'password' in restored:
            target += ':' + quote(restored['password'], safe='')
        target += '@' + restored.get('host', '127.0.0.1') + ':' + str(restored.get('port', '5432')) + '/' + name
        extras = {k: v for k, v in restored.items() if k not in {'user', 'password', 'host', 'port', 'dbname'}}
        if extras:
            target += '?' + urlencode(extras)
        store = Store(target, auto_migrate=False)
        service = Service(load_reference(settings.data_dir), store, 'restore-check')
        service.startup()
        state = service.state()
        with store.read() as connection:
            report, _ = service._report_for_run(service._current_run(connection), connection)
        with psycopg.connect(**restored) as connection:
            rows = inventory(connection)
            restored_state = connection.execute('SELECT run_id,revision,scenario_clock FROM runs WHERE is_current=1').fetchone()
        with psycopg.connect(**source) as connection:
            same_rows = rows == inventory(connection)
            same_state = restored_state == connection.execute('SELECT run_id,revision,scenario_clock FROM runs WHERE is_current=1').fetchone()
        result = {'backup_sha256': hashlib.sha256(args.backup.read_bytes()).hexdigest(),
                  'source_database_untouched': True, 'temporary_database': name, 'schema_version': store.schema_version(),
                  'row_counts': rows, 'row_counts_match_source': same_rows, 'current_state_matches_source': same_state,
                  'report_rebuilds': bool(report['coverage']['hospitals']), 'revision': state['revision'],
                  'note': 'Counts compare a quiescent source; this does not establish a production recovery SLA.'}
        if args.out:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result, indent=2))
        return 0 if same_rows and same_state and result['report_rebuilds'] else 1
    finally:
        if store:
            store.close()
        with psycopg.connect(**admin, autocommit=True) as connection:
            connection.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (subprocess.CalledProcessError, psycopg.Error):
        print('Recovery drill failed; connection details and credentials withheld.', file=sys.stderr)
        sys.exit(1)
