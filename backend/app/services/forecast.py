"""Transparent six-bin qualified work-minute projection with globally shared capacity."""
from datetime import timedelta

from app.services.availability import parse_time, reconcile
from app.services.eligibility import credentials_for


def build_forecast(state, now, policy):
    now = parse_time(now)
    hospitals = sorted(state.get('hospitals', []), key=lambda h: h['id'])
    physicians = sorted(state.get('physicians', []), key=lambda p: p['id'])
    hospital_map = {h['id']: h for h in hospitals}
    availability = {p['id']: reconcile(state, p['id'], now, policy) for p in physicians}
    shifts = {p['id']: [s for s in state.get('shifts', []) if s['physician_id'] == p['id']
                       and s.get('status', 'scheduled') == 'scheduled'] for p in physicians}
    assignments = {a['consultation_id']: a for a in state.get('assignments', []) if a['status'] != 'completed'}
    tasks = []
    known_work = set()
    for c in state.get('consultations', []):
        if c['status'] == 'completed' or parse_time(c['requested_at']) > now or c['hospital_id'] not in hospital_map:
            continue
        remaining = float(c['duration_minutes'])
        physician_id = c.get('physician_id') if c['status'] in {'assigned', 'active'} else None
        if physician_id:
            known_work.add(physician_id)
            assignment = assignments.get(c['id'])
            expected = (parse_time(assignment['end_at']) if assignment else
                        parse_time(c.get('expected_end_at') or c['requested_at']) +
                        (timedelta() if c.get('expected_end_at') else timedelta(minutes=remaining)))
            remaining = max(1, (expected - now).total_seconds() / 60)
        tasks.append({'id': c['id'], 'hospital_id': c['hospital_id'], 'physician_id': physician_id,
                      'specialty': c['specialty'],
                      'remaining': remaining, 'priority': c['priority'], 'deadline': parse_time(c['deadline_at'])})
    # Aggregate arrivals are work-minute assumptions, never invented patient records.
    arrival_remaining = {h['id']: 0.0 for h in hospitals}
    qualified = {}
    for physician in physicians:
        for hospital in hospitals:
            qualified[(physician['id'], hospital['id'])] = (
                hospital['specialty'] in physician.get('specialties', [])
                and all(status == 'pass' for _, status, _, _ in credentials_for(
                    state, physician['id'], hospital, now)))
    intervals = []
    risks = []
    for bin_index in range(6):
        start, end = now + timedelta(minutes=15 * bin_index), now + timedelta(minutes=15 * (bin_index + 1))
        allocated = {h['id']: 0.0 for h in hospitals}
        demand = {}
        for hospital in hospitals:
            hid = hospital['id']
            arrival_remaining[hid] += float(hospital.get('arrival_work_minutes_per_bin', 0))
            backlog = sum(t['remaining'] for t in tasks if t['hospital_id'] == hid) + arrival_remaining[hid]
            demand[hid] = max(backlog, hospital.get('minimum_coverage', 0) * 15.0)
        for minute in range(15):
            moment, stop = start + timedelta(minutes=minute), start + timedelta(minutes=minute + 1)
            for physician in physicians:
                pid, avail = physician['id'], availability[physician['id']]
                if not avail['connected'] or avail['stale']:
                    continue
                if any(c.startswith('CONFLICTING_') for c in avail['conflicts']):
                    continue
                if avail['status'] not in {'available', 'off_shift_available', 'busy'}:
                    continue
                if avail['status'] == 'busy' and pid not in known_work:
                    continue
                own_tasks = [t for t in tasks if t['physician_id'] == pid and t['remaining'] > 0]
                if own_tasks:
                    possible = {t['hospital_id'] for t in own_tasks}
                else:
                    current = [s for s in shifts[pid] if parse_time(s['start_at']) < stop
                               and parse_time(s['end_at']) > moment]
                    mandatory = [s for s in current if s.get('mandatory')]
                    possible = {s['hospital_id'] for s in (mandatory or current)}
                possible = [hid for hid in possible if hid in hospital_map and qualified[(pid, hid)]
                            and all(status == 'pass' for _, status, _, _ in credentials_for(
                                state, pid, hospital_map[hid], stop))]
                if not possible:
                    continue

                def urgency(hid):
                    queued = [t for t in tasks if t['hospital_id'] == hid and t['remaining'] > 0
                              and t['specialty'] in physician.get('specialties', [])
                              and (t['physician_id'] is None or t['physician_id'] == pid)]
                    urgent = any(t['priority'] == 'urgent' for t in queued)
                    due = min((t['deadline'] for t in queued), default=end + timedelta(days=1))
                    unmet_coverage = max(0, hospital_map[hid].get('minimum_coverage', 0) * (minute + 1) - allocated[hid])
                    backlog = sum(t['remaining'] for t in queued) + arrival_remaining[hid]
                    return (not bool(own_tasks), not urgent, due, -unmet_coverage, -backlog, hid)

                hid = min(possible, key=urgency)
                amount = 1.0
                if not own_tasks:
                    windows = [s for s in shifts[pid] if s['hospital_id'] == hid
                               and parse_time(s['start_at']) < stop and parse_time(s['end_at']) > moment]
                    amount = max((max(0, (min(stop, parse_time(s['end_at'])) -
                                         max(moment, parse_time(s['start_at']))).total_seconds() / 60)
                                  for s in windows), default=0)
                allocated[hid] += amount
                remaining_slot = amount
                queue = sorted([t for t in tasks if t['hospital_id'] == hid and t['remaining'] > 0
                                and t['specialty'] in physician.get('specialties', [])
                                and (t['physician_id'] is None or t['physician_id'] == pid)],
                               key=lambda t: (t['physician_id'] != pid, t['priority'] != 'urgent',
                                              t['deadline'], t['id']))
                for task in queue:
                    used = min(task['remaining'], remaining_slot)
                    task['remaining'] -= used
                    remaining_slot -= used
                    if remaining_slot <= 0:
                        break
                arrival_remaining[hid] = max(0, arrival_remaining[hid] - remaining_slot)
        rows = []
        for hospital in hospitals:
            hid = hospital['id']
            # Idle capacity of the wrong specialty cannot erase unresolved work.
            residual_work = sum(t['remaining'] for t in tasks if t['hospital_id'] == hid) + arrival_remaining[hid]
            unmet = max(0, residual_work, hospital.get('minimum_coverage', 0) * 15 - allocated[hid])
            overdue = [t for t in tasks if t['hospital_id'] == hid and t['remaining'] > 0
                       and t['deadline'] < end]
            severity = 'critical' if unmet > 0 and any(t['priority'] == 'urgent' for t in overdue) \
                else 'high' if unmet >= 15 else 'warning' if unmet > 0 else 'covered'
            reason = (f'{unmet:.1f} clinician work-minutes exceed allocated qualified capacity; '
                      f'{len(overdue)} supplied consultation deadlines are projected unresolved.' if unmet else
                      'Allocated qualified capacity meets projected work and minimum coverage in this interval.')
            row = {'hospital_id': hid, 'demand_minutes': round(demand[hid], 2),
                   'capacity_minutes': round(allocated[hid], 2), 'unmet_minutes': round(unmet, 2),
                   'severity': severity, 'reason': reason}
            rows.append(row)
            if unmet:
                risks.append({'id': f'{hid}:{bin_index}', **row, 'start_at': start.isoformat(), 'end_at': end.isoformat()})
        intervals.append({'start_at': start.isoformat(), 'end_at': end.isoformat(),
                          **{key: round(sum(row[key] for row in rows), 2)
                             for key in ['demand_minutes', 'capacity_minutes', 'unmet_minutes']}, 'hospitals': rows})
    expiry = now + timedelta(seconds=3)
    for signals in availability.values():
        for signal in signals['signals']:
            valid_to = parse_time(signal['observed_at']) + timedelta(
                seconds=policy.get(signal['kind'] + '_freshness_seconds', 300))
            if now < valid_to < expiry:
                expiry = valid_to
    assumptions = list(policy.get('forecast_assumptions', []))
    assumptions.append('Work-minutes are allocated in one-minute steps; this forecast is a capacity projection, '
                       'not a committed non-preemptive consultation schedule. Backlog may recur across bins; '
                       'do not sum bin backlog into unique patient demand.')
    return {'intervals': intervals, 'risks': risks, 'assumptions': assumptions,
            'as_of': now.isoformat(), 'valid_until': expiry.isoformat()}
