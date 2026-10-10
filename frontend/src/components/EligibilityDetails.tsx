import type { Eligibility } from '../api/types';
import { Badge, human, time, tone } from './ui';
export function EligibilityDetails({ eligibility }: { eligibility: Eligibility }) {
  return <div className="eligibility"><div className="subheading"><h3>Eligibility evidence</h3><Badge tone={tone(eligibility.outcome)}>{human(eligibility.outcome)} to {eligibility.action}</Badge></div><div className="rule-list">{eligibility.rules.map((rule, index) => <div className="rule" key={`${rule.code}-${index}`}><Badge tone={tone(rule.status)}>{rule.status}</Badge><div><strong>{human(rule.code)}</strong><p>{rule.explanation}</p><small>Observed: {human(rule.observed)} · Required: {human(rule.required)}</small><small>Source: {rule.source || 'Not supplied'}{rule.observed_at ? ` · ${time(rule.observed_at)}` : ''}</small></div></div>)}</div></div>;
}
