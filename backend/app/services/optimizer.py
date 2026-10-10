"""Deterministic feasible-candidate ranking; optional bounded CP-SAT selects the same objective."""
from copy import deepcopy
from datetime import timedelta

from app.services.availability import parse_time, reconcile
from app.services.eligibility import _union_minutes, evaluate
from app.services.explanations import explain_candidate, explain_eligibility
from app.services.forecast import build_forecast


def preview(state, consultation_id, now, policy, method='greedy'):
    now = parse_time(now)
    consult = next((c for c in state.get('consultations', []) if c['id'] == consultation_id), None)
    solver = {'requested_method': method, 'method': 'baseline' if method == 'baseline' else 'greedy',
              'status': 'deterministic', 'optimal': False, 'scope': 'One consultation and a bounded feasible shortlist'}
    assumptions = ['Synthetic demo policy ' + policy.get('version', 'unversioned'),
                   'Hard-rule failures and unknown evidence are excluded before ranking.',
                   'The score is a transparent operational cost, not a clinical risk or probability.',
                   'All contact proposals still require supervisor approval and explicit scoped physician consent.',
                   'Known future commitments are checked beyond the visible 90-minute forecast.']
    if not consult or consult['status'] != 'waiting' or parse_time(consult['requested_at']) > now:
        return {'selected': None, 'alternatives': [], 'rejected': [], 'solver': solver,
                'assumptions': assumptions + ['Consultation is unknown or not currently waiting.']}
    end = now + timedelta(minutes=consult['duration_minutes'])
    baseline_forecast = build_forecast(state, now, policy)
    baseline_deficit = sum(i['unmet_minutes'] for i in baseline_forecast['intervals'])
    baseline_capacity = sum(i['capacity_minutes'] for i in baseline_forecast['intervals'])
    candidates, rejected = [], []
    weights = {'delay': 10, 'uncovered': 3, 'overtime': 1, 'activation': 8, 'split_shift': 4,
               'schedule_instability': 5, 'workload_balance': 0.02, **policy.get('weights', {})}
    physicians = sorted(state.get('physicians', []), key=lambda p: p['id'])
    cap = policy.get('max_candidates', 64)
    for physician in physicians[:cap]:
        pid = physician['id']
        eligibility = evaluate(state, pid, consult['hospital_id'], consult['id'], 'contact', now, policy,
                               start_at=now, end_at=end)
        if eligibility['outcome'] != 'eligible':
            rejected.append({'physician_id': pid, 'eligibility': eligibility,
                             'explanation': explain_eligibility(eligibility)})
            continue
        availability = reconcile(state, pid, now, policy)
        own_shifts = [s for s in state.get('shifts', []) if s['physician_id'] == pid
                      and s.get('status', 'scheduled') == 'scheduled']
        windows = [(max(now, parse_time(s['start_at'])), min(end, parse_time(s['end_at'])))
                   for s in own_shifts if parse_time(s['start_at']) < end and parse_time(s['end_at']) > now]
        covered_minutes = _union_minutes(windows)
        overtime = max(0, consult['duration_minutes'] - covered_minutes)
        on_target_shift = any(s['hospital_id'] == consult['hospital_id']
                              and parse_time(s['start_at']) <= now < parse_time(s['end_at']) for s in own_shifts)
        action = 'route' if availability['on_shift'] else 'activate'
        delay = max(0, (now - parse_time(consult['deadline_at'])).total_seconds() / 60)
        recent_work = _union_minutes([(max(now - timedelta(hours=24), parse_time(s['start_at'])),
                                      min(now, parse_time(s['end_at']))) for s in own_shifts
                                     if parse_time(s['start_at']) < now
                                     and parse_time(s['end_at']) > now - timedelta(hours=24)])
        split = int(action == 'activate' and any(parse_time(s['start_at']) > end for s in own_shifts))
        instability = int(availability['on_shift'] and not on_target_shift)
        projected = deepcopy(state)
        projected.setdefault('assignments', []).append({
            'id': f'projected:{pid}:{consult["id"]}', 'consultation_id': consult['id'],
            'physician_id': pid, 'hospital_id': consult['hospital_id'], 'start_at': now.isoformat(),
            'end_at': end.isoformat(), 'status': 'assigned'})
        for row in projected['consultations']:
            if row['id'] == consult['id']:
                row.update(status='assigned', physician_id=pid, expected_end_at=end.isoformat())
        projection = build_forecast(projected, now, policy)
        projected_deficit = sum(i['unmet_minutes'] for i in projection['intervals'])
        capacity_gain = sum(i['capacity_minutes'] for i in projection['intervals']) - baseline_capacity
        new_critical = []
        for index, interval in enumerate(projection['intervals']):
            previous = {h['hospital_id']: h for h in baseline_forecast['intervals'][index]['hospitals']}
            for row in interval['hospitals']:
                prior = previous[row['hospital_id']]
                if row['severity'] == 'critical' and (prior['severity'] != 'critical'
                                                     or row['unmet_minutes'] > prior['unmet_minutes']):
                    new_critical.append({'hospital_id': row['hospital_id'], 'start_at': interval['start_at'],
                                         'before_unmet_minutes': prior['unmet_minutes'],
                                         'after_unmet_minutes': row['unmet_minutes']})
        # Mean bin shortfall preserves the full horizon while avoiding claims that repeated backlog
        # across bins represents unique patient demand. A lower operational cost is better.
        components = {'delay': delay * weights['delay'], 'uncovered': projected_deficit / 6 * weights['uncovered'],
                      'overtime': overtime * weights['overtime'], 'activation': int(action == 'activate') * weights['activation'],
                      'split_shift': split * weights['split_shift'], 'schedule_instability': instability * weights['schedule_instability'],
                      'workload_balance': recent_work * weights['workload_balance']}
        candidate = {'physician_id': pid, 'consultation_id': consult['id'], 'hospital_id': consult['hospital_id'],
                     'action': action, 'start_at': now.isoformat(), 'end_at': end.isoformat(),
                     'score': round(sum(components.values()), 4), 'eligibility': eligibility,
                     'expected_effect': {'work_minutes': consult['duration_minutes'], 'delay_minutes': round(delay, 2),
                                         'overtime_minutes': round(overtime, 2), 'activation_count': int(action == 'activate'),
                                         'split_shift_disruption': split, 'score_components': components,
                                         'capacity_gain_minutes_90m': round(capacity_gain, 2),
                                         'mean_bin_unmet_minutes_before': round(baseline_deficit / 6, 2),
                                         'mean_bin_unmet_minutes_after': round(projected_deficit / 6, 2),
                                         'downstream_critical_risks': new_critical,
                                         'status': 'projected; confirmation requires activation evidence'},
                     'explanation': ''}
        candidate['explanation'] = explain_candidate(candidate)
        if new_critical:
            candidate['explanation'] += (' Further intervention is required: this proposal worsens projected '
                                         'critical shortfalls in an affected hospital; inspect downstream risk evidence.')
        candidates.append(candidate)
    if len(physicians) > cap:
        assumptions.append(f'Candidate generation capped at the first {cap} stable physician IDs of {len(physicians)}; '
                           'this run does not establish global feasibility or optimality.')
    if method != 'baseline':
        candidates.sort(key=lambda c: (c['score'], c['physician_id']))
    solver['candidate_count'] = len(candidates)
    solver['rejected_count'] = len(rejected)
    if method == 'cp_sat' and candidates:
        try:
            from ortools.sat.python import cp_model
            model = cp_model.CpModel()
            choices = [model.new_bool_var(f'candidate_{i}') for i in range(len(candidates))]
            model.add(sum(choices) == 1)
            costs = [int(round(c['score'] * 1000)) * (len(candidates) + 1) + i for i, c in enumerate(candidates)]
            model.minimize(sum(cost * choice for cost, choice in zip(costs, choices)))
            engine = cp_model.CpSolver()
            engine.parameters.max_time_in_seconds = min(1.0, max(0.01, policy.get('max_solver_seconds', 0.25)))
            engine.parameters.num_search_workers = 1
            engine.parameters.random_seed = policy.get('solver_seed', 42)
            result = engine.solve(model)
            if result in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                selected = next(i for i, choice in enumerate(choices) if engine.boolean_value(choice))
                chosen = candidates[selected]
                checked = evaluate(state, chosen['physician_id'], consult['hospital_id'], consult['id'],
                                   'contact', now, policy, start_at=now, end_at=end)
                if checked['outcome'] != 'eligible':
                    raise ValueError('Returned candidate did not pass final hard-rule validation')
                candidates.insert(0, candidates.pop(selected))
                solver.update({'method': 'cp_sat', 'status': engine.status_name(result).lower(),
                               'optimal': result == cp_model.OPTIMAL, 'objective': engine.objective_value,
                               'best_bound': engine.best_objective_bound, 'workers': 1,
                               'seed': engine.parameters.random_seed,
                               'time_limit_seconds': engine.parameters.max_time_in_seconds})
                assumptions.append('CP-SAT optimality refers only to this bounded one-consultation shortlist, '
                                   'not the global hospital schedule. Time-limited choices may vary by machine.')
            else:
                solver.update({'status': 'fallback', 'fallback_reason': engine.status_name(result).lower()})
        except (ImportError, ValueError, RuntimeError) as exc:
            solver.update({'status': 'fallback', 'fallback_reason': type(exc).__name__ + ': ' + str(exc)})
    solver['selected_score'] = candidates[0]['score'] if candidates else None
    return {'selected': candidates[0] if candidates else None, 'alternatives': candidates[1:],
            'rejected': rejected, 'solver': solver, 'assumptions': assumptions}
