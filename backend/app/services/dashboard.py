from copy import deepcopy

from sqlalchemy import select

from app.core.config import get_settings
from app.models import Recommendation
from app.services.availability import reconcile
from app.services.datasets import read_state
from app.services.decisions import serialize
from app.services.forecast import build_forecast


def physician_visible(state, actor, physician_id):
    if actor.role == 'physician':
        return physician_id == actor.id
    if actor.hospitals is None:
        return True
    return any(c['physician_id'] == physician_id and c.get('hospital_id') in actor.hospitals
               for c in state['credentials'])


def build_snapshot(session, active, actor, now, policy):
    state = read_state(session, active)
    hospitals = [h for h in state['hospitals'] if actor.hospitals is None or h['id'] in actor.hospitals]
    ids = {h['id'] for h in hospitals}
    physicians = [{**p, 'availability': reconcile(state, p['id'], now, policy),
                   'credentials': [c for c in state['credentials'] if c['physician_id'] == p['id']
                                   and (not c.get('hospital_id') or c['hospital_id'] in ids)],
                   'shifts': [s for s in state['shifts'] if s['physician_id'] == p['id'] and s['hospital_id'] in ids]}
                  for p in state['physicians'] if physician_visible(state, actor, p['id'])]
    consultations = [c for c in state['consultations'] if c['hospital_id'] in ids
                     and (actor.role != 'physician' or c.get('physician_id') == actor.id)]
    forecast = deepcopy(build_forecast(state, now, policy))
    for interval in forecast['intervals']:
        interval['hospitals'] = [h for h in interval['hospitals'] if h['hospital_id'] in ids]
        for key in ['demand_minutes', 'capacity_minutes', 'unmet_minutes']:
            interval[key] = round(sum(h[key] for h in interval['hospitals']), 2)
    forecast['risks'] = [r for r in forecast['risks'] if r.get('hospital_id') in ids]
    proposals = [serialize(r, now) for r in session.scalars(select(Recommendation).where(
        Recommendation.dataset_id == active.dataset_id).order_by(Recommendation.id))
        if r.data['candidate']['hospital_id'] in ids
        and (actor.role != 'physician' or r.data['candidate']['physician_id'] == actor.id)]
    settings = get_settings()
    return {'dataset_id': active.dataset_id, 'source_version': active.source_version,
            'as_of': now.isoformat(), 'valid_until': forecast['valid_until'], 'synthetic': True,
            'counts': {'physicians': len(physicians), 'consultations': len(consultations),
                       'waiting': sum(c['status'] == 'waiting' for c in consultations),
                       'assigned': sum(c['status'] in {'assigned', 'active'} for c in consultations),
                       'at_risk_hospitals': len({r['hospital_id'] for r in forecast['risks']}),
                       'pending_interventions': sum(r['status'] in {'proposed', 'approved_for_contact',
                                                                  'physician_accepted'} for r in proposals)},
            'physicians': physicians, 'consultations': consultations, 'hospitals': hospitals,
            'forecast': forecast, 'recommendations': proposals,
            'jev': {'mode': settings.jev_mode, 'model': settings.jev_model,
                    'status': 'mock' if settings.jev_mode == 'mock' else ('off' if settings.jev_mode == 'off'
                              else 'configured; connection evaluated on preview')},
            'freshness': {'stale': sum(bool(p['availability']['stale']) for p in physicians),
                          'conflicts': sum(bool(p['availability']['conflicts']) for p in physicians)}}
