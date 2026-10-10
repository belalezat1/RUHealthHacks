import type { Eligibility, Rule } from "../api/types";
import { Badge, human, time, tone } from "./ui";

function RuleEvidence({ rule }: { rule: Rule }) {
  return (
    <div className="rule">
      <Badge tone={tone(rule.status)}>{rule.status}</Badge>
      <div>
        <strong>{human(rule.code)}</strong>
        <p>{rule.explanation}</p>
        <small>
          Observed: {human(rule.observed)} · Required: {human(rule.required)}
        </small>
        <small>
          Source: {rule.source || "Not supplied"}
          {rule.observed_at ? ` · ${time(rule.observed_at)}` : ""}
        </small>
      </div>
    </div>
  );
}

export function EligibilityDetails({
  eligibility,
}: {
  eligibility: Eligibility;
}) {
  const attention = eligibility.rules.filter((rule) => rule.status !== "pass");
  const passed = eligibility.rules.filter((rule) => rule.status === "pass");
  return (
    <div className="eligibility">
      <div className="subheading">
        <h3>Eligibility evidence</h3>
        <Badge tone={tone(eligibility.outcome)}>
          {human(eligibility.outcome)} to {eligibility.action}
        </Badge>
      </div>
      {attention.length > 0 && (
        <div className="rule-list">
          {attention.map((rule, index) => (
            <RuleEvidence key={`${rule.code}-${index}`} rule={rule} />
          ))}
        </div>
      )}
      {passed.length > 0 && (
        <details className="passing-rules">
          <summary>{passed.length} passing checks · Inspect evidence</summary>
          <div className="rule-list">
            {passed.map((rule, index) => (
              <RuleEvidence key={`${rule.code}-${index}`} rule={rule} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
