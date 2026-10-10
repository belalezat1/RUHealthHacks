from copy import deepcopy
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.services.decisions import verification_eligibility

START = datetime(2026, 10, 10, 16, tzinfo=UTC)


def at(minutes):
    return (START + timedelta(minutes=minutes)).isoformat()


@pytest.fixture
def continuing():
    assignment = {'id': 'accepted-work', 'physician_id': 'synthetic-physician', 'hospital_id': 'synthetic-hospital',
                  'consultation_id': 'synthetic-consultation', 'start_at': at(0), 'end_at': at(20), 'status': 'assigned'}
    state = {'dataset_id': 'verification-test', 'source_version': 3,
             'physicians': [{'id': 'synthetic-physician', 'specialties': ['neurology'], 'max_concurrent': 1}],
             'hospitals': [{'id': 'synthetic-hospital', 'jurisdiction': 'NJ', 'specialty': 'neurology'}],
             'credentials': [
                 {'id': 'license', 'physician_id': 'synthetic-physician', 'kind': 'license',
                  'jurisdiction': 'NJ', 'expires_at': at(1000)},
                 {'id': 'privilege', 'physician_id': 'synthetic-physician', 'kind': 'privilege',
                  'hospital_id': 'synthetic-hospital', 'expires_at': at(1000)}],
             'shifts': [], 'assignments': [assignment],
             'consultations': [{'id': 'synthetic-consultation', 'hospital_id': 'synthetic-hospital',
                                'physician_id': 'synthetic-physician', 'specialty': 'neurology', 'priority': 'routine',
                                'status': 'assigned', 'duration_minutes': 20, 'requested_at': at(-1),
                                'deadline_at': at(20)}],
             'signals': [{'id': 'heartbeat', 'physician_id': 'synthetic-physician', 'source': 'synthetic_monitor',
                          'kind': 'heartbeat', 'value': 'connected', 'observed_at': at(18)},
                         {'id': 'available', 'physician_id': 'synthetic-physician', 'source': 'synthetic_monitor',
                          'kind': 'self_report', 'value': 'available', 'observed_at': at(18)}]}
    return state, assignment, START + timedelta(minutes=18)


def test_late_verification_is_continuation_not_a_short_new_activation(continuing):
    state, assignment, now = continuing
    original = deepcopy(state)
    result = verification_eligibility(state, assignment, now, {'min_activation_block_minutes': 15})
    assert result['outcome'] == 'eligible'
    block = next(r for r in result['rules'] if r['code'] == 'MINIMUM_ACTIVATION_BLOCK')
    assert block['observed']['remaining_minutes'] == 2
    assert block['observed']['committed_minutes'] == 20
    assert block['source'] == 'committed_assignment'
    assert state == original


@pytest.mark.parametrize('limit,code', [('max_continuous_work_minutes', 'CONTINUOUS_WORK_LIMIT'),
                                      ('max_work_minutes_24h', 'MAXIMUM_WORK_LIMIT')])
def test_verification_retains_elapsed_committed_work_for_current_limits(continuing, limit, code):
    state, assignment, now = continuing
    result = verification_eligibility(state, assignment, now, {limit: 15})
    rule = next(r for r in result['rules'] if r['code'] == code)
    assert result['outcome'] == 'ineligible'
    assert rule['observed'] == 20 and rule['status'] == 'fail'


def test_verification_retains_prior_rest_and_other_occupancy_checks(continuing):
    state, assignment, now = continuing
    state['assignments'].append({**assignment, 'id': 'new-historical-evidence',
                                'consultation_id': 'prior-work', 'start_at': at(-200),
                                'end_at': at(-110), 'status': 'completed'})
    result = verification_eligibility(state, assignment, now, {'min_rest_minutes': 120})
    assert any(r['code'] == 'REST_VIOLATION' and r['status'] == 'fail' for r in result['rules'])
    state['assignments'].pop()
    state['consultations'].append({**state['consultations'][0], 'id': 'competing-active', 'status': 'active'})
    result = verification_eligibility(state, assignment, now, {})
    assert any(r['code'] == 'ALREADY_OCCUPIED' and r['status'] == 'fail' for r in result['rules'])


def test_verification_does_not_extend_an_ended_assignment(continuing):
    state, assignment, _ = continuing
    with pytest.raises(HTTPException, match='outside its committed work interval') as error:
        verification_eligibility(state, assignment, START + timedelta(minutes=20), {})
    assert error.value.status_code == 409


@pytest.mark.postgres
def test_postgres_activation_verification_near_end_of_committed_block(api):
    client, app, fixtures = api

    def post(path, body, **headers):
        return client.post(path, json=body, headers={'Idempotency-Key': str(uuid4()), **headers})

    consultation = next(c for c in fixtures[0]['dataset']['consultations'] if c['duration_minutes'] == 45)
    proposed = post('/v1/optimizations/preview', {'consultation_id': consultation['id']})
    assert proposed.status_code == 200, proposed.text
    proposal = proposed.json()
    base = '/v1/recommendations/' + proposal['id']
    assert post(base + '/approve', {}).status_code == 200
    assert post(base + '/physician-response', {'accepted': True}, **{
        'X-Demo-Role': 'physician', 'X-Demo-Actor': proposal['candidate']['physician_id']}).status_code == 200
    committed = post(base + '/commit', {})
    assert committed.status_code == 200, committed.text
    app.state.clock.advance(44)
    common = {'dataset_id': fixtures[0]['id'], 'source': 'synthetic_console',
              'entity_id': proposal['candidate']['physician_id'], 'observed_at': app.state.clock.now().isoformat(),
              'source_sequence': 100}
    for event_type, payload in [('availability', {'kind': 'heartbeat', 'value': 'connected'}),
                                ('activation', {'recommendation_id': proposal['id']})]:
        response = post('/v1/events', {**common, 'event_id': str(uuid4()), 'event_type': event_type, 'payload': payload})
        assert response.status_code == 200, response.text
    verified = post(base + '/verify', {})
    assert verified.status_code == 200, verified.text
    assert verified.json()['status'] == 'verified'
