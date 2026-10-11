import type { Candidate } from "../api/types";

/**
 * Synthetic compensation data for the demo snapshot. Cost is only ever used to
 * order candidates who already pass every hard eligibility rule.
 */
export const SPLIT_SHIFT_PREMIUM = 1.25;

export const PHYSICIAN_ECONOMICS: Record<
  string,
  { years: number; rate: number }
> = {
  "phy-reed": { years: 16, rate: 290 },
  "phy-park": { years: 8, rate: 225 },
  "phy-vale": { years: 11, rate: 240 },
  "phy-chen": { years: 5, rate: 180 },
  "phy-rivera": { years: 3, rate: 165 },
  "phy-okonkwo": { years: 21, rate: 310 },
  "phy-nguyen": { years: 9, rate: 230 },
  "phy-hassan": { years: 13, rate: 255 },
};

export type RankBy = "cost" | "fit";

export type CostedCandidate = {
  candidate: Candidate;
  years: number;
  rate: number;
  hours: number;
  cost: number;
  minutesClosed: number;
  costPerMinute: number;
};

export function seniority(years: number): string {
  if (years >= 15) return "Attending lead";
  if (years >= 10) return "Senior";
  if (years >= 5) return "Mid-career";
  return "Early career";
}

export function experienceOf(physicianId: string) {
  return PHYSICIAN_ECONOMICS[physicianId];
}

export function costCandidate(candidate: Candidate): CostedCandidate {
  const econ = PHYSICIAN_ECONOMICS[candidate.physician_id] ?? { years: 0, rate: 0 };
  const hours =
    (new Date(candidate.end_at).getTime() - new Date(candidate.start_at).getTime()) /
    3_600_000;
  const cost = Math.round(hours * econ.rate * SPLIT_SHIFT_PREMIUM);
  const minutesClosed = Number(candidate.expected_effect?.uncovered_minutes_removed ?? 0);
  return {
    candidate,
    years: econ.years,
    rate: econ.rate,
    hours,
    cost,
    minutesClosed,
    costPerMinute: minutesClosed ? cost / minutesClosed : Infinity,
  };
}

/** Eligible candidates only, ordered by the chosen strategy. */
export function rankCandidates(candidates: Candidate[], rankBy: RankBy): CostedCandidate[] {
  const costed = candidates.map(costCandidate);
  return costed.sort((a, b) =>
    rankBy === "cost"
      ? a.cost - b.cost || b.candidate.score - a.candidate.score
      : b.candidate.score - a.candidate.score || a.cost - b.cost,
  );
}

export function usd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function duration(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
