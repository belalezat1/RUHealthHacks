"""Event ordering must not bypass source versions or release capacity prematurely."""
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AvailabilitySignal, Consultation, RawEvent

pytestmark = pytest.mark.postgres


def test_equal_sequence_and_time_cannot_change_effective_availability(api, pg_engine, monkeypatch):
    client, app, fixtures = api
    from app.services import ingestion

    # Guarantee the later signal's UUID sorts higher, so the old reconciliation bug is deterministic.
    identifiers = iter(UUID(int=value) for value in range(1, 20))
    monkeypatch.setattr(ingestion, 'uuid4', lambda: next(identifiers))
    physician_id = fixtures[0]['dataset']['physicians'][0]['id']
    event = {
        'dataset_id': fixtures[0]['id'], 'source': 'synthetic-ui', 'event_id': 'exact-tie-first',
        'event_type': 'availability', 'entity_id': physician_id,
        'observed_at': app.state.clock.now().isoformat(), 'source_sequence': 100,
        'payload': {'kind': 'heartbeat', 'value': 'connected'},
    }
    first = client.post('/v1/events', json=event)
    assert first.status_code == 200, first.text
    version = first.json()['source_version']
    with Session(pg_engine) as session:
        signal_count = session.scalar(select(func.count()).select_from(AvailabilitySignal))
        event_count = session.scalar(select(func.count()).select_from(RawEvent))
    late = event | {'event_id': 'exact-tie-second', 'payload': {'kind': 'heartbeat', 'value': 'disconnected'}}
    result = client.post('/v1/events', json=late)
    assert result.status_code == 200, result.text
    assert result.json() == {'event_id': late['event_id'], 'outcome': 'late', 'source_version': version}
    snapshot = client.get('/v1/dashboard').json()
    physician = next(p for p in snapshot['physicians'] if p['id'] == physician_id)
    assert physician['availability']['connected'] is True
    assert snapshot['source_version'] == version
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(AvailabilitySignal)) == signal_count
        assert session.scalar(select(func.count()).select_from(RawEvent)) == event_count + 1
        stored = session.scalar(select(RawEvent).where(RawEvent.event_id == late['event_id']))
        assert stored.outcome == 'late'
        assert stored.data['payload']['value'] == 'disconnected'


def test_future_completion_inside_clock_tolerance_cannot_release_capacity(api, pg_engine):
    client, app, fixtures = api
    before = client.get('/v1/dashboard').json()
    consultation = next(c for c in before['consultations'] if c['status'] == 'active')
    physician_id = consultation['physician_id']
    event = {
        'dataset_id': fixtures[0]['id'], 'source': 'synthetic-ui', 'event_id': str(uuid4()),
        'event_type': 'consultation.completed', 'entity_id': consultation['id'],
        'observed_at': (app.state.clock.now() + timedelta(seconds=60)).isoformat(), 'payload': {},
    }
    with Session(pg_engine) as session:
        event_count = session.scalar(select(func.count()).select_from(RawEvent))
    response = client.post('/v1/events', json=event)
    assert response.status_code == 422, response.text
    assert 'Future completion' in response.json()['detail']
    after = client.get('/v1/dashboard').json()
    physician = next(p for p in after['physicians'] if p['id'] == physician_id)
    assert physician['availability']['workload'] == 1
    assert physician['availability']['status'] == 'busy'
    assert after['source_version'] == before['source_version']
    with Session(pg_engine) as session:
        stored = session.get(Consultation, (fixtures[0]['id'], consultation['id']))
        assert stored.status == 'active'
        assert session.scalar(select(func.count()).select_from(RawEvent)) == event_count

    # Once observation time arrives, the same event is accepted and frees the actual work slot.
    app.state.clock.advance(1)
    completion = client.post('/v1/events', json=event)
    assert completion.status_code == 200, completion.text
    assert completion.json()['outcome'] == 'applied'
    final = client.get('/v1/dashboard').json()
    physician = next(p for p in final['physicians'] if p['id'] == physician_id)
    assert physician['availability']['workload'] == 0


def test_event_reads_enforce_all_affected_hospitals_and_entity_kind(api):
    from copy import deepcopy

    client, app, fixtures = api
    dataset = deepcopy(fixtures[0]['dataset'])
    dataset['dataset_id'] = 'event-scope-' + uuid4().hex
    physician_id = dataset['physicians'][0]['id']
    # A physician with no shifts must not become visible to every scope through all([]).
    dataset['shifts'] = [s for s in dataset['shifts'] if s['physician_id'] != physician_id]
    imported = client.post('/v1/datasets/import', json=dataset, headers={'Idempotency-Key': str(uuid4())})
    assert imported.status_code == 200, imported.text
    now = app.state.clock.now()
    heartbeat = {
        'dataset_id': dataset['dataset_id'], 'source': 'synthetic-ui', 'event_id': 'private-heartbeat',
        'event_type': 'availability', 'entity_id': physician_id,
        'observed_at': now.isoformat(), 'payload': {'kind': 'heartbeat', 'value': 'connected'},
    }
    assert client.post('/v1/events', json=heartbeat).status_code == 200
    first_hospital = dataset['hospitals'][0]
    # A valid consultation ID can equal a physician ID; authorization must include the entity type.
    consultation = {
        'id': physician_id, 'hospital_id': first_hospital['id'], 'specialty': first_hospital['specialty'],
        'priority': 'routine', 'requested_at': now.isoformat(),
        'deadline_at': (now + timedelta(minutes=30)).isoformat(), 'duration_minutes': 20, 'status': 'waiting',
    }
    created = heartbeat | {'event_id': 'visible-consultation', 'event_type': 'consultation.created',
                           'payload': consultation}
    result = client.post('/v1/events', json=created)
    assert result.status_code == 200, result.text
    outside = client.get('/v1/events', headers={'X-Demo-Hospitals': 'not-authorized'})
    assert outside.status_code == 200
    assert outside.json() == {'items': [], 'total': 0}
    scoped = client.get('/v1/events', headers={'X-Demo-Hospitals': first_hospital['id']})
    assert scoped.status_code == 200
    assert [e['event_id'] for e in scoped.json()['items']] == ['visible-consultation']
    all_hospitals = ','.join(h['id'] for h in dataset['hospitals'])
    network = client.get('/v1/events', headers={'X-Demo-Hospitals': all_hospitals})
    assert network.status_code == 200
    assert {e['event_id'] for e in network.json()['items']} == {'private-heartbeat', 'visible-consultation'}
