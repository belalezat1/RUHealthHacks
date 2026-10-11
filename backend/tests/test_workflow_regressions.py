"""Integrity regressions. Fault fixtures are isolated from runtime datasets."""
from __future__ import annotations

import asyncio
import os
import uuid
from dataclasses import replace
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from backend.api.auth import provision_user
from backend.api.config import load_settings
from backend.api.main import create_app
from backend.api.store import Store
from backend.core.coverage import Commitment
from backend.core.data import load_reference
from backend.core.staffing import EMPTY_LEDGER, evaluate_candidate
from backend.tests.test_api import PASSWORD, User, full_loop_to_sent, make_settings, NEW_EVENTS


def test_accepted_work_counts_once_and_rest_uses_latest_commitment():
    ref = load_reference()
    now = ref.scenario_now
    pid = 'PHY-009'
    ref = replace(ref, physicians=ref.physicians | {pid: replace(ref.physicians[pid], hours_worked_7d=58)})
    accepted = Commitment(pid, frozenset({'SYN-005'}), now, now + timedelta(hours=2), now)
    ledger = replace(EMPTY_LEDGER, accepted=(accepted,), observed_work_intervals={pid: ((now, now + timedelta(hours=1)),)})
    result = evaluate_candidate(ref, pid, frozenset({'SYN-005'}), now + timedelta(hours=3), now + timedelta(hours=5), ledger)
    assert result['workload']['conservative_total_hours'] == 62
    assert not result['eligible']
    assert not next(r for r in result['rules'] if r['rule'] == 'rest')['passed']
    assert not next(r for r in result['rules'] if r['rule'] == 'weekly_hours')['passed']


def test_production_proxy_is_unverified_not_authorized():
    ref = load_reference()
    result = evaluate_candidate(ref, 'PHY-009', frozenset({'SYN-005'}), ref.scenario_now,
                                ref.scenario_now + timedelta(hours=2), replace(EMPTY_LEDGER, policy_mode='production'))
    assert result['eligibility_status'] == 'unverified'
    assert not result['eligible'] and result['missing_evidence']


def test_runtime_has_no_shared_password_or_sqlite(monkeypatch):
    monkeypatch.delenv('SEVARO_DEMO_PASSWORD', raising=False)
    monkeypatch.delenv('SEVARO_DATABASE_URL', raising=False)
    settings = load_settings()
    assert not settings.demo_password and not settings.test_adapter
    assert str(settings.db_path).startswith('postgresql://')


def test_payload_and_import_control_idempotency_binding(tmp_path):
    app = create_app(make_settings(tmp_path))
    with TestClient(app):
        coord = User(app, 'coordinator')
        first = coord.post('/api/v1/clock', json={'minutes': 1}, key='clock-key')
        assert first.status_code == 200
        changed = coord.post('/api/v1/clock', json={'minutes': 30}, key='clock-key')
        assert changed.status_code == 409 and changed.json()['error']['code'] == 'idempotency_key_reused'
        imported = coord.post('/api/v1/events/import?advance_clock=false', content=NEW_EVENTS, key='csv-key')
        assert imported.status_code == 200
        changed = coord.post('/api/v1/events/import?advance_clock=true', content=NEW_EVENTS, key='csv-key')
        assert changed.status_code == 409
        changed = coord.post('/api/v1/events/import?advance_clock=false', content=NEW_EVENTS.replace('Consult triaged', 'Changed evidence'), key='csv-key')
        assert changed.status_code == 409
        assert coord.c.get('/api/v1/demo-accounts').status_code == 404


def test_preview_is_immutable_and_proposal_rechecks_revision(tmp_path):
    app = create_app(make_settings(tmp_path))
    with TestClient(app):
        coord = User(app, 'coordinator')
        preview = coord.post('/api/v1/decisions/preview', json={}, key='preview')
        assert preview.status_code == 200, preview.text
        decision = preview.json()['result']
        assert decision['selected_action']['kind'] == 'scoped_split_shift'
        replayed = coord.post('/api/v1/decisions/preview', json={}, key='preview')
        assert replayed.json()['result']['decision_id'] == decision['decision_id']
        with app.state.store.read() as conn:
            assert conn.execute('SELECT COUNT(*) n FROM decisions').fetchone()['n'] == 1
        changed = coord.post('/api/v1/offers/propose', json={'decision_id': decision['decision_id'], 'physician_ids': ['PHY-010']})
        assert changed.status_code == 409 and changed.json()['error']['code'] == 'decision_terms_changed'
        coord.post('/api/v1/clock', json={'minutes': 1})
        stale = coord.post('/api/v1/offers/propose', json={'decision_id': decision['decision_id']})
        assert stale.status_code == 409 and stale.json()['error']['code'] == 'stale_decision'


def test_provider_io_outside_transaction_and_real_selection_applied(tmp_path):
    app = create_app(make_settings(tmp_path))
    with TestClient(app):
        coord = User(app, 'coordinator')
        engine = app.state.decision_engine
        original = engine.select

        async def selected(report, **kwargs):
            # A second transaction can acquire the store while selection is pending.
            with app.state.store.tx() as conn:
                assert conn.execute('SELECT COUNT(*) n FROM offers').fetchone()['n'] == 0
            result = await original(report, **kwargs)
            result['source'] = 'jev'
            result['provider']['status'] = 'available'
            return result

        engine.select = selected
        proposed = coord.post('/api/v1/offers/propose', json={})
        assert proposed.status_code == 200, proposed.text
        with app.state.store.read() as conn:
            import json
            row = conn.execute('SELECT rationale FROM offers').fetchone()
            assert json.loads(row['rationale'])['decision_source'] == 'jev'


@pytest.fixture()
def pg_url():
    """A fresh PostgreSQL database, explicitly enabled by the test runner."""
    base = os.environ.get('SEVARO_TEST_DATABASE_URL')
    if not base:
        pytest.skip('Set SEVARO_TEST_DATABASE_URL to run real PostgreSQL integrity checks')
    import psycopg
    from psycopg.conninfo import conninfo_to_dict, make_conninfo
    from psycopg import sql
    params = conninfo_to_dict(base)
    params['dbname'] = 'postgres'
    admin = make_conninfo(**params)
    name = 'sevaro_test_' + uuid.uuid4().hex[:12]
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
    params['dbname'] = name
    # The Store API accepts URLs, so retain all connection options explicitly.
    from urllib.parse import urlencode
    target = f"postgresql://{params.get('user', 'b')}@{params.get('host', '127.0.0.1')}:{params.get('port', '55433')}/{name}"
    try:
        yield target
    finally:
        with psycopg.connect(admin, autocommit=True) as conn:
            conn.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))


def test_postgres_offer_loop_restart_and_transaction_rollback(pg_url, tmp_path, monkeypatch):
    monkeypatch.setenv('SEVARO_JEV_ENABLED', 'false')
    settings = replace(make_settings(tmp_path), database_url=pg_url, demo_password='')
    app = create_app(settings)
    with TestClient(app):
        for username, role, pid in [('coordinator', 'coordinator', None), ('lead', 'clinical_lead', None), ('phy-009', 'physician', 'PHY-009')]:
            provision_user(app.state.store, username=username, display_name=username, role=role, physician_id=pid, password=PASSWORD)
        coord, lead, physician = User(app, 'coordinator'), User(app, 'lead'), User(app, 'phy-009')
        assert app.state.store.postgres
        oid = full_loop_to_sent(coord, lead)
        response = physician.post(f'/api/v1/offers/{oid}/accept')
        assert response.status_code == 200, response.text
        state = coord.state()
        with pytest.raises(RuntimeError):
            with app.state.store.tx() as conn:
                conn.execute("UPDATE offers SET status_reason='uncommitted' WHERE offer_id=?", (oid,))
                raise RuntimeError('fault injection')
        with app.state.store.read() as conn:
            assert conn.execute('SELECT status_reason FROM offers WHERE offer_id=?', (oid,)).fetchone()['status_reason'] == ''
    restarted = create_app(settings)
    with TestClient(restarted):
        coord = User(restarted, 'coordinator')
        assert coord.state()['run_id'] == state['run_id'] and coord.state()['revision'] == state['revision']
        assert any(o['offer_id'] == oid and o['status'] == 'accepted' for o in coord.report()['offers'])
        assert restarted.state.store.schema_version() == 2


def test_postgres_database_constraints_across_connections(pg_url, tmp_path, monkeypatch):
    import psycopg
    monkeypatch.setenv('SEVARO_JEV_ENABLED', 'false')
    settings = replace(make_settings(tmp_path), database_url=pg_url, demo_password='')
    app = create_app(settings)
    with TestClient(app):
        provision_user(app.state.store, username='coordinator', display_name='Coordinator', role='coordinator', password=PASSWORD)
        coord = User(app, 'coordinator')
        r = coord.post('/api/v1/offers/propose', json={})
        assert r.status_code == 200, r.text
        oid = r.json()['result']['offer_ids'][0]
        second_store = Store(pg_url, auto_migrate=False)
        with app.state.store.read() as conn:
            row = dict(conn.execute('SELECT * FROM offers WHERE offer_id=?', (oid,)).fetchone())
        row['offer_id'] = 'FAULT-DUPLICATE'
        with pytest.raises(psycopg.errors.UniqueViolation):
            with second_store.tx() as conn:
                conn.execute(f"INSERT INTO offers({','.join(row)}) VALUES({','.join('?' for _ in row)})", tuple(row.values()))
        with app.state.store.tx() as conn:
            conn.execute("UPDATE offers SET status='accepted', accepted_start=window_start::timestamptz, "
                         "accepted_end=window_end::timestamptz, online_at=window_start WHERE offer_id=?", (oid,))
        row.update(status='accepted', accepted_start=row['window_start'], accepted_end=row['window_end'], online_at=row['window_start'])
        with pytest.raises(psycopg.errors.ExclusionViolation):
            with second_store.tx() as conn:
                conn.execute(f"INSERT INTO offers({','.join(row)}) VALUES({','.join('?' for _ in row)})", tuple(row.values()))
        second_store.close()


def test_postgres_two_application_acceptance_race_has_one_winner(pg_url, tmp_path, monkeypatch):
    """Altered race state is isolated to this disposable test database."""
    import threading
    monkeypatch.setenv('SEVARO_JEV_ENABLED', 'false')
    settings = replace(make_settings(tmp_path), database_url=pg_url, demo_password='')
    a, b = create_app(settings), create_app(settings)
    with TestClient(a), TestClient(b):
        for username, role, pid in [('coordinator', 'coordinator', None), ('lead', 'clinical_lead', None),
                                    ('phy-009', 'physician', 'PHY-009'), ('phy-011', 'physician', 'PHY-011')]:
            provision_user(a.state.store, username=username, display_name=username, role=role, physician_id=pid, password=PASSWORD)
        coord, lead = User(a, 'coordinator'), User(a, 'lead')
        oid = full_loop_to_sent(coord, lead)
        with a.state.store.tx() as conn:
            row = dict(conn.execute('SELECT * FROM offers WHERE offer_id=?', (oid,)).fetchone())
            conn.execute('UPDATE gaps SET slots=1 WHERE gap_id=?', (row['gap_id'],))
            row.update(offer_id='OFF-FAULT-RACE', physician_id='PHY-011')
            conn.execute(f"INSERT INTO offers({','.join(row)}) VALUES({','.join('?' for _ in row)})", tuple(row.values()))
        # The race tests durable claiming, not altered-fixture credential eligibility.
        a.state.service._revalidate = b.state.service._revalidate = lambda *_: {'eligible': True, 'failed_rules': []}
        first, second = User(a, 'phy-009'), User(b, 'phy-011')
        state = first.state()
        responses = []
        barrier = threading.Barrier(2)

        def accept(user, offer):
            barrier.wait()
            responses.append(user.post(f'/api/v1/offers/{offer}/accept', revision=state['revision'], run=state['run_id']))

        threads = [threading.Thread(target=accept, args=(first, oid)),
                   threading.Thread(target=accept, args=(second, 'OFF-FAULT-RACE'))]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
            assert not thread.is_alive()
        assert sorted(r.status_code for r in responses) == [200, 409]
        with a.state.store.read() as conn:
            assert conn.execute("SELECT COUNT(*) n FROM offers WHERE status='accepted'").fetchone()['n'] == 1
            assert conn.execute('SELECT COUNT(*) n FROM gap_claims').fetchone()['n'] == 1


def test_actionlab_is_read_only_and_does_not_generate_outcomes(tmp_path):
    app = create_app(make_settings(tmp_path))
    with TestClient(app):
        coord = User(app, 'coordinator')
        state = coord.state()
        response = coord.c.get('/api/v1/actionlab')
        assert response.status_code == 200, response.text
        data = response.json()['data']
        assert data['scope'] == 'recorded_replay'
        assert coord.state()['revision'] == state['revision']
        with app.state.store.read() as conn:
            assert conn.execute('SELECT COUNT(*) n FROM offers').fetchone()['n'] == 0


def test_approved_terms_mutation_is_rejected(tmp_path):
    app = create_app(make_settings(tmp_path))
    with TestClient(app):
        coord, lead = User(app, 'coordinator'), User(app, 'lead')
        proposal = coord.post('/api/v1/offers/propose', json={})
        oid = proposal.json()['result']['offer_ids'][0]
        assert lead.post(f'/api/v1/offers/{oid}/approve').status_code == 200
        with app.state.store.tx() as conn:
            conn.execute('UPDATE offers SET minutes_to_online=0 WHERE offer_id=?', (oid,))
        rejected = coord.post(f'/api/v1/offers/{oid}/send')
        assert rejected.status_code == 409 and 'immutable terms changed' in rejected.text
