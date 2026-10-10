from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import load_policy
from app.core.database import get_session, locked_state
from app.core.security import Actor, actor_context
from app.models import AuditLog
from app.schemas.operations import Dashboard, Eligibility, Forecast
from app.services.dashboard import build_snapshot, physician_visible
from app.services.datasets import read_state
from app.services.eligibility import evaluate

router = APIRouter(prefix='/v1', tags=['operations'])


def snapshot(request: Request, actor: Actor = Depends(actor_context), session: Session = Depends(get_session)):
    active = locked_state(session, read=True)
    return build_snapshot(session, active, actor, request.app.state.clock.now(), load_policy())


@router.get('/dashboard', response_model=Dashboard)
def dashboard(result=Depends(snapshot)):
    return result


@router.get('/physicians', response_model=list[dict])
def physicians(result=Depends(snapshot)):
    return result['physicians']


@router.get('/consultations', response_model=list[dict])
def consultations(result=Depends(snapshot)):
    return result['consultations']


@router.get('/coverage/forecast', response_model=Forecast)
def forecast(result=Depends(snapshot)):
    return result['forecast']


@router.get('/risks', response_model=list[dict])
def risks(result=Depends(snapshot)):
    return result['forecast']['risks']


@router.get('/physicians/{identifier}/eligibility', response_model=Eligibility)
def eligibility(identifier: str, hospital_id: str, consultation_id: str, action: Literal['contact', 'assign'],
                request: Request, actor: Actor = Depends(actor_context), session: Session = Depends(get_session)):
    actor.scope(hospital_id)
    active = locked_state(session, read=True)
    state = read_state(session, active)
    if not physician_visible(state, actor, identifier):
        raise HTTPException(403, 'Physician outside actor scope')
    consult = next((c for c in state['consultations'] if c['id'] == consultation_id), None)
    if not consult or consult['hospital_id'] != hospital_id:
        raise HTTPException(422, 'Consultation must belong to requested hospital')
    return evaluate(state, identifier, hospital_id, consultation_id, action,
                    request.app.state.clock.now(), load_policy())


@router.get('/audit')
def audit(actor: Actor = Depends(actor_context), session: Session = Depends(get_session),
          offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200)):
    actor.require('dispatcher', 'admin', 'evaluator')
    active = locked_state(session, read=True)
    rows = list(session.scalars(select(AuditLog).where(AuditLog.dataset_id == active.dataset_id)
                               .order_by(AuditLog.created_at.desc(), AuditLog.id)))
    if actor.hospitals is not None:
        # Rows without explicit in-scope evidence cannot be exposed to a scoped reader.
        rows = [r for r in rows if (r.data.get('after') or {}).get('candidate', {}).get('hospital_id')
                in actor.hospitals]
    return {'items': [{'id': r.id, 'actor': r.actor, 'role': r.role, 'action': r.action,
                       'entity_id': r.entity_id, 'created_at': r.created_at.isoformat(), **r.data}
                      for r in rows[offset:offset + limit]], 'total': len(rows)}
