import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { IconCheck, IconChevron, IconX } from "./Icons";
import { EASE, Pill } from "./ui";
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

function isPass(r: LooseRule) {
  return r.passed ?? r.status === "pass";
}

function Rules({ rules }: { rules?: LooseRule[] }) {
  if (!rules?.length) return null;
  return (
    <ul className="rx-rules">
      {rules.map((r, i) => {
        const pass = isPass(r);
        return (
          <li key={r.code ?? r.id ?? i} className={pass ? "pass" : "fail"}>
            <span className="rx-rule-mark" aria-hidden>
              {pass ? <IconCheck size={11} strokeWidth={2.6} /> : <IconX size={11} strokeWidth={2.6} />}
            </span>
            <span>{r.label ?? r.explanation ?? r.code ?? r.id}</span>
            <span className="sr-only">{pass ? "passed" : "failed"}</span>
          </li>
        );
      })}
    </ul>
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
  const reduce = useReducedMotion();

  const unordered: {
    kind: "recommended" | "alternative" | "rejected";
    physician_id: string;
    outcome?: string;
    explanation?: string;
    rules?: LooseRule[];
  }[] = [
    ...(recommendation.candidate ? [{
      kind: "recommended" as const,
      physician_id: recommendation.candidate.physician_id,
      outcome: recommendation.candidate.eligibility?.outcome,
      explanation: Array.isArray(recommendation.candidate.explanation)
        ? recommendation.candidate.explanation.join(" ")
        : recommendation.candidate.explanation,
      rules: recommendation.candidate.eligibility?.rules as LooseRule[] | undefined,
    }] : []),
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
    <div className="rx-elig">
      <div className="rx-callout warn">
        <strong>Split-shift trap</strong>
        <p>
          A physician joining mid-shift at zero consults would absorb nearly every call. We seed workload and limit
          offers to gap hospitals so the imbalance is fixed, not moved.
        </p>
      </div>
      {rows.map((row, idx) => {
        const status = outcomeLabel(row.outcome, row.kind);
        const open = openIdx === idx;
        const failed = row.rules?.filter((r) => !isPass(r)).length ?? 0;
        const role =
          row.kind === "recommended"
            ? order
              ? "Offer first"
              : "Recommended"
            : row.kind === "alternative"
              ? order
                ? "Backup"
                : "Alternative"
              : "Excluded";
        return (
          <section className={`rx-elig-item${open ? " is-open" : ""}`} key={row.physician_id || idx}>
            <button
              type="button"
              className="rx-elig-trigger"
              aria-expanded={open}
              onClick={() => setOpenIdx(open ? null : idx)}
            >
              <span style={{ minWidth: 0 }}>
                <strong>{physicianName(row.physician_id, physicians)}</strong>
                <span className="meta">
                  {role}
                  {row.rules?.length
                    ? failed
                      ? ` · fails ${failed} of ${row.rules.length} rules`
                      : ` · passes all ${row.rules.length} rules`
                    : ""}
                </span>
              </span>
              <Pill tone={status.tone === "pass" ? "ok" : status.tone === "fail" ? "critical" : "caution"} dot>
                {status.label}
              </Pill>
              <IconChevron size={16} />
            </button>
            <AnimatePresence initial={false}>
              {open ? (
                <motion.div
                  style={{ overflow: "hidden" }}
                  initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
                  exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: EASE }}
                >
                  {row.explanation ? (
                    <p style={{ padding: "0 16px 8px", fontSize: 13, color: "var(--rx-text-2)" }}>{row.explanation}</p>
                  ) : null}
                  <Rules rules={row.rules} />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </section>
        );
      })}
    </div>
  );
}
