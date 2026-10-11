// Types mirroring the v1 API (see docs/api-contract.md).

export type Role = "coordinator" | "clinical_lead" | "physician";

export interface User {
  username: string;
  display_name: string;
  role: Role;
  physician_id: string | null;
}

export interface LiveState {
  run_id: string;
  revision: number;
  as_of: string;
  label: string;
  release_sha: string;
  schema_version: number;
}

export interface Envelope<T> {
  request_id: string;
  schema_version: number;
  run_id: string;
  revision: number;
  as_of: string;
  release_sha: string;
  timing: { engine_ms: number | null };
  data: T;
}

export type Severity = "critical" | "warning" | "info";

export interface RiskAction {
  action: "reassign" | "escalate" | "nudge" | "propose_offer" | "monitor";
  role: "coordinator" | "clinical_lead";
  label: string;
  why: string;
  target_physician_id?: string;
}

export interface Risk {
  id: string;
  rank: number;
  kind: string;
  severity: Severity;
  score: number;
  title: string;
  summary: string;
  detail: string;
  consult_id: string | null;
  hospital_id: string | null;
  physician_id: string | null;
  stage?: string;
  elapsed_min: number | null;
  threshold: { warning: number; critical: number } | null;
  action: RiskAction;
}

export interface Physician {
  physician_id: string;
  name: string;
  shift_et: string;
  self_reported_status: string;
  desktop_agent: string;
  derived_state: string;
  consults_this_shift: number;
  calls_this_shift: number;
  open_consults: number;
  minutes_to_shift_end: number | null;
  on_roster_shift: boolean;
  role: string;
  routable: boolean;
  busy: boolean;
  ringing_consult: string | null;
  in_cooldown: boolean;
  presence_verified: boolean;
  presence_verification_basis?: string;
  workload_verified?: boolean;
  flags: string[];
  credentials: string[];
  open_consult_ids: string[];
  planned_capacity: {
    hospitals: string[];
    online_at: string;
    end: string;
    offer_id: string;
  } | null;
}

export interface Consult {
  consult_id: string;
  hospital_id: string;
  hospital_name: string;
  physician_id: string;
  consult_type: string;
  current_stage: string;
  stage_entered_at: string;
  minutes_in_stage: number | null;
  minutes_since_received: number | null;
  routing_failures: number;
  ringing_physician: string | null;
  documentation_clock_min: number | null;
  waiting_for_assignment: boolean;
  modeled_reassignment: Action | null;
}

export interface Sample {
  at: string;
  minimum: number;
  trailing_demand: number;
  trailing_observed: number;
  trailing_expected: number;
  p90: number;
  surge_uplift: number;
  required: number;
  roster_ceiling: number;
  available: number;
  available_ids: string[];
  unverified_ids: string[];
  planned_ids: string[];
  deficit: number;
  confirmed_available?: number;
  confirmed_ids?: string[];
  planned_available?: number;
  confirmed_deficit?: number;
}

export interface HospitalProjection {
  hospital_id: string;
  hospital_name: string;
  samples: Sample[];
  deficit_minutes: number;
  peak_deficit: number;
  first_gap_at: string | null;
  spike_now: boolean;
}

export interface RuleResult {
  rule: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface Candidate {
  physician_id: string;
  name: string;
  role: string;
  eligible: boolean;
  rules: RuleResult[];
  failed_rules: string[];
  offer_hospitals: string[];
  minutes_to_online: number;
  online_at: string;
  effective_minutes: number;
  paid_hours: number;
  deficit_minutes_removed?: number;
  rank: number | null;
  selected: boolean;
  outcome?: "eligible" | "ineligible" | "unverified";
  eligibility_status?: "eligible" | "ineligible" | "unverified";
  eligibility?: {
    status: "eligible" | "ineligible" | "unverified";
    missing_evidence: string[];
    policy_version: string;
  };
  policy_version?: string;
  missing_required_evidence?: string[];
}

export interface Staffing {
  target: {
    hospital_id: string;
    hospital_name: string;
    reason: string;
    deficit_minutes: number;
    peak_deficit: number;
    trailing_observed: number;
    p90: number;
  } | null;
  offer_window?: { start: string; end: string; hours: number };
  gap_hospitals?: string[];
  slots?: number;
  candidates: Candidate[];
  selected: string[];
  baseline_deficit_minutes?: number;
  projected_deficit_minutes?: number;
  deficit_minutes_removed?: number;
  residual_peak_deficit?: number;
  objective?: string;
  message: string | null;
}

export interface Offer {
  offer_id: string;
  gap_id: string;
  physician_id: string;
  physician_name: string;
  hospitals: string[];
  hospital_names: string[];
  window_start: string;
  window_end: string;
  minutes_to_online: number;
  status:
    | "proposed"
    | "approved"
    | "rejected"
    | "sent"
    | "accepted"
    | "declined"
    | "expired"
    | "cancelled";
  status_reason: string;
  proposed_by: string;
  proposed_at: string;
  approved_by: string | null;
  sent_at: string | null;
  expires_at: string | null;
  responded_at: string | null;
  online_at: string | null;
  rationale: Record<string, unknown>;
  candidate_audit: Candidate[];
}

export interface Gap {
  gap_id: string;
  hospitals: string[];
  window_start: string;
  window_end: string;
  slots: number;
  status: string;
  claims: { slot: number; offer_id: string; claimed_at: string }[];
}

export interface Action {
  action_id: string;
  kind: "escalation" | "reassignment" | "nudge";
  status: string;
  consult_id: string | null;
  risk_id: string | null;
  target_physician_id: string | null;
  note: string;
  created_by: string;
  created_at: string;
  resolved_by: string | null;
  resolution: string | null;
}

export interface AuditRow {
  seq: number;
  revision: number;
  wall_time: string;
  scenario_time: string;
  actor: string;
  role: string;
  kind: string;
  entity: string;
  detail: Record<string, unknown>;
}

export interface Report {
  as_of: string;
  is_reference_time: boolean;
  counts: {
    events_applied: number;
    events_not_yet_visible: number;
    open_consults: number;
    orphan_events: number;
  };
  risks: Risk[];
  physicians: Physician[];
  consults: Consult[];
  coverage: {
    as_of: string;
    hospitals: HospitalProjection[];
    shift_changes: {
      at: string;
      physician_id: string;
      name: string;
      change: string;
      hospitals: string[];
    }[];
    total_deficit_minutes: number;
  };
  staffing: Staffing;
  routing_trap: {
    rows: {
      hospital_id: string;
      hospital_name: string;
      next_call_unguarded: string | null;
      next_call_guarded: string | null;
    }[];
    joiners: {
      physician_id: string;
      hospitals: string[];
      online_at: string;
      end: string;
    }[];
    guard: string;
    illustration?: {
      physician_id: string;
      offer_hospitals: string[];
      first_in_line_without_guard: string[];
      first_in_line_with_guard: string[];
    };
  };
  verification: {
    applicable: boolean;
    compared: number;
    matched: number;
    mismatches: {
      entity: string;
      field: string;
      expected: string;
      actual: unknown;
    }[];
    passed: boolean;
    original_run: boolean;
    label: string;
  };
  assumptions: string[];
  engine_timing_ms: { replay: number; analysis: number; total: number };
  run: {
    run_id: string;
    label: string;
    revision: number;
    has_imports: boolean;
    created_at: string;
  };
  runs: {
    run_id: string;
    label: string;
    created_at: string;
    revision: number;
    is_current: number;
    has_imports: number;
  }[];
  offers: Offer[];
  gaps: Gap[];
  actions: Action[];
  audit_tail: AuditRow[];
  imports: {
    import_id: string;
    created_at: string;
    actor: string;
    filename: string;
    summary: ImportSummary;
    revision: number;
  }[];
  evidence: {
    release_sha: string;
    schema_version: number;
    source_hashes: Record<string, string>;
    projection_cache_hit: boolean;
    finance: { configured: boolean; note: string };
    partners: Record<string, string>;
  };
}

export interface ImportSummary {
  rows_read?: number;
  accepted?: number;
  duplicates?: number;
  duplicate_ids?: string[];
  errors?: { row: number; event_id: string; error: string }[];
  error_count?: number;
  ok?: boolean;
  header_errors?: string[];
  clock_advanced_to?: string | null;
  not_yet_visible?: number;
  expired_offers?: string[];
}

export interface PhysicianOffer {
  offer_id: string;
  hospital_names: string[];
  start: string;
  end: string;
  hours: number;
  status: Offer["status"];
  status_reason: string;
  sent_at: string | null;
  expires_at: string | null;
  seconds_left_scenario: number | null;
  online_at: string | null;
}

export interface Decision {
  decision_id: string;
  run_id: string;
  revision: number;
  as_of: string;
  policy_version: string;
  status: "ready" | "escalated" | "stale";
  source: "jev" | "deterministic_fallback" | "escalation";
  selected_action_id: string | null;
  selected_physician_ids: string[];
  selected_action: {
    action_id: string;
    kind: string;
    physician_ids: string[];
    offer_hospitals: string[];
    window_start: string;
    window_end: string;
  } | null;
  fallback_reason: string | null;
  model: string | null;
  latency_ms: number;
  confidence: number | null;
  requires_clinical_lead_approval: boolean;
  feasible_actions: Record<string, unknown>[];
  provider: {
    status: string;
    latency_ms: number;
    model: string | null;
    confidence: number | null;
  };
}

export interface ActionLab {
  generated_event_count: number;
  input_hash: string;
  as_of: string;
  observed_metrics: {
    visible_event_count: number;
    unique_consults_with_receipt: number;
    received_to_first_recorded_contact: {
      sample_size: number;
      p50: number | null;
      p95: number | null;
      definition: string;
    };
  };
  policies: {
    policy: string;
    status: string;
    explanation: string;
    actual_source?: string | null;
  }[];
  split_shift_trap: {
    condition: string;
    candidates: {
      physician_id: string;
      naive_hospital_scope: string[];
      guarded_hospital_scope: string[];
      protected_from_unscoped_routing: string[];
    }[];
  };
}
