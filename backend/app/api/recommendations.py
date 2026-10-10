from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.config import load_policy
from app.core.database import engine, get_session, locked_state
from app.core.security import Actor, actor_context
from app.models import AdvisoryResult, Recommendation
from app.schemas.decisions import ActionRequest, PhysicianResponse, PreviewRequest, RecommendationResponse
from app.services.advisory import build_advisory
from app.services.decisions import create_proposal, get_proposal, serialize, transition

router = APIRouter(prefix='/v1', tags=['recommendations'])


@router.post('/optimizations/preview', response_model=RecommendationResponse)
async def optimize(body: PreviewRequest, request: Request,
                   idempotency_key: str = Header(..., min_length=1, max_length=200),
                   actor: Actor = Depends(actor_context)):
    actor.require('dispatcher', 'admin', 'evaluator')
    now = request.app.state.clock.now()
    def prepare():
        with Session(engine()) as session, session.begin():
            active = locked_state(session)
            row, state = create_proposal(session, active, body, actor, now, load_policy(), idempotency_key)
            return serialize(row, now), state
    proposal, state = await run_in_threadpool(prepare)
    if proposal['advisory'].get('status') != 'pending':
        return proposal
    # The database transaction above is closed before awaiting external HTTP.
    advisory = await build_advisory(state, proposal, request.app.state.jev, now)
    def persist():
        with Session(engine()) as session, session.begin():
            active = locked_state(session)
            row = session.get(Recommendation, (state['dataset_id'], proposal['id']))
            if row is None:
                return {**proposal, 'advisory': {**advisory, 'status': 'stale', 'answers': {}}}
            current = request.app.state.clock.now()
            if active.dataset_id != state['dataset_id'] or active.source_version != state['source_version']:
                advisory.update({'status': 'stale', 'answers': {}})
            if current >= row.expires_at:
                advisory.update({'status': 'stale', 'answers': {}})
            row.data = {**row.data, 'advisory': advisory}
            session.merge(AdvisoryResult(dataset_id=state['dataset_id'], id=row.id, data=advisory))
            return serialize(row, current)
    return await run_in_threadpool(persist)


@router.get('/recommendations/{identifier}', response_model=RecommendationResponse)
def recommendation(identifier: str, request: Request, actor: Actor = Depends(actor_context),
                   session: Session = Depends(get_session)):
    active = locked_state(session, read=True)
    return serialize(get_proposal(session, active, identifier, actor), request.app.state.clock.now())


def act(action, identifier, body, key, request, actor, session):
    active = locked_state(session)
    row = get_proposal(session, active, identifier, actor)
    return transition(session, active, row, action, body, key, actor, request.app.state.clock.now(), load_policy())


@router.post('/recommendations/{identifier}/approve', response_model=RecommendationResponse)
def approve(identifier: str, body: ActionRequest, request: Request,
            idempotency_key: str = Header(..., min_length=1, max_length=200),
            actor: Actor = Depends(actor_context), session: Session = Depends(get_session)):
    return act('approve', identifier, body, idempotency_key, request, actor, session)


@router.post('/recommendations/{identifier}/reject', response_model=RecommendationResponse)
def reject(identifier: str, body: ActionRequest, request: Request,
           idempotency_key: str = Header(..., min_length=1, max_length=200),
           actor: Actor = Depends(actor_context), session: Session = Depends(get_session)):
    return act('reject', identifier, body, idempotency_key, request, actor, session)


@router.post('/recommendations/{identifier}/physician-response', response_model=RecommendationResponse)
def physician_response(identifier: str, body: PhysicianResponse, request: Request,
                       idempotency_key: str = Header(..., min_length=1, max_length=200),
                       actor: Actor = Depends(actor_context), session: Session = Depends(get_session)):
    return act('physician-response', identifier, body, idempotency_key, request, actor, session)


@router.post('/recommendations/{identifier}/commit', response_model=RecommendationResponse)
def commit(identifier: str, body: ActionRequest, request: Request,
           idempotency_key: str = Header(..., min_length=1, max_length=200),
           actor: Actor = Depends(actor_context), session: Session = Depends(get_session)):
    return act('commit', identifier, body, idempotency_key, request, actor, session)


@router.post('/recommendations/{identifier}/verify', response_model=RecommendationResponse)
def verify(identifier: str, body: ActionRequest, request: Request,
           idempotency_key: str = Header(..., min_length=1, max_length=200),
           actor: Actor = Depends(actor_context), session: Session = Depends(get_session)):
    return act('verify', identifier, body, idempotency_key, request, actor, session)
