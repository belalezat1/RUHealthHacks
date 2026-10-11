import type { Recommendation } from "../api/types";
import { physicianName } from "../lib/format";

type Props = {
  recommendation: Recommendation;
  physicians: { id: string; name: string }[];
};

type LooseRule = {
  code?: string;
  id?: string;
  label?: string;
  explanation?: string;
  status?: string;
  passed?: boolean;
};

function Rules({ rules }: { rules?: LooseRule[] }) {
  if (!rules?.length) return null;
  return (
    <div className="rule-grid">
      {rules.map((r, i) => {
        const pass = r.passed ?? r.status === "pass";
        return (
          <div key={r.code ?? r.id ?? i} className={`rule ${pass ? "pass" : "fail"}`}>
            <span>{r.label ?? r.explanation ?? r.code ?? r.id}</span>
            <strong>{pass ? "Pass" : "Fail"}</strong>
          </div>
        );
      })}
    </div>
  );
}

export function EligibilityMatrix({ recommendation, physicians }: Props) {
  const rows: {
    kind: "recommended" | "alternative" | "rejected";
    physician_id: string;
    outcome?: string;
    explanation?: string;
    rules?: LooseRule[];
  }[] = [
    {
      kind: "recommended",
      physician_id: recommendation.candidate.physician_id,
      outcome: recommendation.candidate.eligibility?.outcome,
      explanation: Array.isArray(recommendation.candidate.explanation)
        ? recommendation.candidate.explanation.join(" ")
        : recommendation.candidate.explanation,
      rules: recommendation.candidate.eligibility?.rules as LooseRule[] | undefined,
    },
    ...recommendation.alternatives.map((a) => ({
      kind: "alternative" as const,
      physician_id: a.physician_id,
      outcome: a.eligibility?.outcome,
      explanation: Array.isArray(a.explanation)
        ? a.explanation.join(" ")
        : a.explanation,
      rules: a.eligibility?.rules as LooseRule[] | undefined,
    })),
    ...recommendation.rejected.map((r) => ({
      kind: "rejected" as const,
      physician_id: String(r.physician_id ?? ""),
      outcome: r.eligibility?.outcome,
      explanation: r.reason ?? (typeof r.explanation === "string" ? r.explanation : undefined),
      rules: (r.eligibility?.rules ?? r.rules) as LooseRule[] | undefined,
    })),
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div
        style={{
          padding: 14,
          borderRadius: 10,
          background: "var(--caution-soft)",
          border: "1px solid rgba(196,122,26,0.25)",
        }}
      >
        <strong>Split-shift trap</strong>
        <p style={{ margin: "6px 0 0", color: "var(--ink-muted)", fontSize: 14 }}>
          A physician joining mid-shift at zero consults would absorb nearly every
          call. We seed workload and limit offers to gap hospitals so the imbalance
          is fixed, not moved.
        </p>
      </div>
      {rows.map((row, idx) => (
        <section key={idx}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 8,
              gap: 8,
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>
                {physicianName(row.physician_id, physicians)}
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                {row.kind === "recommended"
                  ? "Recommended"
                  : row.kind === "alternative"
                    ? "Alternative"
                    : "Excluded"}
                {row.explanation ? ` · ${row.explanation}` : ""}
              </div>
            </div>
            <span
              className={`pill pill-${row.kind === "rejected" ? "critical" : "signal"}`}
            >
              {row.outcome ?? row.kind}
            </span>
          </div>
          <Rules rules={row.rules} />
        </section>
      ))}
    </div>
  );
}