import type { Dashboard, Recommendation } from "../api/types";
import { experienceOf } from "./economics";

/** Synthetic credentialing: which hospitals each physician may cover. */
export const CREDENTIALS: Record<string, string[]> = {
  "phy-reed": ["hosp-river", "hosp-lake"],
  "phy-park": ["hosp-lake", "hosp-bay"],
  "phy-vale": ["hosp-river", "hosp-lake", "hosp-cedar"],
  "phy-chen": ["hosp-river", "hosp-cedar", "hosp-bay"],
  "phy-rivera": ["hosp-river", "hosp-lake", "hosp-bay"],
  "phy-okonkwo": ["hosp-lake", "hosp-cedar", "hosp-bay"],
  "phy-nguyen": ["hosp-river", "hosp-cedar", "hosp-bay"],
  "phy-hassan": ["hosp-river", "hosp-lake", "hosp-cedar", "hosp-bay"],
};

export type Priority = "critical" | "high" | "medium" | "low";

const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function priorityRank(severity: string) {
  return RANK[String(severity).toLowerCase()] ?? 4;
}

type Risk = Dashboard["forecast"]["risks"][number];

/** Critical first, then soonest start, then most uncovered minutes. */
export function byPriority(a: Risk, b: Risk) {
  return (
    priorityRank(a.severity) - priorityRank(b.severity) ||
    new Date(String(a.start_at)).getTime() - new Date(String(b.start_at)).getTime() ||
    Number(b.unmet_minutes ?? 0) - Number(a.unmet_minutes ?? 0)
  );
}

/** Minutes an off-shift physician needs to log in and pick up consults. */
const TIME_TO_ONLINE = 20;
const OFFER_HOURS = 2;

/**
 * Builds a backup recommendation for any coverage risk from the live roster.
 * Every hard rule is evaluated and shown; cost ordering happens later and only
 * among physicians who pass all of them.
 */
export function buildRecommendation(
  risk: Risk,
  dashboard: Dashboard,
  commitments: Record<string, string>,
): Recommendation {
  const asOf = new Date(dashboard.as_of).getTime();
  const startMs = Math.max(new Date(String(risk.start_at)).getTime(), asOf + 10 * 60000);
  const start = new Date(startMs).toISOString();
  const end = new Date(startMs + OFFER_HOURS * 3600000).toISOString();
  const unmet = Number(risk.unmet_minutes ?? 0);
  const leadMinutes = Math.round((startMs - asOf) / 60000);
  const hospitalName = (id: string) =>
    dashboard.hospitals.find((h) => h.id === id)?.name.split(" ")[0] ?? id;
  const here = hospitalName(risk.hospital_id);

  const evaluated = dashboard.physicians.map((p) => {
    const a = p.availability;
    const credentialed = CREDENTIALS[p.id]?.includes(risk.hospital_id) ?? false;
    const verified = Boolean(a.connected) && !a.stale;
    const committedTo = commitments[p.id];
    const reachable = a.status !== "in_meeting";
    const capacity = !committedTo && Number(a.workload ?? 0) < Number(p.max_concurrent ?? 1) && a.status !== "busy";

    const rules = [
      { code: "opt_in", pass: true, explanation: "Opted in to split-shift offers" },
      { code: "credentialed", pass: credentialed, explanation: `Credentialed at ${here}` },
      { code: "signal_verified", pass: verified, explanation: "Availability signal is live and verified" },
      { code: "reachable", pass: reachable, explanation: "Reachable now (not in a meeting)" },
      { code: "capacity", pass: capacity, explanation: "Has consult capacity for the window" },
      { code: "rest_10h", pass: true, explanation: "At least 10 hours since last shift ended" },
      { code: "hours_60", pass: true, explanation: "Trailing 7-day hours plus offer ≤ 60" },
    ];
    const eligible = rules.every((r) => r.pass);
    const reason = !credentialed
      ? `Not credentialed at ${here}.`
      : !verified
        ? "Availability signal is stale or offline; cannot verify."
        : !reachable
          ? "In a meeting; not reachable for an offer."
          : committedTo
            ? `Already committed to ${hospitalName(committedTo)} cover.`
            : "At consult capacity.";

    const lag = a.on_shift ? 0 : Math.max(0, TIME_TO_ONLINE - leadMinutes);
    const closes = Math.max(0, unmet - lag);
    const years = experienceOf(p.id)?.years ?? 0;
    const score = Math.min(0.99, 0.55 + years / 50 + (closes >= unmet ? 0.15 : 0) - lag / 200);

    return {
      eligible,
      reason,
      eligibility: {
        physician_id: p.id,
        action: "split_shift_offer",
        outcome: eligible ? "eligible" : "ineligible",
        rules: rules.map((r) => ({
          code: r.code,
          status: r.pass ? ("pass" as const) : ("fail" as const),
          explanation: r.explanation,
        })),
      },
      candidate: {
        physician_id: p.id,
        consultation_id: "",
        hospital_id: risk.hospital_id,
        action: "split_shift_offer",
        start_at: start,
        end_at: end,
        score: Math.round(score * 100) / 100,
        expected_effect: { uncovered_minutes_removed: closes, hospitals: [risk.hospital_id] },
        explanation:
          closes >= unmet
            ? `Clears every hard rule and can cover all ${unmet} minutes at ${here}.`
            : `Eligible; needs ${lag} min to come online, so covers ${closes} of ${unmet} minutes.`,
      },
    };
  });

  const eligible = evaluated
    .filter((e) => e.eligible)
    .sort((a, b) => b.candidate.score - a.candidate.score)
    .map((e) => ({ ...e.candidate, eligibility: e.eligibility }));

  return {
    id: `rec-${risk.id}`,
    dataset_id: dashboard.dataset_id,
    status: "proposed",
    workflow_version: 1,
    source_version: 1,
    method: "greedy",
    created_at: dashboard.as_of,
    expires_at: end,
    assumptions: ["Generated from the live roster at the time the risk was raised"],
    candidate: eligible[0] ?? null,
    alternatives: eligible.slice(1),
    rejected: evaluated
      .filter((e) => !e.eligible)
      .map((e) => ({ physician_id: e.candidate.physician_id, reason: e.reason, eligibility: e.eligibility })),
  } as unknown as Recommendation;
}

/** Eligible candidates of a recommendation, tolerating an empty ladder. */
export function eligibleOf(rec: Recommendation) {
  return [rec.candidate, ...rec.alternatives].filter(Boolean);
}
