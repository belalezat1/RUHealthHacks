from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.database import get_session, locked_state
from app.core.security import Actor, actor_context
from app.schemas.events import ImportResult, ValidationReport
from app.services.datasets import activate, examples, validate_dataset

router = APIRouter(prefix='/v1/datasets', tags=['datasets'])


@router.get('/examples')
def dataset_examples(request: Request, actor: Actor = Depends(actor_context)):
    actor.require('dispatcher', 'admin', 'evaluator')
    return examples(request.app.state.clock.now())


@router.post('/validate', response_model=ValidationReport)
def validate(payload: dict = Body(...), actor: Actor = Depends(actor_context)):
    actor.require('dispatcher', 'admin', 'evaluator')
    return validate_dataset(payload)[0]


@router.post('/import', response_model=ImportResult)
def import_dataset(request: Request, payload: dict = Body(...),
                   idempotency_key: str = Header(..., min_length=1, max_length=200),
                   actor: Actor = Depends(actor_context), session: Session = Depends(get_session)):
    actor.require('dispatcher', 'admin', 'evaluator')
    if actor.hospitals is not None:
        raise HTTPException(403, 'Dataset activation requires network-wide scope')
    active = locked_state(session, require_dataset=False)
    return activate(session, active, payload, idempotency_key, actor, request.app.state.clock.now())
