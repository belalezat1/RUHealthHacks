"""Pure availability reconciliation. A connected device is not proof of free capacity."""
from datetime import UTC, datetime, timedelta


def parse_time(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if value.tzinfo is None:
        raise ValueError('Operational timestamps must include a timezone')
    return value.astimezone(UTC)


def interval_overlap(start, end, other_start, other_end):
    return start < other_end and other_start < end


def signal_order(signal):
    sequence = signal.get('source_sequence')
    return (sequence if sequence is not None else -1, parse_time(signal['observed_at']), signal['id'])


def active_work(state, physician_id, now):
    """Actual active work blocks until completion; expected ends are not completion evidence."""
    work = {c['id']: c for c in state.get('consultations', [])
            if c.get('physician_id') == physician_id and c['status'] in {'assigned', 'active'}
            and parse_time(c['requested_at']) <= now}
    for assignment in state.get('assignments', []):
        if (assignment['physician_id'] == physician_id and assignment['status'] in {'assigned', 'verified'}
                and parse_time(assignment['start_at']) <= now):
            work.setdefault(assignment['consultation_id'], assignment)
    return list(work.values())


def reconcile(state, physician_id, now, policy):
    now = parse_time(now)
    conflicts = []
    latest = {}
    for signal in state.get('signals', []):
        if signal['physician_id'] != physician_id:
            continue
        observed = parse_time(signal['observed_at'])
        if observed > now:
            if observed > now + timedelta(seconds=policy.get('future_tolerance_seconds', 120)):
                conflicts.append(f'FUTURE_SIGNAL: {signal["id"]} excluded from availability')
            continue
        key = signal['source'], signal['kind']
        if key not in latest or signal_order(signal) > signal_order(latest[key]):
            latest[key] = signal
    precedence = policy.get('source_priority', {})
    signals = []
    for signal in latest.values():
        age = (now - parse_time(signal['observed_at'])).total_seconds()
        ttl = policy.get(signal['kind'] + '_freshness_seconds', 300)
        signals.append({**signal, 'age_seconds': round(age, 3), 'fresh': age <= ttl})
    signals.sort(key=lambda s: (s['kind'], s['source'], s['id']))

    def chosen(kind):
        candidates = [s for s in signals if s['kind'] == kind]
        if not candidates:
            return None
        fresh_values = {s['value'] for s in candidates if s['fresh']}
        if len(fresh_values) > 1:
            conflicts.append(f'CONFLICTING_{kind.upper()}: ' + ', '.join(sorted(fresh_values)))
        return max(candidates, key=lambda s: (precedence.get(s['source'], 50),
                                             parse_time(s['observed_at']), s['source'], s['id']))

    heartbeat = chosen('heartbeat')
    reported = chosen('self_report')
    activity = chosen('activity')
    connected = bool(heartbeat and heartbeat['fresh'] and heartbeat['value'] == 'connected')
    stale = heartbeat is None or not heartbeat['fresh'] or bool(reported and not reported['fresh'])
    workload = len(active_work(state, physician_id, now))
    on_shift = any(s['physician_id'] == physician_id and s.get('status', 'scheduled') == 'scheduled'
                   and parse_time(s['start_at']) <= now < parse_time(s['end_at'])
                   for s in state.get('shifts', []))
    busy = workload > 0 or bool(activity and activity['fresh'] and activity['value'] in {'busy', 'active'})
    available_report = bool(reported and reported['fresh'] and reported['value'] == 'available')
    if busy and available_report:
        conflicts.append('BUSY_VS_AVAILABLE: active work/activity overrides an available self-report')
    if available_report and not connected:
        conflicts.append('AVAILABILITY_WITHOUT_CONNECTIVITY: self-report does not prove current connection')
    if busy:
        status = 'busy'
    elif reported and reported['fresh'] and reported['value'] in {'unavailable', 'busy'}:
        status = 'unavailable'
    elif stale:
        status = 'stale'
    elif not connected:
        status = 'disconnected'
    elif available_report:
        status = 'available' if on_shift else 'off_shift_available'
    else:
        status = 'unknown'
    return {'status': status, 'connected': connected, 'stale': stale, 'conflicts': sorted(set(conflicts)),
            'workload': workload, 'on_shift': on_shift, 'signals': signals}
