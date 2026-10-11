import type { Dashboard, Recommendation } from "../api/types";

export const DEMO_NOW = "2026-03-17T22:20:00.000Z";

function rules(
  physician_id: string,
  action: string,
  outcome: "eligible" | "ineligible" | "unverified",
  items: { code: string; pass: boolean; explanation: string }[],
) {
  return {
    physician_id,
    action,
    outcome,
    rules: items.map((i) => ({
      code: i.code,
      status: i.pass ? ("pass" as const) : ("fail" as const),
      explanation: i.explanation,
    })),
  };
}

const RULE_SET = [
  { code: "opt_in", pass: true, explanation: "Opted in to split-shift offers" },
  {
    code: "credentialed",
    pass: true,
    explanation: "Credentialed at one or more gap hospitals",
  },
  {
    code: "rest_10h",
    pass: true,
    explanation: "At least 10 hours since last shift ended",
  },
  {
    code: "hours_60",
    pass: true,
    explanation: "Trailing 7-day hours plus offer ≤ 60",
  },
  {
    code: "no_overlap",
    pass: true,
    explanation: "No overlap with an existing shift",
  },
  { code: "min_2h", pass: true, explanation: "Offer is at least 2 hours" },
];

export const demoRecommendation = {
  id: "rec-split-river-001",
  dataset_id: "synthetic-tue-1820",
  status: "proposed",
  workflow_version: 1,
  source_version: 1,
  expires_at: "2026-03-17T22:30:00.000Z",
  method: "greedy",
  created_at: DEMO_NOW,
  assumptions: ["Synthetic demo snapshot at 18:20 ET"],
  candidate: {
    physician_id: "phy-vale",
    consultation_id: "c-river-waiting-1",
    hospital_id: "hosp-river",
    action: "split_shift_offer",
    start_at: "2026-03-17T22:40:00.000Z",
    end_at: "2026-03-18T01:00:00.000Z",
    score: 0.91,
    eligibility: rules("phy-vale", "split_shift_offer", "eligible", RULE_SET),
    expected_effect: {
      uncovered_minutes_removed: 45,
      hospitals: ["hosp-river"],
      trap_guard: "seeded_workload_and_gap_hospital_limit",
    },
    explanation:
      "Dr. Morgan Vale clears every hard rule and closes the Riverfront gap without tripping the split-shift trap.",
  },
  alternatives: [
    {
      physician_id: "phy-chen",
      consultation_id: "c-river-waiting-1",
      hospital_id: "hosp-river",
      action: "split_shift_offer",
      start_at: "2026-03-17T22:50:00.000Z",
      end_at: "2026-03-18T01:00:00.000Z",
      score: 0.72,
      eligibility: rules("phy-chen", "split_shift_offer", "eligible", RULE_SET),
      expected_effect: { uncovered_minutes_removed: 30 },
      explanation: "Eligible, longer time-to-online.",
    },
  ],
  rejected: [
    {
      physician_id: "phy-rivera",
      reason:
        "Would absorb nearly all Riverfront + Lakeside calls at zero consult seed — split-shift trap.",
      eligibility: rules("phy-rivera", "split_shift_offer", "ineligible", [
        ...RULE_SET.map((r) =>
          r.code === "hours_60" ? { ...r, pass: false } : r,
        ),
        {
          code: "trap_guard",
          pass: false,
          explanation: "Split-shift trap guard failed",
        },
      ]),
    },
    {
      physician_id: "phy-okonkwo",
      reason: "Not credentialed at Riverfront.",
      eligibility: rules("phy-okonkwo", "split_shift_offer", "ineligible", [
        ...RULE_SET.map((r) =>
          r.code === "credentialed" ? { ...r, pass: false } : r,
        ),
      ]),
    },
  ],
} as unknown as Recommendation;

export function buildDemoDashboard(): Dashboard {
  const hospitals = [
    {
      id: "hosp-river",
      name: "Riverfront Medical Center",
      jurisdiction: "NJ",
      timezone: "America/New_York",
      specialty: "neurology",
      minimum_coverage: 2,
      arrival_work_minutes_per_bin: 8,
    },
    {
      id: "hosp-lake",
      name: "Lakeside Community Hospital",
      jurisdiction: "NJ",
      timezone: "America/New_York",
      specialty: "neurology",
      minimum_coverage: 1,
      arrival_work_minutes_per_bin: 4,
    },
    {
      id: "hosp-cedar",
      name: "Cedar Ridge Health",
      jurisdiction: "NJ",
      timezone: "America/New_York",
      specialty: "neurology",
      minimum_coverage: 1,
      arrival_work_minutes_per_bin: 3,
    },
    {
      id: "hosp-bay",
      name: "Bayview Regional",
      jurisdiction: "NJ",
      timezone: "America/New_York",
      specialty: "neurology",
      minimum_coverage: 1,
      arrival_work_minutes_per_bin: 5,
    },
  ];

  const physicians = [
    {
      id: "phy-reed",
      name: "Dr. Avery Reed",
      specialties: ["neurology"],
      max_concurrent: 1,
      availability: {
        status: "busy",
        connected: true,
        stale: false,
        conflicts: [],
        workload: 2,
        on_shift: true,
        signals: [],
      },
      shifts: [
        {
          id: "sh-reed",
          physician_id: "phy-reed",
          hospital_id: "hosp-river",
          start_at: "2026-03-17T12:00:00.000Z",
          end_at: "2026-03-17T22:55:00.000Z",
          status: "active",
          mandatory: true,
        },
      ],
    },
    {
      id: "phy-park",
      name: "Dr. Jordan Park",
      specialties: ["neurology"],
      max_concurrent: 1,
      availability: {
        status: "busy",
        connected: true,
        stale: false,
        conflicts: ["camera_active_without_synapse"],
        workload: 1,
        on_shift: true,
        signals: [],
      },
    },
    {
      id: "phy-vale",
      name: "Dr. Morgan Vale",
      specialties: ["neurology"],
      max_concurrent: 1,
      availability: {
        status: "available",
        connected: true,
        stale: false,
        conflicts: [],
        workload: 0,
        on_shift: false,
        signals: [],
      },
    },
    {
      id: "phy-chen",
      name: "Dr. Priya Chen",
      specialties: ["neurology"],
      max_concurrent: 1,
      availability: {
        status: "available",
        connected: true,
        stale: false,
        conflicts: [],
        workload: 0,
        on_shift: false,
        signals: [],
      },
    },
    {
      id: "phy-rivera",
      name: "Dr. Sam Rivera",
      specialties: ["neurology"],
      max_concurrent: 1,
      availability: {
        status: "available",
        connected: false,
        stale: true,
        conflicts: [],
        workload: 0,
        on_shift: false,
        signals: [],
      },
    },
    {
      id: "phy-okonkwo",
      name: "Dr. Ada Okonkwo",
      specialties: ["neurology"],
      max_concurrent: 1,
      availability: {
        status: "available",
        connected: true,
        stale: false,
        conflicts: [],
        workload: 0,
        on_shift: false,
        signals: [],
      },
    },
    {
      id: "phy-nguyen",
      name: "Dr. Minh Nguyen",
      specialties: ["neurology"],
      max_concurrent: 1,
      availability: {
        status: "available",
        connected: true,
        stale: false,
        conflicts: [],
        workload: 1,
        on_shift: true,
        signals: [],
      },
    },
    {
      id: "phy-hassan",
      name: "Dr. Leila Hassan",
      specialties: ["neurology"],
      max_concurrent: 1,
      availability: {
        status: "in_meeting",
        connected: true,
        stale: false,
        conflicts: [],
        workload: 0,
        on_shift: true,
        signals: [],
      },
    },
  ];

  const consultations = [
    {
      id: "c-river-waiting-1",
      hospital_id: "hosp-river",
      specialty: "neurology",
      priority: "urgent",
      requested_at: "2026-03-17T22:05:00.000Z",
      deadline_at: "2026-03-17T22:35:00.000Z",
      duration_minutes: 25,
      status: "waiting",
      physician_id: null,
    },
    {
      id: "c-lake-active-1",
      hospital_id: "hosp-lake",
      specialty: "neurology",
      priority: "standard",
      requested_at: "2026-03-17T21:40:00.000Z",
      deadline_at: "2026-03-17T22:40:00.000Z",
      duration_minutes: 30,
      status: "in_progress",
      physician_id: "phy-park",
    },
    {
      id: "c-bay-active-1",
      hospital_id: "hosp-bay",
      specialty: "neurology",
      priority: "urgent",
      requested_at: "2026-03-17T21:50:00.000Z",
      deadline_at: "2026-03-17T22:20:00.000Z",
      duration_minutes: 20,
      status: "in_progress",
      physician_id: "phy-reed",
    },
  ];

  const intervals = [0, 15, 30, 45, 60, 75].map((offset, i) => {
    const start = new Date(new Date(DEMO_NOW).getTime() + offset * 60000);
    const end = new Date(start.getTime() + 15 * 60000);
    const demand = (i >= 2 ? 3 : 2) * 15;
    const capacity = (i >= 2 ? (i >= 4 ? 1 : 2) : 3) * 15;
    return {
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      demand_minutes: demand,
      capacity_minutes: capacity,
      unmet_minutes: Math.max(0, demand - capacity),
      hospitals: [],
    };
  });

  return {
    as_of: DEMO_NOW,
    dataset_id: "synthetic-tue-1820",
    label: "Tuesday 17 Mar 2026 · 18:20 ET",
    counts: {
      physicians: physicians.length,
      waiting: 1,
      at_risk_hospitals: 2,
      pending_interventions: 1,
    },
    hospitals,
    physicians,
    consultations,
    forecast: {
      as_of: DEMO_NOW,
      horizon_minutes: 90,
      intervals,
      risks: [
        {
          id: "risk-river-shift-end",
          hospital_id: "hosp-river",
          severity: "critical",
          reason:
            "Dr. Reed's shift ends in 35 minutes while Riverfront demand sits above baseline. Credentialed capacity drops below the minimum of 2.",
          explanation:
            "Shift end + demand spike. Without a split-shift offer, uncovered minutes begin at 18:55 ET.",
          start_at: "2026-03-17T22:55:00.000Z",
          end_at: "2026-03-18T00:20:00.000Z",
          unmet_minutes: 45,
        },
        {
          id: "risk-lake-signal",
          hospital_id: "hosp-lake",
          severity: "medium",
          reason:
            "Dr. Park shows camera-active without a Synapse session — availability is flagged as conflicted.",
          explanation:
            "Signal conflict: treat as busy until reconciled. Lakeside has thin backup.",
          start_at: DEMO_NOW,
          unmet_minutes: 15,
        },
      ],
    },
    recommendations: [demoRecommendation],
    jev: { mode: "advisory", status: "idle", model: "none" },
    freshness: { stale: 1, conflicts: 1 },
  } as unknown as Dashboard;
}