from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.config import get_settings, load_policy
from app.core.database import engine, get_session, locked_state
from app.core.security import Actor, actor_context
from app.models import SimulationRun
from app.schemas.decisions import SimulationRequest, SimulationResponse
from app.services.audit import record
from app.services.datasets import read_state
from app.simulation.replay import run_simulation
from app.simulation.scenarios import SCENARIOS

router = APIRouter(prefix='/v1/simulations', tags=['simulations'])


@router.get('/scenarios')
def scenarios(actor: Actor = Depends(actor_context)):
    actor.require('dispatcher', 'admin', 'evaluator')
    return SCENARIOS


@router.post('', response_model=SimulationResponse)
def run(body: SimulationRequest, request: Request, actor: Actor = Depends(actor_context)):
    actor.require('dispatcher', 'admin', 'evaluator')
    if actor.hospitals is not None:
        raise HTTPException(403, 'Network simulation requires network-wide scope')
    with Session(engine()) as session, session.begin():
        active = locked_state(session, read=True)
        state = read_state(session, active)
    now = request.app.state.clock.now()
    result = run_simulation(state, body.scenario, body.seed, now, load_policy())
    identifier = str(uuid4())
    result['metadata']['advisory_mode'] = get_settings().jev_mode
    result['id'] = identifier
    with Session(engine()) as session, session.begin():
        # Run records have their own dataset namespace; no operational input/version changes.
        session.add(SimulationRun(dataset_id=state['dataset_id'], id=identifier, data=result))
        record(session, actor, state['dataset_id'], 'simulation.completed', identifier, now,
               after={'scenario': body.scenario, 'seed': body.seed})
    return result


@router.get('/{identifier}', response_model=SimulationResponse)
@router.get('/{identifier}/export', response_model=SimulationResponse)
def get_run(identifier: str, actor: Actor = Depends(actor_context), session: Session = Depends(get_session)):
    actor.require('dispatcher', 'admin', 'evaluator')
    if actor.hospitals is not None:
        raise HTTPException(403, 'Network simulation requires network-wide scope')
    active = locked_state(session, read=True)
    row = session.get(SimulationRun, (active.dataset_id, identifier))
    if not row:
        raise HTTPException(404, 'Simulation not found')
    return row.data
