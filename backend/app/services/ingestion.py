from datetime import timedelta
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select

from app.core.clock import utc
from app.core.config import get_settings
from app.models import Assignment, AvailabilitySignal, Consultation, Physician, RawEvent, Recommendation
from app.schemas.events import Consultation as ConsultationSchema
from app.schemas.events import Signal
from app.services.audit import record
from app.services.datasets import invalidate, normalize, stable_hash


def ingest(session, active, event, actor, now):
    if event.dataset_id != active.dataset_id:
        raise HTTPException(409, 'Event dataset is not active')
    if utc(event.observed_at) > now + timedelta(seconds=get_settings().future_tolerance_seconds):
        raise HTTPException(422, 'Observation time exceeds configured future tolerance')
    semantic = normalize(event.model_dump())
    digest = stable_hash(semantic)
    previous = session.scalar(select(RawEvent).where(
        RawEvent.dataset_id == event.dataset_id, RawEvent.source == event.source,
        RawEvent.event_id == event.event_id))
    if previous:
        if previous.semantic_hash != digest:
            raise HTTPException(409, 'Event identity reused with different semantic content')
        return {'event_id': event.event_id, 'outcome': 'duplicate', 'source_version': active.source_version}
    outcome = 'applied'
    if event.event_type in {'availability', 'activation'}:
        physician = session.get(Physician, (event.dataset_id, event.entity_id))
        if not physician:
            raise HTTPException(422, 'Unknown physician')
        if actor.role == 'physician' and actor.id != physician.id:
            raise HTTPException(403, 'Physicians may only report their own availability')
        kind = 'activation' if event.event_type == 'activation' else event.payload.get('kind')
        value = 'active' if kind == 'activation' else event.payload.get('value')
        signal = Signal(id=str(uuid4()), physician_id=event.entity_id, source=event.source,
                        kind=kind, value=value, observed_at=event.observed_at, received_at=now,
                        source_sequence=event.source_sequence)
        if kind == 'activation':
            proposal_id = event.payload.get('recommendation_id')
            proposal = session.get(Recommendation, (event.dataset_id, proposal_id)) if proposal_id else None
            if not proposal or proposal.status not in {'assigned', 'verified'}:
                raise HTTPException(409, 'Activation requires an assigned recommendation')
            if proposal.data['candidate']['physician_id'] != event.entity_id:
                raise HTTPException(422, 'Activation physician does not match assignment')
            actor.scope(proposal.data['candidate']['hospital_id'])
        prior_signals = list(session.scalars(select(AvailabilitySignal).where(
            AvailabilitySignal.dataset_id == event.dataset_id)))
        same = [s.data for s in prior_signals if s.data['physician_id'] == event.entity_id
                and s.data['source'] == event.source and s.data['kind'] == kind]
        def order(row):
            seq = row.get('source_sequence')
            return (seq if seq is not None else -1, utc(row['observed_at']), row['id'])
        if same and order(normalize(signal.model_dump()))[:2] <= max(order(s) for s in same)[:2]:
            outcome = 'late'
        # Keep every signal as evidence, but resolver chooses sequence/time, never ingestion order.
        data = normalize(signal.model_dump())
        if kind == 'activation':
            data['recommendation_id'] = event.payload['recommendation_id']
        session.add(AvailabilitySignal(dataset_id=event.dataset_id, id=signal.id, data=data))
    elif event.event_type == 'consultation.created':
        if actor.role == 'physician':
            raise HTTPException(403, 'Physician cannot inject consultations')
        consultation = ConsultationSchema.model_validate(event.payload)
        if consultation.id != event.entity_id or consultation.status != 'waiting':
            raise HTTPException(422, 'New consultation must match entity ID and be waiting')
        actor.scope(consultation.hospital_id)
        from app.models import Hospital
        if not session.get(Hospital, (event.dataset_id, consultation.hospital_id)):
            raise HTTPException(422, 'Unknown hospital')
        if session.get(Consultation, (event.dataset_id, event.entity_id)):
            raise HTTPException(409, 'Consultation ID already exists')
        session.add(Consultation(dataset_id=event.dataset_id, id=consultation.id, status='waiting',
                                 data=normalize(consultation.model_dump())))
    else:
        consultation = session.get(Consultation, (event.dataset_id, event.entity_id))
        if not consultation:
            raise HTTPException(422, 'Unknown consultation')
        actor.scope(consultation.data['hospital_id'])
        if actor.role == 'physician' and consultation.data.get('physician_id') != actor.id:
            raise HTTPException(403, 'Physician is not assigned to this consultation')
        if consultation.status == 'completed':
            outcome = 'late'
        elif consultation.status not in {'assigned', 'active'}:
            raise HTTPException(409, 'Only assigned or active consultation can complete')
        else:
            consultation.status = 'completed'
            consultation.data = {**consultation.data, 'status': 'completed', 'completed_at': now.isoformat()}
            for assignment in session.scalars(select(Assignment).where(
                Assignment.dataset_id == event.dataset_id, Assignment.consultation_id == event.entity_id)):
                assignment.status = 'completed'
                assignment.data = {**assignment.data, 'status': 'completed', 'end_at': now.isoformat()}
    if outcome == 'applied':
        active.source_version += 1
        invalidate(session, event.dataset_id)
    session.add(RawEvent(id=str(uuid4()), dataset_id=event.dataset_id, source=event.source,
                         event_id=event.event_id, entity_id=event.entity_id, event_type=event.event_type,
                         semantic_hash=digest, observed_at=event.observed_at, received_at=now,
                         data={**semantic, 'received_at': now.isoformat()}, outcome=outcome))
    record(session, actor, event.dataset_id, 'event.' + outcome, event.entity_id, now,
           after={'event_id': event.event_id, 'source_version': active.source_version})
    session.flush()
    return {'event_id': event.event_id, 'outcome': outcome, 'source_version': active.source_version}
