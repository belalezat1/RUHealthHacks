from copy import deepcopy
from datetime import timedelta
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select

from app.core.clock import utc
from app.models import Assignment, AvailabilitySignal, Consultation, Recommendation
from app.services.audit import record
from app.services.datasets import invalidate, read_state, stable_hash
from app.services.eligibility import evaluate
from app.services.forecast import build_forecast
from app.services.optimizer import preview


def serialize(row, now=None):
    status = row.status
    if now and status in {'proposed', 'approved_for_contact', 'physician_accepted'} and utc(row.expires_at) <= now:
        status = 'expired'
    return {**row.data, 'id': row.id, 'dataset_id': row.dataset_id, 'status': status,
            'source_version': row.source_version, 'workflow_version': row.workflow_version,
            'expires_at': utc(row.expires_at).isoformat()}


def get_proposal(session, active, identifier, actor):
    row = session.get(Recommendation, (active.dataset_id, identifier))
    if not row:
        raise HTTPException(404, 'Recommendation not found in active dataset')
    actor.scope(row.data['candidate']['hospital_id'])
    if actor.role == 'physician' and actor.id != row.data['candidate']['physician_id']:
        raise HTTPException(403, 'Recommendation belongs to another physician')
    return row


def create_proposal(session, active, request, actor, now, policy, key):
    state = read_state(session, active)
    consult = next((c for c in state['consultations'] if c['id'] == request.consultation_id), None)
    if not consult:
        raise HTTPException(404, 'Consultation not found')
    actor.scope(consult['hospital_id'])
    signature = stable_hash(request.model_dump())
    for existing in session.scalars(select(Recommendation).where(Recommendation.dataset_id == active.dataset_id)):
        if existing.data.get('idempotency_key') == key:
            if existing.data.get('request_hash') != signature:
                raise HTTPException(409, 'Idempotency key reused with different preview')
            return existing, state
    result = preview(state, request.consultation_id, now, policy, method=request.method)
    if result.get('selected') is None:
        raise HTTPException(422, {'message': 'No feasible candidate. Review missing or failed evidence.',
                                  'rejected': result.get('rejected', [])})
    identifier = str(uuid4())
    row = Recommendation(id=identifier, dataset_id=active.dataset_id, status='proposed',
                         source_version=active.source_version, workflow_version=1,
                         expires_at=now + timedelta(minutes=5),
                         data={'candidate': result['selected'], 'alternatives': result.get('alternatives', []),
                               'rejected': result.get('rejected', []), 'solver': result.get('solver', {}),
                               'assumptions': result.get('assumptions', []),
                               'advisory': {'status': 'pending', 'mode': 'off'},
                               'idempotency_key': key, 'request_hash': signature, 'receipts': {},
                               'created_at': now.isoformat(), 'consent': None})
    session.add(row)
    record(session, actor, active.dataset_id, 'recommendation.proposed', identifier, now,
           after={'candidate': result['selected'], 'source_version': active.source_version})
    session.flush()
    return row, state


def verification_eligibility(state, assignment, now, policy):
    """Revalidate a continuing committed block without treating it as a new activation."""
    start, end = utc(assignment['start_at']), utc(assignment['end_at'])
    if not start <= now < end:
        raise HTTPException(409, 'Assignment is outside its committed work interval; review before verification')
    snapshot = deepcopy(state)
    for existing in snapshot['assignments']:
        if existing['id'] == assignment['id']:
            # Evaluation-only copy: exclude this block from current occupancy while retaining its
            # entire interval in the eligibility engine's work/rest history. Persisted status stays assigned.
            existing['status'] = 'completed'
    for consultation in snapshot['consultations']:
        if consultation['id'] == assignment['consultation_id']:
            consultation['status'] = 'waiting'
            consultation['physician_id'] = None
    result = evaluate(snapshot, assignment['physician_id'], assignment['hospital_id'],
                      assignment['consultation_id'], 'assign', now, policy, consent=True,
                      start_at=now, end_at=end)
    for rule in result['rules']:
        if rule['code'] == 'MINIMUM_ACTIVATION_BLOCK':
            # This rule governs creating a work block. Its minimum was validated atomically at
            # commit; a short remaining tail is not a second, newly requested activation.
            rule.update(status='pass', observed={'committed_start_at': start.isoformat(),
                                                'committed_end_at': end.isoformat(),
                                                'committed_minutes': (end - start).total_seconds() / 60,
                                                'remaining_minutes': (end - now).total_seconds() / 60},
                        required='Continue the already committed work block; no new activation is created',
                        source='committed_assignment', observed_at=assignment['start_at'],
                        explanation='Minimum activation duration was checked at commit; verification retains the '
                                    'full committed interval for rest and maximum-work checks.')
    statuses = {rule['status'] for rule in result['rules']}
    result['outcome'] = 'ineligible' if 'fail' in statuses else 'unverified' if 'unknown' in statuses else 'eligible'
    return result


def transition(session, active, row, action, body, key, actor, now, policy):
    before = serialize(row, now)
    data = deepcopy(row.data)
    signature = stable_hash({'action': action, 'body': body.model_dump(), 'actor': actor.id, 'role': actor.role})
    if key in data.get('receipts', {}):
        if data['receipts'][key] != signature:
            raise HTTPException(409, 'Decision idempotency key reused with different action')
        return serialize(row, now)
    candidate = data['candidate']
    if action == 'physician-response':
        actor.require('physician')
        if actor.id != candidate['physician_id']:
            raise HTTPException(403, 'Only proposed physician can consent')
    else:
        actor.require('dispatcher', 'admin')
    actor.scope(candidate['hospital_id'])
    expected = {'approve': 'proposed', 'reject': ['proposed', 'approved_for_contact'],
                'physician-response': 'approved_for_contact', 'commit': 'physician_accepted', 'verify': 'assigned'}
    allowed = expected[action] if isinstance(expected[action], list) else [expected[action]]
    if before['status'] not in allowed:
        raise HTTPException(409, f'Cannot {action} recommendation in state {before["status"]}; refresh or recompute')
    if action not in {'reject', 'verify'} and row.source_version != active.source_version:
        raise HTTPException(409, 'Proposal is stale; recompute against current state')
    if action in {'approve', 'commit'}:
        state = read_state(session, active)
        duration = utc(candidate['end_at']) - utc(candidate['start_at'])
        # A proposal's historical interval cannot bypass checks at the actual moment of assignment.
        start = max(now, utc(candidate['start_at']))
        end = start + duration
        result = evaluate(state, candidate['physician_id'], candidate['hospital_id'],
                          candidate['consultation_id'], 'contact' if action == 'approve' else 'assign',
                          now, policy, consent=action == 'commit', start_at=start, end_at=end)
        if result['outcome'] != 'eligible':
            raise HTTPException(409, {'message': 'Eligibility changed; recompute', 'eligibility': result})
    if action == 'approve':
        row.status = 'approved_for_contact'
    elif action == 'reject':
        row.status = 'rejected'
    elif action == 'physician-response':
        row.status = 'physician_accepted' if body.accepted else 'declined'
        data['consent'] = {'accepted': body.accepted, 'physician_id': actor.id,
                           'hospital_id': candidate['hospital_id'], 'consultation_id': candidate['consultation_id'],
                           'expires_at': utc(row.expires_at).isoformat(), 'observed_at': now.isoformat(),
                           'synthetic_actor': actor.synthetic, 'reason': body.reason}
    elif action == 'commit':
        consent = data.get('consent')
        if not consent or not consent['accepted'] or utc(consent['expires_at']) <= now:
            raise HTTPException(409, 'Current scoped physician consent required')
        consultation = session.get(Consultation, (active.dataset_id, candidate['consultation_id']))
        if not consultation or consultation.status != 'waiting':
            raise HTTPException(409, 'Consultation already assigned or no longer waiting')
        assignment_id = str(uuid4())
        assignment = {'id': assignment_id, 'consultation_id': consultation.id,
                      'physician_id': candidate['physician_id'], 'hospital_id': candidate['hospital_id'],
                      'start_at': start.isoformat(), 'end_at': end.isoformat(), 'status': 'assigned',
                      'recommendation_id': row.id}
        session.add(Assignment(dataset_id=active.dataset_id, id=assignment_id,
                               consultation_id=consultation.id, physician_id=candidate['physician_id'],
                               status='assigned', data=assignment))
        consultation.status = 'assigned'
        consultation.data = {**consultation.data, 'status': 'assigned', 'physician_id': candidate['physician_id'],
                             'assigned_at': now.isoformat(), 'expected_end_at': end.isoformat()}
        data['assignment_id'] = assignment_id
        data['assigned_at'] = now.isoformat()
        data['candidate'] = {**candidate, 'start_at': start.isoformat(), 'end_at': end.isoformat()}
        row.status = 'assigned'
        active.source_version += 1
        row.source_version = active.source_version
        invalidate(session, active.dataset_id, except_id=row.id)
    elif action == 'verify':
        assignment = session.get(Assignment, (active.dataset_id, data['assignment_id']))
        consultation = session.get(Consultation, (active.dataset_id, candidate['consultation_id']))
        signals = [s.data for s in session.scalars(select(AvailabilitySignal).where(
            AvailabilitySignal.dataset_id == active.dataset_id))]
        evidence = [s for s in signals if s.get('kind') == 'activation' and s.get('value') == 'active'
                    and s.get('recommendation_id') == row.id and s['physician_id'] == candidate['physician_id']
                    and now - timedelta(minutes=5) <= utc(s['observed_at']) <= now
                    and utc(s['observed_at']) >= utc(data['assigned_at'])]
        if not evidence:
            raise HTTPException(409, 'No fresh activation event observed after this assignment')
        if not assignment or assignment.status != 'assigned' or consultation.status != 'assigned':
            raise HTTPException(409, 'Assigned consultation continuity no longer holds')
        result = verification_eligibility(read_state(session, active), assignment.data, now, policy)
        if result['outcome'] != 'eligible':
            raise HTTPException(409, {'message': 'Activation observed but outcome rules fail', 'eligibility': result})
        assignment.status = 'verified'
        assignment.data = {**assignment.data, 'status': 'verified', 'verified_at': now.isoformat()}
        consultation.status = 'active'
        consultation.data = {**consultation.data, 'status': 'active'}
        row.status = 'verified'
        coverage = build_forecast(read_state(session, active), now, policy)
        affected = [h for interval in coverage['intervals'] for h in interval['hospitals']
                    if h['hospital_id'] == candidate['hospital_id']]
        data['verification'] = {'activation_signal_id': evidence[-1]['id'], 'checked_at': now.isoformat(),
                                'outcome': 'Assigned work has fresh activation evidence and passes current rules',
                                'coverage_as_of': coverage['as_of'],
                                'affected_intervals': affected,
                                'remaining_gap': any(h['unmet_minutes'] > 0 for h in affected),
                                'coverage_note': 'Activation is verified; remaining network coverage gaps stay visible.'}
        active.source_version += 1
        row.source_version = active.source_version
        invalidate(session, active.dataset_id, except_id=row.id)
    row.workflow_version += 1
    data.setdefault('receipts', {})[key] = signature
    row.data = data
    record(session, actor, active.dataset_id, f'recommendation.{action}', row.id, now,
           before=before, after=serialize(row, now), reason=body.reason)
    session.flush()
    return serialize(row, now)
