"""Rationale comes from deterministic rule evidence, never generated clinical assertions."""


def explain_eligibility(result):
    blocked = [r['explanation'] for r in result['rules'] if r['status'] != 'pass']
    if blocked:
        return ' '.join(blocked)
    return ('All supplied qualification, availability, workload, rest and coverage checks pass. '
            'Contact eligibility does not grant consent or authorize assignment.'
            if result['action'] == 'contact' else 'All assignment checks pass with explicit physician consent.')


def explain_candidate(candidate):
    effect = candidate['expected_effect']
    verb = 'Contact this off-shift physician for a permitted work block' if candidate['action'] == 'activate' \
        else 'Route this consultation within the permitted shift window'
    return (f'{verb}. {effect["work_minutes"]:g} clinician work-minutes are projected for '
            f'this consultation; {effect["delay_minutes"]:g} minutes beyond its supplied deadline. '
            f'Incremental overtime: {effect["overtime_minutes"]:g} minutes. '
            'Known later commitments were checked beyond the 90-minute chart. '
            'Supervisor approval, explicit physician consent, and activation evidence are still required.')
