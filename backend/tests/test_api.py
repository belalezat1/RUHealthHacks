from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Assignment

pytestmark = pytest.mark.postgres


def post(client, path, body=None, **headers):
    return client.post(path, json=body or {}, headers={'Idempotency-Key': str(uuid4()), **headers})


def proposal(client):
    snapshot = client.get('/v1/dashboard').json()
    for consultation in snapshot['consultations']:
        if consultation['status'] == 'waiting':
            response = post(client, '/v1/optimizations/preview', {'consultation_id': consultation['id']})
            if response.status_code == 200:
                return response.json()
    pytest.fail('Fixture has no feasible proposal')


def consent(client, prop):
    base = '/v1/recommendations/' + prop['id']
    result = post(client, base + '/approve')
    assert result.status_code == 200, result.text
    response = post(client, base + '/physician-response', {'accepted': True},
                    **{'X-Demo-Role': 'physician', 'X-Demo-Actor': prop['candidate']['physician_id']})
    assert response.status_code == 200, response.text
    return base


def event_for(app, fixture, **changes):
    event = {'dataset_id': fixture['id'], 'source': 'synthetic_console', 'event_id': str(uuid4()),
             'event_type': 'availability', 'entity_id': fixture['dataset']['physicians'][0]['id'],
             'observed_at': app.state.clock.now().isoformat(), 'source_sequence': 100,
             'payload': {'kind': 'heartbeat', 'value': 'connected'}}
    return event | changes


def test_import_atomic_validation_second_dataset(api):
    client, app, fixtures = api
    before = client.get('/v1/dashboard').json()
    bad = deepcopy(fixtures[1]['dataset'])
    bad['physicians'][0]['id'] = ''
    assert post(client, '/v1/datasets/validate', bad).json()['valid'] is False
    assert post(client, '/v1/datasets/import', bad).status_code == 422
    assert client.get('/v1/dashboard').json()['dataset_id'] == before['dataset_id']
    assert post(client, '/v1/datasets/import', fixtures[1]['dataset']).status_code == 200
    assert client.get('/v1/dashboard').json()['dataset_id'] == fixtures[1]['id']


def test_event_dedup_conflict_batch_rollback_late_future(api):
    client, app, fixtures = api
    event = event_for(app, fixtures[0])
    first = post(client, '/v1/events', event)
    assert first.status_code == 200, first.text
    version = first.json()['source_version']
    duplicate = post(client, '/v1/events', event)
    assert duplicate.json() == {'event_id': event['event_id'], 'outcome': 'duplicate', 'source_version': version}
    assert post(client, '/v1/events', event | {'payload': {'kind': 'heartbeat', 'value': 'disconnected'}}).status_code == 409
    late = event | {'event_id': str(uuid4()), 'source_sequence': 99,
                    'observed_at': (app.state.clock.now() - timedelta(minutes=5)).isoformat()}
    result = post(client, '/v1/events', late)
    assert result.json()['outcome'] == 'late', result.text
    assert result.json()['source_version'] == version
    future = event | {'event_id': str(uuid4()), 'observed_at': (app.state.clock.now() + timedelta(days=1)).isoformat()}
    assert post(client, '/v1/events', future).status_code == 422
    total = client.get('/v1/events').json()['total']
    first_batch = event | {'event_id': 'rollback-first', 'source_sequence': 101}
    invalid = event | {'event_id': 'rollback-bad', 'entity_id': 'missing'}
    assert post(client, '/v1/events/batch', {'events': [first_batch, invalid]}).status_code == 422
    assert client.get('/v1/events').json()['total'] == total
    assert client.get('/v1/dashboard').json()['source_version'] == version


def test_full_lifecycle_requires_consent_activation_and_audit(api):
    client, app, fixtures = api
    prop = proposal(client)
    base = '/v1/recommendations/' + prop['id']
    assert post(client, base + '/approve').status_code == 200
    assert post(client, base + '/commit').status_code == 409
    assert post(client, base + '/physician-response', {'accepted': True}).status_code == 403
    assert post(client, base + '/physician-response', {'accepted': True},
                **{'X-Demo-Role': 'physician', 'X-Demo-Actor': 'wrong-physician'}).status_code == 403
    accepted = post(client, base + '/physician-response', {'accepted': True},
                    **{'X-Demo-Role': 'physician', 'X-Demo-Actor': prop['candidate']['physician_id']})
    assert accepted.status_code == 200, accepted.text
    assigned = post(client, base + '/commit')
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()['status'] == 'assigned'
    assert post(client, base + '/verify').status_code == 409
    event = event_for(app, fixtures[0], event_type='activation', entity_id=prop['candidate']['physician_id'],
                      payload={'recommendation_id': prop['id']})
    assert post(client, '/v1/events', event).status_code == 200
    verified = post(client, base + '/verify')
    assert verified.status_code == 200, verified.text
    assert verified.json()['status'] == 'verified'
    actions = {item['action'] for item in client.get('/v1/audit').json()['items']}
    assert {'recommendation.approve', 'recommendation.physician-response', 'recommendation.commit',
            'recommendation.verify'} <= actions


def test_stale_expiry_roles_scope_and_poll_stability(api):
    client, app, fixtures = api
    prop = proposal(client)
    snapshot = client.get('/v1/dashboard').json()
    assert client.get('/v1/dashboard').json()['source_version'] == snapshot['source_version']
    assert post(client, '/v1/recommendations/' + prop['id'] + '/approve',
                **{'X-Demo-Role': 'evaluator'}).status_code == 403
    assert client.get('/v1/dashboard', headers={'X-Demo-Hospitals': 'not-authorized'}).json()['hospitals'] == []
    assert post(client, '/v1/events', event_for(app, fixtures[0])).status_code == 200
    assert post(client, '/v1/recommendations/' + prop['id'] + '/approve').status_code == 409
    new = proposal(client)
    app.state.clock.advance(6)
    assert post(client, '/v1/recommendations/' + new['id'] + '/approve').status_code == 409
    unauth = client.get('/v1/dashboard', headers={'X-Demo-Role': '', 'X-Demo-Actor': ''})
    assert unauth.status_code == 401


def test_concurrent_assignment_serializes_one_winner(api, pg_engine):
    client, app, fixtures = api
    first = proposal(client)
    second = post(client, '/v1/optimizations/preview',
                  {'consultation_id': first['candidate']['consultation_id']}).json()
    bases = [consent(client, item) for item in [first, second]]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda base: post(client, base + '/commit'), bases))
    assert sorted(r.status_code for r in responses) == [200, 409], [r.text for r in responses]
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(Assignment)) == 1


def test_decision_retry_and_simulation_isolation(api):
    client, app, fixtures = api
    prop = proposal(client)
    base = '/v1/recommendations/' + prop['id']
    headers = {'Idempotency-Key': 'approve-once'}
    first = client.post(base + '/approve', json={'reason': 'test'}, headers=headers)
    second = client.post(base + '/approve', json={'reason': 'test'}, headers=headers)
    assert first.status_code == second.status_code == 200
    assert first.json()['workflow_version'] == second.json()['workflow_version']
    assert client.post(base + '/approve', json={'reason': 'different'}, headers=headers).status_code == 409
    before = client.get('/v1/dashboard').json()
    scenarios = client.get('/v1/simulations/scenarios').json()
    scenario = scenarios[0]['id']
    result = post(client, '/v1/simulations', {'scenario': scenario, 'seed': 42})
    assert result.status_code == 200, result.text
    after = client.get('/v1/dashboard').json()
    assert after['source_version'] == before['source_version']
    assert after['consultations'] == before['consultations']
    assert client.get('/v1/simulations/' + result.json()['id']).status_code == 200
