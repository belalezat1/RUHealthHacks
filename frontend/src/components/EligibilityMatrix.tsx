import { useState } from "react";
import type { Recommendation } from "../api/types";
import { physicianName } from "../lib/format";

type Props = {
  recommendation: Recommendation;
  physicians: { id: string; name: string }[];
  /** Eligible physician ids in offer order; the first is offered first. */
  order?: string[];
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

function outcomeLabel(outcome?: string, kind?: string) {
  const raw = (outcome ?? kind ?? "").toLowerCase();
  if (raw.includes("ineligible") || raw === "rejected" || raw === "excluded") {
    return { label: "Ineligible", tone: "fail" as const };
  }
  if (raw.includes("eligible") || raw === "recommended" || raw === "alternative") {
    return { label: "Eligible", tone: "pass" as const };
  }
  if (raw.includes("unverified")) {
    return { label: "Unverified", tone: "warn" as const };
  }
  return { label: outcome ?? kind ?? "Review", tone: "warn" as const };
}

export function EligibilityMatrix({ recommendation, physicians, order }: Props) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  const unordered: {
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

  const rank = (id: string) => {
    const i = order?.indexOf(id) ?? -1;
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const rows = order
    ? [
        ...unordered
          .filter((r) => r.kind !== "rejected")
          .sort((a, b) => rank(a.physician_id) - rank(b.physician_id))
          .map((r, i) => ({ ...r, kind: i === 0 ? ("recommended" as const) : ("alternative" as const) })),
        ...unordered.filter((r) => r.kind === "rejected"),
      ]
    : unordered;

  return (
    <div className="eligibility-matrix">
      <div className="eligibility-trap">
        <strong>Split-shift trap</strong>
        <p>
          A physician joining mid-shift at zero consults would absorb nearly every
          call. We seed workload and limit offers to gap hospitals so the imbalance
          is fixed, not moved.
        </p>
      </div>
      {rows.map((row, idx) => {
        const status = outcomeLabel(row.outcome, row.kind);
        const open = openIdx === idx;
        return (
          <section className={`eligibility-card${open ? " open" : ""}`} key={idx}>
            <div className="eligibility-card-head">
              <div>
                <div className="eligibility-name">
                  {physicianName(row.physician_id, physicians)}
                </div>
                <div className="eligibility-meta">
                  {row.kind === "recommended"
                    ? order
                      ? "Offer first"
                      : "Recommended"
                    : row.kind === "alternative"
                      ? order
                        ? "Backup"
                        : "Alternative"
                      : "Excluded"}
                  {row.explanation ? ` · ${row.explanation}` : ""}
                </div>
              </div>
              <button
                type="button"
                className={`eligibility-status-btn ${status.tone}`}
                aria-pressed={open}
                onClick={() => setOpenIdx(open ? null : idx)}
              >
                {status.label}
              </button>
            </div>
            {open ? <Rules rules={row.rules} /> : null}
          </section>
        );
      })}
    </div>
  );
}
