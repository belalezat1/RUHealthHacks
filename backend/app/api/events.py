from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.database import get_session, locked_state
from app.core.security import Actor, actor_context
from app.models import RawEvent
from app.schemas.events import Batch, Event, EventPage, EventResult
from app.services.datasets import read_state
from app.services.ingestion import ingest

router = APIRouter(prefix='/v1/events', tags=['events'])


def physician_hospitals(state, physician_id):
    affected = {s['hospital_id'] for s in state['shifts'] if s['physician_id'] == physician_id}
    affected.update(c['hospital_id'] for c in state['credentials']
                    if c['physician_id'] == physician_id and c.get('hospital_id'))
    return affected


def check_scope(session, active, actor, event):
    if event.event_type in {'availability', 'activation'} and actor.hospitals is not None:
        state = read_state(session, active)
        affected = physician_hospitals(state, event.entity_id)
        if not affected or not affected.issubset(actor.hospitals):
            raise HTTPException(403, 'Physician affects hospitals outside actor scope')


@router.post('', response_model=EventResult)
def create(event: Event, request: Request, actor: Actor = Depends(actor_context),
           session: Session = Depends(get_session)):
    actor.require('admin', 'dispatcher', 'evaluator', 'physician')
    active = locked_state(session)
    check_scope(session, active, actor, event)
    return ingest(session, active, event, actor, request.app.state.clock.now())


@router.post('/batch', response_model=list[EventResult])
def batch(body: Batch, request: Request, actor: Actor = Depends(actor_context),
          session: Session = Depends(get_session)):
    actor.require('admin', 'dispatcher', 'evaluator')
    active = locked_state(session)
    outcomes = []
    for event in body.events:
        check_scope(session, active, actor, event)
        outcomes.append(ingest(session, active, event, actor, request.app.state.clock.now()))
    return outcomes


@router.get('', response_model=EventPage)
def events(actor: Actor = Depends(actor_context), session: Session = Depends(get_session),
           offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200)):
    actor.require('admin', 'dispatcher', 'evaluator')
    active = locked_state(session, read=True)
    query = select(RawEvent).where(RawEvent.dataset_id == active.dataset_id)
    if actor.hospitals is not None:
        state = read_state(session, active)
        consultations = {c['id'] for c in state['consultations'] if c['hospital_id'] in actor.hospitals}
        physicians = set()
        for physician in state['physicians']:
            affected = physician_hospitals(state, physician['id'])
            if affected and affected.issubset(actor.hospitals):
                physicians.add(physician['id'])
        # Entity IDs are source-defined and can collide across record types. Scope each kind.
        query = query.where(or_(
            and_(RawEvent.event_type.in_(['availability', 'activation']), RawEvent.entity_id.in_(physicians)),
            and_(RawEvent.event_type.in_(['consultation.created', 'consultation.completed']),
                 RawEvent.entity_id.in_(consultations)),
        ))
    total = session.scalar(select(func.count()).select_from(query.subquery()))
    rows = session.scalars(query.order_by(RawEvent.received_at.desc(), RawEvent.id).offset(offset).limit(limit))
    return {'items': [{**r.data, 'outcome': r.outcome} for r in rows], 'total': total}
