import hashlib
import json
from copy import deepcopy
from datetime import datetime

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from app.core.clock import utc
from app.core.config import ROOT, get_settings
from app.models import (
    Assignment,
    AvailabilitySignal,
    Consultation,
    DatasetImport,
    Hospital,
    Physician,
    PhysicianCredential,
    Recommendation,
    Shift,
)
from app.schemas.events import Dataset
from app.services.audit import record

ENTITY_TABLES = {'hospitals': Hospital, 'physicians': Physician, 'credentials': PhysicianCredential,
                 'shifts': Shift, 'signals': AvailabilitySignal, 'consultations': Consultation,
                 'assignments': Assignment}


def stable_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), default=str).encode()).hexdigest()


def validate_dataset(payload):
    try:
        if len(json.dumps(payload).encode()) > get_settings().max_upload_bytes:
            raise ValueError('Dataset exceeds size limit')
        dataset = Dataset.model_validate(payload)
        counts = {key: len(getattr(dataset, key)) for key in ENTITY_TABLES if key != 'assignments'}
        if sum(counts.values()) > get_settings().max_dataset_rows:
            raise ValueError('Dataset exceeds row limit')
        return {'valid': True, 'errors': [], 'counts': counts}, dataset
    except ValidationError as exc:
        errors = [{'path': '.'.join(map(str, e['loc'])) or '$',
                   'field': str(e['loc'][-1]) if e['loc'] else '$', 'reason': e['msg']}
                  for e in exc.errors()]
    except (ValueError, TypeError) as exc:
        errors = [{'path': '$', 'field': '$', 'reason': str(exc)}]
    return {'valid': False, 'errors': errors, 'counts': {}}, None


def normalize(value):
    if isinstance(value, datetime):
        return utc(value).isoformat()
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize(item) for key, item in value.items()}
    return value


def invalidate(session, dataset_id, except_id=None):
    rows = session.scalars(select(Recommendation).where(
        Recommendation.dataset_id == dataset_id,
        Recommendation.status.in_(['proposed', 'approved_for_contact', 'physician_accepted'])
    ))
    for row in rows:
        if row.id != except_id:
            row.status = 'stale'
            row.workflow_version += 1


def activate(session, active, payload, key, actor, now):
    report, dataset = validate_dataset(payload)
    if not report['valid']:
        raise HTTPException(422, report)
    digest = stable_hash(payload)
    retry = session.scalar(select(DatasetImport).where(DatasetImport.idempotency_key == key))
    if retry and (retry.source_hash != digest or retry.id != dataset.dataset_id):
        raise HTTPException(409, 'Idempotency key reused with different dataset')
    existing = session.get(DatasetImport, dataset.dataset_id)
    if existing and existing.source_hash != digest:
        raise HTTPException(409, 'Dataset ID already exists with different content. Use a new ID or explicit demo reset.')
    old = active.dataset_id
    duplicate = existing is not None
    if not existing:
        data = normalize(dataset.model_dump())
        session.add(DatasetImport(id=dataset.dataset_id, source_hash=digest,
                                 schema_version=dataset.schema_version, idempotency_key=key,
                                 data={'source_payload': payload, 'validation': report}, created_at=now))
        for group, model in ENTITY_TABLES.items():
            if group == 'assignments':
                continue
            for row in data[group]:
                kwargs = {'dataset_id': dataset.dataset_id, 'id': row['id'], 'data': row}
                if group == 'consultations':
                    kwargs['status'] = row['status']
                session.add(model(**kwargs))
    if old != dataset.dataset_id or not duplicate:
        if old:
            invalidate(session, old)
        active.dataset_id = dataset.dataset_id
        active.source_version += 1
        record(session, actor, dataset.dataset_id, 'dataset.activated', dataset.dataset_id,
               now, before={'dataset_id': old}, after={'source_version': active.source_version})
    return {'dataset_id': dataset.dataset_id, 'source_version': active.source_version, 'duplicate': duplicate}


def read_state(session, active):
    state = {'dataset_id': active.dataset_id, 'source_version': active.source_version}
    for name, model in ENTITY_TABLES.items():
        state[name] = [deepcopy(row.data) for row in session.scalars(
            select(model).where(model.dataset_id == active.dataset_id).order_by(model.id))]
    return state


def examples(now):
    results = []
    for path in sorted((ROOT / 'data/synthetic').glob('*.json')):
        raw = json.loads(path.read_text())
        if not isinstance(raw, dict) or raw.get('schema_version') != 'synthetic_v1':
            continue
        shift = now - utc(raw['as_of'])
        def rebase(value, key=''):
            if isinstance(value, dict):
                return {k: rebase(v, k) for k, v in value.items()}
            if isinstance(value, list):
                return [rebase(v) for v in value]
            if isinstance(value, str) and (key.endswith('_at') or key == 'as_of'):
                return (utc(value) + shift).isoformat()
            return value
        data = rebase(raw)
        results.append({'id': data['dataset_id'], 'label': data['label'], 'dataset': data})
    return results
