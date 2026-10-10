"""Exercise the running API; synthetic state changes are intentional and audited."""
import json
import os
import time
from datetime import UTC, datetime
from uuid import uuid4

import httpx


def main():
    url = os.getenv('API_BASE_URL', 'http://127.0.0.1:8000')
    headers = {'X-Demo-Role': 'dispatcher', 'X-Demo-Actor': 'demo-smoke'}
    if os.getenv('SEVARO_ACCESS_TOKEN'):
        headers = {'Authorization': 'Bearer ' + os.environ['SEVARO_ACCESS_TOKEN']}
    with httpx.Client(base_url=url, headers=headers, timeout=30) as client:
        def get(path):
            response = client.get(path)
            response.raise_for_status()
            return response.json()
        def post(path, body=None, actor=None):
            h = {'Idempotency-Key': str(uuid4())}
            if actor:
                h.update({'X-Demo-Role': 'physician', 'X-Demo-Actor': actor})
            response = client.post(path, json=body or {}, headers=h)
            response.raise_for_status()
            return response.json()
        assert get('/ready')['status'] == 'ready'
        fixtures = get('/v1/datasets/examples')
        # Unique namespace prevents smoke from destroying existing dataset records.
        fixture = fixtures[0]['dataset']
        fixture['dataset_id'] += '-smoke-' + uuid4().hex[:8]
        assert post('/v1/datasets/validate', fixture)['valid']
        post('/v1/datasets/import', fixture)
        snapshot = get('/v1/dashboard')
        waiting = next(c for c in snapshot['consultations'] if c['status'] == 'waiting')
        event = {'dataset_id': fixture['dataset_id'], 'source': 'synthetic_smoke',
                 'event_id': str(uuid4()), 'event_type': 'consultation.created',
                 'entity_id': 'smoke-surge-' + uuid4().hex[:6], 'observed_at': datetime.now(UTC).isoformat(),
                 'payload': {**waiting, 'id': 'placeholder'}}
        event['payload']['id'] = event['entity_id']
        started = time.perf_counter()
        outcome = post('/v1/events', event)
        changed = get('/v1/dashboard')
        latency_ms = (time.perf_counter() - started) * 1000
        assert changed['source_version'] == outcome['source_version']
        assert len(changed['consultations']) == len(snapshot['consultations']) + 1
        prop = post('/v1/optimizations/preview', {'consultation_id': waiting['id']})
        base = '/v1/recommendations/' + prop['id']
        assert post(base + '/approve')['status'] == 'approved_for_contact'
        assert post(base + '/physician-response', {'accepted': True, 'reason': 'Synthetic physician response'},
                    prop['candidate']['physician_id'])['status'] == 'physician_accepted'
        assert post(base + '/commit')['status'] == 'assigned'
        post('/v1/events', {'dataset_id': fixture['dataset_id'], 'source': 'synthetic_smoke',
                           'event_id': str(uuid4()), 'event_type': 'activation',
                           'entity_id': prop['candidate']['physician_id'],
                           'observed_at': datetime.now(UTC).isoformat(), 'payload': {'recommendation_id': prop['id']}})
        assert post(base + '/verify')['status'] == 'verified'
        assert get('/v1/audit')['total'] >= 7
        scenario = get('/v1/simulations/scenarios')[0]['id']
        run = post('/v1/simulations', {'scenario': scenario, 'seed': 42})
        second = fixtures[1]['dataset']
        second['dataset_id'] += '-smoke-' + uuid4().hex[:8]
        post('/v1/datasets/import', second)
        assert get('/v1/dashboard')['dataset_id'] == second['dataset_id']
        print(json.dumps({'status': 'passed', 'api': url, 'event_to_snapshot_ms': round(latency_ms, 2),
                          'measurement': 'HTTP ingestion plus immediate dashboard request; excludes 3s browser polling',
                          'jev': prop['advisory'], 'baseline': run['baseline'], 'optimized': run['optimized'],
                          'second_dataset': second['dataset_id']}, indent=2))


if __name__ == '__main__':
    main()
