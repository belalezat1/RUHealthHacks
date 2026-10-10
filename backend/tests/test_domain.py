import json
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.schemas.events import Dataset
from app.services.availability import reconcile
from app.services.eligibility import evaluate
from app.services.forecast import build_forecast
from app.services.optimizer import preview

ROOT = Path(__file__).resolve().parents[2]
NOW = datetime(2026, 10, 10, 16, tzinfo=UTC)
POLICY = json.loads((ROOT / 'config/demo_policies.json').read_text())


def at(minutes):
    return (NOW + timedelta(minutes=minutes)).isoformat()


@pytest.fixture
def state():
    return {
        'dataset_id': 'unit-synthetic', 'source_version': 1,
        'hospitals': [{'id': 'hospital-a', 'name': 'Synthetic A', 'jurisdiction': 'NJ',
                       'specialty': 'neurology', 'minimum_coverage': 0, 'arrival_work_minutes_per_bin': 0},
                      {'id': 'hospital-b', 'name': 'Synthetic B', 'jurisdiction': 'NJ',
                       'specialty': 'neurology', 'minimum_coverage': 0, 'arrival_work_minutes_per_bin': 0}],
        'physicians': [{'id': 'physician-x', 'name': 'Synthetic X', 'specialties': ['neurology'],
                        'max_concurrent': 1}],
        'credentials': [{'id': 'license-x', 'physician_id': 'physician-x', 'kind': 'license',
                         'jurisdiction': 'NJ', 'expires_at': at(10000)},
                        {'id': 'privilege-a', 'physician_id': 'physician-x', 'kind': 'privilege',
                         'hospital_id': 'hospital-a', 'expires_at': at(10000)},
                        {'id': 'privilege-b', 'physician_id': 'physician-x', 'kind': 'privilege',
                         'hospital_id': 'hospital-b', 'expires_at': at(10000)}],
        'shifts': [{'id': 'shift-a', 'physician_id': 'physician-x', 'hospital_id': 'hospital-a',
                    'start_at': at(-30), 'end_at': at(90), 'status': 'scheduled', 'mandatory': False}],
        'signals': [{'id': 'heartbeat-x', 'physician_id': 'physician-x', 'source': 'synthetic_monitor',
                     'kind': 'heartbeat', 'value': 'connected', 'observed_at': at(0), 'received_at': at(0),
                     'source_sequence': 10},
                    {'id': 'self-report-x', 'physician_id': 'physician-x', 'source': 'synthetic_monitor',
                     'kind': 'self_report', 'value': 'available', 'observed_at': at(0), 'received_at': at(0),
                     'source_sequence': 10}],
        'consultations': [{'id': 'consult-a', 'hospital_id': 'hospital-a', 'specialty': 'neurology',
                           'priority': 'urgent', 'requested_at': at(-5), 'deadline_at': at(15),
                           'duration_minutes': 20, 'status': 'waiting'}], 'assignments': [],
    }


def check(state, action='contact', **kwargs):
    return evaluate(state, 'physician-x', 'hospital-a', 'consult-a', action, NOW, POLICY, **kwargs)


def codes(result, status=None):
    return {r['code'] for r in result['rules'] if status is None or r['status'] == status}


def test_contact_vs_assignment_consent_is_explicit_even_on_shift(state):
    assert check(state)['outcome'] == 'eligible'
    assert 'CONSENT_REQUIRED' in codes(check(state, 'assign'), 'fail')
    assert check(state, 'assign', consent=True)['outcome'] == 'eligible'
    state['shifts'] = []
    assert check(state)['outcome'] == 'eligible'
    assert check(state, 'assign', consent=True)['outcome'] == 'eligible'


@pytest.mark.parametrize('mutation,expected,outcome', [
    ('missing_license', 'LICENSE_MISSING', 'unverified'),
    ('missing_privilege', 'PRIVILEGE_MISSING', 'unverified'),
    ('unknown_expiry', 'CREDENTIAL_EXPIRY_UNKNOWN', 'unverified'),
    ('expired', 'CREDENTIAL_EXPIRED', 'ineligible'),
    ('expires_during_work', 'CREDENTIAL_EXPIRED', 'ineligible'),
    ('specialty', 'SPECIALTY_MISMATCH', 'ineligible'),
])
def test_qualification_evidence_is_never_invented(state, mutation, expected, outcome):
    if mutation == 'missing_license':
        state['credentials'] = state['credentials'][1:]
    elif mutation == 'missing_privilege':
        state['credentials'] = [c for c in state['credentials'] if c['id'] != 'privilege-a']
    elif mutation == 'unknown_expiry':
        state['credentials'][0]['expires_at'] = None
    elif mutation == 'expired':
        state['credentials'][0]['expires_at'] = at(-1)
    elif mutation == 'expires_during_work':
        state['credentials'][0]['expires_at'] = at(10)
    else:
        state['physicians'][0]['specialties'] = ['cardiology']
    result = check(state)
    assert result['outcome'] == outcome
    assert expected in codes(result)
    assert all({'observed', 'required', 'source', 'observed_at', 'explanation'} <= r.keys() for r in result['rules'])


def test_stale_heartbeat_is_not_rescued_by_available_self_report_or_received_time(state):
    state['signals'][0].update(observed_at=at(-10), received_at=at(0))
    status = reconcile(state, 'physician-x', NOW, POLICY)
    assert not status['connected'] and status['stale']
    assert status['conflicts']
    assert check(state)['outcome'] == 'unverified'


def test_heartbeat_alone_does_not_establish_availability(state):
    state['signals'] = state['signals'][:1]
    assert reconcile(state, 'physician-x', NOW, POLICY)['status'] == 'unknown'
    assert check(state)['outcome'] == 'unverified'


def test_sequence_precedes_timestamp_and_order_is_stable(state):
    late = {**state['signals'][0], 'id': 'later-time-lower-sequence', 'source_sequence': 9,
            'value': 'disconnected', 'observed_at': at(0)}
    state['signals'][0]['observed_at'] = at(-1)
    state['signals'].append(late)
    result = reconcile(state, 'physician-x', NOW, POLICY)
    state['signals'].reverse()
    assert result == reconcile(state, 'physician-x', NOW, POLICY)
    assert result['connected']
    state['signals'].append({**late, 'id': 'higher-sequence-older-clock', 'source_sequence': 11,
                             'observed_at': at(-2)})
    assert not reconcile(state, 'physician-x', NOW, POLICY)['connected']


def test_future_evidence_excluded_and_conflicting_sources_are_visible(state):
    state['signals'].append({**state['signals'][0], 'id': 'future', 'source_sequence': 100,
                             'value': 'disconnected', 'observed_at': at(5)})
    result = reconcile(state, 'physician-x', NOW, POLICY)
    assert result['connected'] and any('FUTURE_SIGNAL' in c for c in result['conflicts'])
    state['signals'].append({**state['signals'][0], 'id': 'conflict', 'source': 'synthetic-ui',
                             'value': 'disconnected'})
    assert 'SIGNALS_CONSISTENT' in codes(check(state), 'unknown')


def test_clock_only_shift_ending_and_staleness(state):
    state['shifts'][0]['end_at'] = at(2)
    assert reconcile(state, 'physician-x', NOW, POLICY)['on_shift']
    advanced = reconcile(state, 'physician-x', NOW + timedelta(minutes=3), POLICY)
    assert not advanced['on_shift'] and not advanced['stale']
    assert reconcile(state, 'physician-x', NOW + timedelta(minutes=6), POLICY)['stale']
    forecast = build_forecast(state, NOW, POLICY)
    assert forecast['intervals'][0]['capacity_minutes'] == 2
    assert build_forecast(state, NOW + timedelta(minutes=3), POLICY)['intervals'][0]['capacity_minutes'] == 0


def test_busy_and_active_continuity_override_self_report(state):
    state['consultations'].append({**state['consultations'][0], 'id': 'other-active', 'status': 'active',
                                    'physician_id': 'physician-x', 'hospital_id': 'hospital-b',
                                    'requested_at': at(-100), 'expected_end_at': at(-50)})
    assert reconcile(state, 'physician-x', NOW, POLICY)['status'] == 'busy'
    result = check(state, 'assign', consent=True)
    assert {'ALREADY_OCCUPIED', 'ACTIVE_CONSULTATION_CONTINUITY'} <= codes(result, 'fail')
    state['consultations'].pop()
    state['signals'].append({**state['signals'][0], 'id': 'activity-x', 'kind': 'activity', 'value': 'busy'})
    assert 'ALREADY_OCCUPIED' in codes(check(state), 'fail')


def test_assignment_overlap_and_global_capacity(state):
    state['assignments'].append({'id': 'future-work', 'consultation_id': 'other', 'physician_id': 'physician-x',
                                 'hospital_id': 'hospital-b', 'start_at': at(10), 'end_at': at(30), 'status': 'assigned'})
    assert 'ALREADY_OCCUPIED' in codes(check(state), 'fail')


def test_split_shift_trap_beyond_visible_horizon(state):
    state['shifts'] = [{**state['shifts'][0], 'id': 'next-commitment', 'start_at': at(150), 'end_at': at(330),
                        'hospital_id': 'hospital-b', 'mandatory': True}]
    state['consultations'][0]['duration_minutes'] = 45
    result = check(state)
    assert 'REST_VIOLATION' in codes(result, 'fail')
    observed = next(r['observed'] for r in result['rules'] if r['code'] == 'REST_VIOLATION')
    assert observed[0]['gap_minutes'] == 105
    state['shifts'][0]['start_at'] = at(180)
    assert check(state)['outcome'] == 'eligible'


def test_rest_before_new_block_maximum_work_and_extension(state):
    state['shifts'][0].update(start_at=at(-200), end_at=at(-60))
    assert 'REST_VIOLATION' in codes(check(state), 'fail')
    state['shifts'][0].update(start_at=at(-480), end_at=at(30))
    assert 'CONTINUOUS_WORK_LIMIT' in codes(check(state), 'fail')
    state['shifts'][0].update(start_at=at(-60), end_at=at(1))
    state['consultations'][0]['duration_minutes'] = 40
    assert 'SHIFT_EXTENSION_LIMIT' in codes(check(state), 'fail')


def test_minimum_activation_block_is_explicit_demo_policy(state):
    state['consultations'][0]['duration_minutes'] = 5
    assert check(state)['outcome'] == 'eligible'
    state['shifts'] = []
    assert 'MINIMUM_ACTIVATION_BLOCK' in codes(check(state), 'fail')


def test_optimizer_projects_full_horizon_without_mutating_state(state):
    state['shifts'] = []
    before = deepcopy(state)
    candidate = preview(state, 'consult-a', NOW, POLICY)['selected']
    assert state == before
    assert candidate['expected_effect']['capacity_gain_minutes_90m'] == 20
    assert candidate['expected_effect']['mean_bin_unmet_minutes_after'] < \
        candidate['expected_effect']['mean_bin_unmet_minutes_before']


def test_cross_hospital_mandatory_and_minimum_coverage(state):
    state['shifts'][0].update(hospital_id='hospital-b', mandatory=True)
    assert 'COVERAGE_CONTINUITY_FAILURE' in codes(check(state), 'fail')
    state['shifts'][0]['mandatory'] = False
    state['hospitals'][1]['minimum_coverage'] = 1
    assert 'COVERAGE_CONTINUITY_FAILURE' in codes(check(state), 'fail')
    state['hospitals'][1]['minimum_coverage'] = 0
    assert check(state)['outcome'] == 'eligible'


def test_coverage_replacement_cannot_be_reused_across_facilities(state):
    state['hospitals'][0]['minimum_coverage'] = 1
    state['hospitals'][1]['minimum_coverage'] = 1
    state['hospitals'].append({**state['hospitals'][0], 'id': 'hospital-c', 'minimum_coverage': 0})
    state['credentials'].append({**state['credentials'][1], 'id': 'privilege-c', 'hospital_id': 'hospital-c'})
    state['physicians'].append({**state['physicians'][0], 'id': 'replacement'})
    for credential in list(state['credentials']):
        state['credentials'].append({**credential, 'id': credential['id'] + '-replacement',
                                     'physician_id': 'replacement'})
    for signal in list(state['signals']):
        state['signals'].append({**signal, 'id': signal['id'] + '-replacement', 'physician_id': 'replacement'})
    for hid in ['hospital-a', 'hospital-b']:
        state['shifts'].append({**state['shifts'][0], 'id': 'replacement-' + hid,
                                'physician_id': 'replacement', 'hospital_id': hid})
    state['consultations'][0]['hospital_id'] = 'hospital-c'
    result = evaluate(state, 'physician-x', 'hospital-c', 'consult-a', 'contact', NOW, POLICY)
    assert 'COVERAGE_CONTINUITY_FAILURE' in codes(result, 'fail')
    reasons = next(r['observed'] for r in result['rules'] if r['code'] == 'COVERAGE_CONTINUITY_FAILURE')
    assert any('unfilled_minimum_coverage' in reason for reason in reasons)


def test_shared_capacity_never_multiplied_across_hospitals(state):
    state['shifts'].append({**state['shifts'][0], 'id': 'shift-b', 'hospital_id': 'hospital-b'})
    state['consultations'].append({**state['consultations'][0], 'id': 'consult-b', 'hospital_id': 'hospital-b'})
    original = deepcopy(state)
    forecast = build_forecast(state, NOW, POLICY)
    assert state == original
    assert len(forecast['intervals']) == 6
    assert all(i['capacity_minutes'] <= 15 for i in forecast['intervals'])
    assert sum(i['capacity_minutes'] for i in forecast['intervals']) == 90
    assert forecast['intervals'][0]['unmet_minutes'] == 25
    assert sum(h['capacity_minutes'] for h in forecast['intervals'][0]['hospitals']) == 15


def test_forecast_rejects_unqualified_and_unaccepted_offshift_capacity(state):
    state['credentials'][0]['expires_at'] = at(-1)
    assert build_forecast(state, NOW, POLICY)['intervals'][0]['capacity_minutes'] == 0
    state['credentials'][0]['expires_at'] = at(1000)
    state['shifts'] = []
    assert build_forecast(state, NOW, POLICY)['intervals'][0]['capacity_minutes'] == 0
    assert preview(state, 'consult-a', NOW, POLICY)['selected']['action'] == 'activate'


def test_wrong_specialty_backlog_cannot_be_erased_by_idle_capacity(state):
    state['consultations'][0]['specialty'] = 'cardiology'
    forecast = build_forecast(state, NOW, POLICY)
    assert forecast['intervals'][0]['unmet_minutes'] == 20
    assert forecast['intervals'][-1]['unmet_minutes'] == 20


def test_forecast_deadlines_are_source_data_and_clock_advances(state):
    state['consultations'][0]['duration_minutes'] = 60
    forecast = build_forecast(state, NOW, POLICY)
    assert forecast['intervals'][1]['hospitals'][0]['severity'] == 'critical'
    later = build_forecast(state, NOW + timedelta(minutes=1), POLICY)
    assert forecast['as_of'] != later['as_of']
    assert later['intervals'][0]['start_at'] == at(1)


def test_two_fixture_schemas_work_without_id_or_order_assumptions():
    for filename in ['01_split_shift.json', '02_regional_network.json']:
        state = json.loads((ROOT / 'data/synthetic' / filename).read_text())
        Dataset.model_validate(state)
        original = deepcopy(state)
        consultation = next(c for c in state['consultations'] if c['duration_minutes'] == 45)
        plan = preview(state, consultation['id'], NOW, POLICY)
        assert plan['selected']
        assert plan['selected']['action'] == 'activate'
        assert plan['selected']['eligibility']['outcome'] == 'eligible'
        assert any('REST_VIOLATION' in codes(r['eligibility'], 'fail') for r in plan['rejected'])
        for key in ['hospitals', 'physicians', 'credentials', 'shifts', 'signals', 'consultations']:
            state[key].reverse()
        assert preview(state, consultation['id'], NOW, POLICY) == plan
        assert original['consultations'] != state['consultations']


def test_optimizer_fallback_and_rejected_evidence_are_honest(state):
    greedy = preview(state, 'consult-a', NOW, POLICY)
    cp_sat = preview(state, 'consult-a', NOW, POLICY, 'cp_sat')
    assert cp_sat['selected']['physician_id'] == greedy['selected']['physician_id']
    assert cp_sat['solver']['status'] in {'fallback', 'optimal', 'feasible'}
    state['credentials'] = []
    rejected = preview(state, 'consult-a', NOW, POLICY)
    assert rejected['selected'] is None
    assert rejected['rejected'][0]['eligibility']['outcome'] == 'unverified'
    assert 'Missing' in rejected['rejected'][0]['explanation']
