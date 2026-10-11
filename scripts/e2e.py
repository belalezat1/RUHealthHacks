"""Run browser verification against isolated PostgreSQL and local services.

Requires npm dependencies, Playwright Chromium and PostgreSQL CREATE DATABASE rights.
Uses only organizer records. Accounts/passwords exist only in an ephemeral private file.
"""
from __future__ import annotations
import json
import os
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import replace
from pathlib import Path
from urllib.parse import quote, urlencode
from urllib.request import urlopen
import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.api.auth import provision_user
from backend.api.config import load_settings
from backend.api.main import create_app
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def wait_ready(url, process):
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError('Local service exited before readiness')
        try:
            with urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(.1)
    raise RuntimeError('Local service readiness timed out')


def main():
    settings = load_settings()
    params = conninfo_to_dict(str(settings.db_path))
    admin = params | {'dbname': 'postgres'}
    name = 'sevaro_e2e_' + uuid.uuid4().hex[:12]
    with psycopg.connect(**admin, autocommit=True) as connection:
        connection.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
    target = 'postgresql://' + quote(params.get('user', ''), safe='')
    if 'password' in params:
        target += ':' + quote(params['password'], safe='')
    target += '@' + params.get('host', '127.0.0.1') + ':' + str(params.get('port', '5432')) + '/' + name
    extras = {k: v for k, v in params.items() if k not in {'user', 'password', 'host', 'port', 'dbname'}}
    if extras:
        target += '?' + urlencode(extras)
    processes = []
    try:
        # Keep live provider verification separate from repeatable browser regression.
        os.environ['SEVARO_JEV_ENABLED'] = 'false'
        app = create_app(replace(settings, database_url=target, mode='local', demo_password='', auto_migrate=True))
        accounts = []
        with TestClient(app):
            for username, role, physician in [('e2e-coordinator', 'coordinator', None), ('e2e-lead', 'clinical_lead', None), ('e2e-physician', 'physician', 'PHY-009')]:
                password = secrets.token_urlsafe(24)
                provision_user(app.state.store, username=username, display_name=username, role=role, physician_id=physician, password=password)
                accounts.append({'username': username, 'password': password, 'role': role})
        with tempfile.TemporaryDirectory(prefix='sevaro-browser-') as temporary:
            account_file = Path(temporary) / 'accounts.json'
            account_file.write_text(json.dumps(accounts))
            account_file.chmod(0o600)
            api_port, web_port = free_port(), free_port()
            environment = os.environ | {'SEVARO_DATABASE_URL': target, 'SEVARO_MODE': 'local',
                'SEVARO_AUTO_MIGRATE': 'false', 'SEVARO_E2E_DATABASE_URL': target,
                'SEVARO_E2E_ACCOUNTS': str(account_file), 'SEVARO_E2E_URL': f'http://127.0.0.1:{web_port}',
                'VITE_PROXY_TARGET': f'http://127.0.0.1:{api_port}'}
            with (Path(temporary) / 'services.log').open('w') as logs:
                backend = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'backend.api.main:app', '--host', '127.0.0.1', '--port', str(api_port)], cwd=ROOT, env=environment, stdout=logs, stderr=logs)
                processes.append(backend)
                wait_ready(f'http://127.0.0.1:{api_port}/health/ready', backend)
                frontend = subprocess.Popen(['npm', 'run', 'dev', '--', '--port', str(web_port), '--strictPort'], cwd=ROOT / 'frontend', env=environment, stdout=logs, stderr=logs)
                processes.append(frontend)
                wait_ready(f'http://127.0.0.1:{web_port}', frontend)
                return subprocess.run(['npm', 'run', 'test:e2e'], cwd=ROOT / 'frontend', env=environment).returncode
    finally:
        for process in reversed(processes):
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        with psycopg.connect(**admin, autocommit=True) as connection:
            connection.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))


if __name__ == '__main__':
    sys.exit(main())
