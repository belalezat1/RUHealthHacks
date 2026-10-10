"""Hard rules grounded in the snapshot and explicitly labelled demo policy."""
from datetime import timedelta

from app.services.availability import active_work, interval_overlap, parse_time, reconcile


def _minutes(start, end):
    return max(0.0, (end - start).total_seconds() / 60)


def _union_minutes(intervals):
    total = 0.0
    end = None
    for start, stop in sorted(intervals):
        if end is None or start > end:
            total += _minutes(start, stop)
            end = stop
        elif stop > end:
            total += _minutes(end, stop)
            end = stop
    return total


def credentials_for(state, physician_id, hospital, end):
    """Three-way qualification evidence used by eligibility and forecast alike."""
    checks = []
    for kind, field, target, missing in [
        ('license', 'jurisdiction', hospital['jurisdiction'], 'LICENSE_MISSING'),
        ('privilege', 'hospital_id', hospital['id'], 'PRIVILEGE_MISSING'),
    ]:
        evidence = [c for c in state.get('credentials', []) if c['physician_id'] == physician_id
                    and c['kind'] == kind and c.get(field) == target]
        valid = [c for c in evidence if c.get('expires_at') and parse_time(c['expires_at']) >= end]
        if valid:
            checks.append((kind.upper() + '_VALID', 'pass', valid, f'{kind.title()} covers the whole work interval.'))
        elif not evidence:
            checks.append((missing, 'unknown', [], f'Missing {kind} evidence for {target}; qualification is unverified.'))
        elif any(not c.get('expires_at') for c in evidence):
            checks.append(('CREDENTIAL_EXPIRY_UNKNOWN', 'unknown', evidence,
                           f'{kind.title()} expiration is missing; validity cannot be assumed.'))
        else:
            checks.append(('CREDENTIAL_EXPIRED', 'fail', evidence,
                           f'{kind.title()} expires before the proposed work finishes.'))
    return checks


def _covered(state, physician_id, hospital_id, start, end):
    return any(s['physician_id'] == physician_id and s['hospital_id'] == hospital_id
               and s.get('status', 'scheduled') == 'scheduled'
               and parse_time(s['start_at']) <= start and parse_time(s['end_at']) >= end
               for s in state.get('shifts', []))


def _shared_coverage_conflict(state, physician_id, destination, origin, left, right, now, policy):
    """Match minimum-coverage slots to distinct physicians in the connected facility group."""
    routes = {}
    for physician in state['physicians']:
        pid = physician['id']
        if pid == physician_id:
            routes[pid] = {destination}
            continue
        availability = reconcile(state, pid, now, policy)
        work = active_work(state, pid, now)
        if (not availability['connected'] or availability['stale']
                or availability['status'] not in {'available', 'off_shift_available', 'busy'}
                or (availability['status'] == 'busy' and not work)
                or any(c.startswith('CONFLICTING_') for c in availability['conflicts'])):
            continue
        mandatory = {s['hospital_id'] for s in state.get('shifts', []) if s['physician_id'] == pid
                     and s.get('status', 'scheduled') == 'scheduled' and s.get('mandatory')
                     and interval_overlap(left, right, parse_time(s['start_at']), parse_time(s['end_at']))}
        fixed_work = {w.get('hospital_id') for w in work}
        fixed_work.update(a['hospital_id'] for a in state.get('assignments', [])
                          if a['physician_id'] == pid and a['status'] != 'completed'
                          and interval_overlap(left, right, parse_time(a['start_at']), parse_time(a['end_at'])))
        allowed = set()
        for hospital in state['hospitals']:
            hid = hospital['id']
            if (hospital['specialty'] not in physician.get('specialties', [])
                    or not _covered(state, pid, hid, left, right)
                    or (mandatory and mandatory != {hid}) or (fixed_work and fixed_work != {hid})):
                continue
            if all(status == 'pass' for _, status, _, _ in credentials_for(state, pid, hospital, right)):
                allowed.add(hid)
        routes[pid] = allowed
    # Unrelated pre-existing shortages must not block an improvement at the affected facilities.
    component = {origin}
    changed = True
    while changed:
        changed = False
        for allowed in routes.values():
            if component.intersection(allowed) and not allowed <= component:
                component.update(allowed)
                changed = True
    slots = [(h['id'], index) for h in sorted(state['hospitals'], key=lambda h: h['id'])
             if h['id'] in component for index in range(int(h.get('minimum_coverage', 0)))]
    assigned = {}

    def place(slot, visited):
        for pid in sorted(routes):
            if pid in visited or slot[0] not in routes[pid]:
                continue
            visited.add(pid)
            if pid not in assigned or place(assigned[pid], visited):
                assigned[pid] = slot
                return True
        return False

    missing = [slot[0] for slot in slots if not place(slot, set())]
    if missing:
        return {'hospital_ids': sorted(component), 'unfilled_minimum_coverage': missing,
                'reason': 'Distinct globally shared physicians cannot cover these facility obligations'}
    return None


def _coverage_conflicts(state, physician_id, hospital_id, start, end, now, policy):
    """Moving a physician cannot remove required scheduled capacity at another facility."""
    conflicts = []
    for shift in state.get('shifts', []):
        if (shift['physician_id'] != physician_id or shift['hospital_id'] == hospital_id
                or shift.get('status', 'scheduled') != 'scheduled'
                or not interval_overlap(start, end, parse_time(shift['start_at']), parse_time(shift['end_at']))):
            continue
        hospital = next((h for h in state['hospitals'] if h['id'] == shift['hospital_id']), None)
        required = int(hospital.get('minimum_coverage', 0)) if hospital else 0
        if shift.get('mandatory'):
            conflicts.append({'shift_id': shift['id'], 'hospital_id': shift['hospital_id'],
                              'reason': 'Mandatory shift cannot be moved to another facility'})
            continue
        if not required:
            continue
        affected_start, affected_end = max(start, parse_time(shift['start_at'])), min(end, parse_time(shift['end_at']))
        boundaries = {affected_start, affected_end}
        for other in state.get('shifts', []):
            boundaries.update(t for t in [parse_time(other['start_at']), parse_time(other['end_at'])]
                              if affected_start < t < affected_end)
        for left, right in zip(sorted(boundaries), sorted(boundaries)[1:]):
            replacements = []
            for physician in state['physicians']:
                pid = physician['id']
                if pid == physician_id or hospital['specialty'] not in physician.get('specialties', []):
                    continue
                if not _covered(state, pid, hospital['id'], left, right):
                    continue
                if any(status != 'pass' for _, status, _, _ in credentials_for(state, pid, hospital, right)):
                    continue
                availability = reconcile(state, pid, now, policy)
                if not availability['connected'] or availability['stale']:
                    continue
                work = active_work(state, pid, now)
                if any(w.get('hospital_id') != hospital['id'] for w in work):
                    continue
                if (availability['status'] not in {'available', 'off_shift_available', 'busy'}
                        or (availability['status'] == 'busy' and not work)
                        or any(c.startswith('CONFLICTING_') for c in availability['conflicts'])):
                    continue
                replacements.append(pid)
            if len(replacements) < required:
                conflicts.append({'hospital_id': hospital['id'], 'start_at': left.isoformat(),
                                  'remaining_qualified': len(replacements), 'required': required})
                break
            shared = _shared_coverage_conflict(state, physician_id, hospital_id, hospital['id'],
                                               left, right, now, policy)
            if shared:
                conflicts.append(shared)
                break
    return conflicts


def evaluate(state, physician_id, hospital_id, consultation_id, action, now, policy,
             consent=False, start_at=None, end_at=None):
    now = parse_time(now)
    physician = next((p for p in state.get('physicians', []) if p['id'] == physician_id), None)
    hospital = next((h for h in state.get('hospitals', []) if h['id'] == hospital_id), None)
    consult = next((c for c in state.get('consultations', []) if c['id'] == consultation_id), None)
    start = parse_time(start_at) if start_at else now
    end = parse_time(end_at) if end_at else start + timedelta(minutes=consult['duration_minutes'] if consult else 30)
    rules = []

    def add(code, status, observed, required, explanation, source='snapshot', observed_at=None):
        rules.append({'code': code, 'status': status, 'observed': observed, 'required': required,
                      'source': source, 'observed_at': observed_at or now.isoformat(), 'explanation': explanation})

    def output():
        statuses = {r['status'] for r in rules}
        outcome = 'ineligible' if 'fail' in statuses else 'unverified' if 'unknown' in statuses else 'eligible'
        return {'physician_id': physician_id, 'outcome': outcome, 'action': action, 'rules': rules}

    if not physician or not hospital or (consultation_id and not consult):
        add('ENTITY_UNKNOWN', 'unknown', {'physician': bool(physician), 'hospital': bool(hospital),
                                        'consultation': bool(consult)}, 'Known referenced records',
            'A required source record is missing.')
        return output()
    if action not in {'contact', 'assign'} or end <= start or start < now:
        add('INVALID_ACTION_INTERVAL', 'fail', {'action': action, 'start': start.isoformat(), 'end': end.isoformat()},
            'contact or assign with a positive interval beginning no earlier than now', 'Invalid proposed work interval.')
        return output()
    specialty = consult['specialty'] if consult else hospital['specialty']
    match = specialty in physician.get('specialties', [])
    add('SPECIALTY_MATCH' if match else 'SPECIALTY_MISMATCH', 'pass' if match else 'fail',
        physician.get('specialties', []), specialty, 'Specialty matches the supplied requirement.' if match
        else 'Physician specialty does not match the supplied consultation requirement.')
    facility_match = not consult or consult['hospital_id'] == hospital_id
    add('FACILITY_MATCH' if facility_match else 'FACILITY_MISMATCH', 'pass' if facility_match else 'fail',
        consult['hospital_id'] if consult else hospital_id, hospital_id, 'Consultation facility matches.' if facility_match
        else 'Proposed facility differs from the consultation facility.')
    if consult:
        waiting = consult['status'] == 'waiting' and parse_time(consult['requested_at']) <= now
        add('CONSULTATION_WAITING', 'pass' if waiting else 'fail', consult['status'], 'waiting and already requested',
            'Consultation is waiting for assignment.' if waiting else 'Consultation is not currently waiting.')
    for code, status, observed, explanation in credentials_for(state, physician_id, hospital, end):
        add(code, status, observed, 'Valid jurisdiction license and hospital privilege through work end',
            explanation, 'supplied_credentials')
    availability = reconcile(state, physician_id, now, policy)
    connected_status = 'pass' if availability['connected'] else 'unknown' if availability['stale'] else 'fail'
    add('CONNECTIVITY_CURRENT', connected_status, {'connected': availability['connected'], 'stale': availability['stale']},
        'Fresh connected heartbeat', 'Current connectivity confirmed.' if connected_status == 'pass'
        else 'A fresh connected heartbeat is required; self-reported availability cannot replace it.', 'availability_signals')
    available = availability['status'] in {'available', 'off_shift_available'}
    status = 'pass' if available else 'unknown' if availability['status'] in {'stale', 'unknown'} else 'fail'
    add('AVAILABILITY_CONFIRMED', status, availability['status'], 'Fresh available self-report and no busy evidence',
        'Fresh availability evidence permits consideration.' if available else 'Availability is busy, unavailable or unverified.',
        'availability_signals')
    source_conflicts = [c for c in availability['conflicts'] if c.startswith('CONFLICTING_')]
    add('SIGNALS_CONSISTENT', 'unknown' if source_conflicts else 'pass', source_conflicts,
        'No unresolved authoritative source contradictions',
        'Conflicting source evidence requires resolution.' if source_conflicts else 'No unresolved source contradictions.',
        'availability_signals')
    occupied = active_work(state, physician_id, now)
    overlap = [a for a in state.get('assignments', []) if a['physician_id'] == physician_id
               and a['status'] != 'completed'
               and interval_overlap(start, end, parse_time(a['start_at']), parse_time(a['end_at']))]
    busy = bool(occupied or overlap or availability['status'] == 'busy')
    add('ALREADY_OCCUPIED' if busy else 'CAPACITY_AVAILABLE', 'fail' if busy else 'pass',
        {'active_consultation_ids': [w.get('consultation_id', w.get('id')) for w in occupied],
         'overlapping_assignments': [a['id'] for a in overlap]}, 'One free globally shared slot',
        'Existing work or busy activity prevents another assignment.' if busy else 'The globally shared work slot is free.')
    add('ACTIVE_CONSULTATION_CONTINUITY', 'fail' if occupied else 'pass', len(occupied), 0,
        'Existing active work must complete before routing elsewhere.' if occupied else 'No active consultation is displaced.')
    shifts = [s for s in state.get('shifts', []) if s['physician_id'] == physician_id
              and s.get('status', 'scheduled') == 'scheduled']
    same_shift = [s for s in shifts if parse_time(s['start_at']) <= start < parse_time(s['end_at'])]
    minimum_block = policy.get('min_activation_block_minutes', 15)
    block_allowed = bool(same_shift) or _minutes(start, end) >= minimum_block
    add('MINIMUM_ACTIVATION_BLOCK', 'pass' if block_allowed else 'fail', _minutes(start, end), minimum_block,
        'The activation block meets the synthetic minimum duration, or falls within existing scheduled work.'
        if block_allowed else 'The off-shift block is shorter than the configured demo minimum.', 'demo_policy')
    covered = _covered(state, physician_id, hospital_id, start, end)
    extension = min([max(0, _minutes(parse_time(s['end_at']), end)) for s in same_shift], default=0)
    extension_allowed = not same_shift or extension <= policy.get('max_extension_minutes', 30)
    add('SHIFT_EXTENSION_LIMIT', 'pass' if extension_allowed else 'fail', extension,
        policy.get('max_extension_minutes', 30), 'Shift extension is within demo policy.' if extension_allowed
        else 'Proposed extension exceeds the configured demo limit.', 'demo_policy')
    # Contact does not create consent. Even on-shift assignment requires explicit consent in this demo.
    add('CONSENT_DEFERRED' if action == 'contact' else 'CONSENT_REQUIRED',
        'pass' if action == 'contact' or consent else 'fail', bool(consent),
        'Explicit scoped physician consent before assignment',
        'Consent is deferred to the physician response step; contacting does not authorize assignment.' if action == 'contact'
        else 'Explicit physician consent is present.' if consent else 'Physician consent has not been recorded.',
        'workflow_consent')
    add('WORK_BLOCK_AUTHORIZED', 'pass' if action == 'contact' or covered or consent else 'fail',
        {'covered_by_shift': covered, 'consent': bool(consent)}, 'Scheduled work or consenting activation',
        'Contact can propose an off-shift block; assignment requires an authorized work block.')
    rest = policy.get('min_rest_minutes', 120)
    rest_conflicts = []
    blocks = [(parse_time(s['start_at']), parse_time(s['end_at']), s['id']) for s in shifts]
    blocks += [(parse_time(a['start_at']), parse_time(a['end_at']), a['id'])
               for a in state.get('assignments', []) if a['physician_id'] == physician_id]
    # Merge shifts/assignments into the proposed work block before checking rest. All known future
    # commitments are inspected, including shifts outside the visible 90-minute forecast.
    merged_start, merged_end = start, end
    changed = True
    while changed:
        changed = False
        for left, right, _ in blocks:
            if left <= merged_end and right >= merged_start:
                new_start, new_end = min(left, merged_start), max(right, merged_end)
                if (new_start, new_end) != (merged_start, merged_end):
                    merged_start, merged_end, changed = new_start, new_end, True
    for left, right, identifier in blocks:
        if right < merged_start and _minutes(right, merged_start) < rest:
            rest_conflicts.append({'commitment_id': identifier, 'gap_minutes': _minutes(right, merged_start)})
        elif left > merged_end and _minutes(merged_end, left) < rest:
            rest_conflicts.append({'commitment_id': identifier, 'gap_minutes': _minutes(merged_end, left)})
    add('REST_VIOLATION' if rest_conflicts else 'REST_SATISFIED', 'fail' if rest_conflicts else 'pass',
        rest_conflicts, f'At least {rest} minutes between distinct work blocks',
        'The work block leaves insufficient rest before or after a known commitment.' if rest_conflicts
        else 'All known prior and later commitments permit the required rest.', 'demo_policy_and_schedule')
    continuous = _minutes(merged_start, merged_end)
    add('CONTINUOUS_WORK_LIMIT', 'pass' if continuous <= policy.get('max_continuous_work_minutes', 480) else 'fail',
        round(continuous, 2), policy.get('max_continuous_work_minutes', 480),
        'Continuous work, including adjacent shifts, is checked against the demo limit.', 'demo_policy_and_schedule')
    all_blocks = [(left, right) for left, right, _ in blocks] + [(start, end)]
    # Check every relevant rolling 24h boundary, rather than only time elapsed before now.
    anchors = {start, end} | {right for _, right in all_blocks if start - timedelta(hours=24) <= right <= end + timedelta(hours=24)}
    maximum = max((_union_minutes([(max(left, anchor - timedelta(hours=24)), min(right, anchor))
                                  for left, right in all_blocks if left < anchor and right > anchor - timedelta(hours=24)])
                   for anchor in anchors), default=0)
    add('MAXIMUM_WORK_LIMIT', 'pass' if maximum <= policy.get('max_work_minutes_24h', 720) else 'fail',
        round(maximum, 2), policy.get('max_work_minutes_24h', 720),
        'Known scheduled and assigned minutes are counted once in rolling 24-hour windows.', 'demo_policy_and_schedule')
    coverage = _coverage_conflicts(state, physician_id, hospital_id, start, end, now, policy)
    add('COVERAGE_CONTINUITY_FAILURE' if coverage else 'COVERAGE_CONTINUITY_PRESERVED',
        'fail' if coverage else 'pass', coverage, 'Preserve mandatory shifts and minimum qualified coverage',
        'Moving this physician would break an existing hospital coverage obligation.' if coverage
        else 'No mandatory coverage is removed from another hospital.', 'supplied_schedule_and_coverage')
    return output()
