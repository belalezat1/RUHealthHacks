import type { components } from "./generated";

// The OpenAPI envelope is authoritative. Domain overlays narrow flexible JSON dictionaries.
type Schemas = components["schemas"];

export type Tone = "green" | "amber" | "red" | "blue" | "gray";
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export interface Signal {
  id: string;
  physician_id: string;
  source: string;
  kind: string;
  value: string;
  observed_at: string;
  received_at: string;
}
export interface Availability {
  status: string;
  connected: boolean;
  stale: boolean;
  conflicts: (string | Record<string, unknown>)[];
  workload: number;
  on_shift: boolean;
  signals: Signal[];
}
export interface Credential {
  id: string;
  physician_id: string;
  kind: string;
  jurisdiction?: string;
  hospital_id?: string;
  expires_at: string | null;
}
export interface Shift {
  id: string;
  physician_id: string;
  hospital_id: string;
  start_at: string;
  end_at: string;
  status: string;
  mandatory: boolean;
}
export interface Physician {
  id: string;
  name: string;
  specialties: string[];
  max_concurrent: number;
  metadata?: Record<string, unknown>;
  availability: Availability;
  credentials?: Credential[];
  shifts?: Shift[];
}
export interface Hospital {
  id: string;
  name: string;
  jurisdiction: string;
  timezone: string;
  specialty: string;
  minimum_coverage: number;
  arrival_work_minutes_per_bin: number;
}
export interface Consultation {
  id: string;
  hospital_id: string;
  specialty: string;
  priority: string;
  requested_at: string;
  deadline_at: string;
  duration_minutes: number;
  status: string;
  physician_id?: string | null;
}
export type Rule = Schemas["Rule"];
export type Eligibility = Schemas["Eligibility"];
export type HospitalBin = Schemas["HospitalInterval"];
export type ForecastBin = Schemas["Interval"];
export type EventResult = Schemas["EventResult"];
export type EventPage = Schemas["EventPage"];
export type ImportResult = Schemas["ImportResult"];
export type PreviewMethod = Schemas["PreviewRequest"]["method"];
export type DecisionAction =
  | "approve"
  | "reject"
  | "physician-response"
  | "commit"
  | "verify";
export interface Risk {
  id?: string;
  hospital_id: string;
  severity: string;
  reason?: string;
  explanation?: string;
  start_at?: string;
  end_at?: string;
  unmet_minutes?: number;
  [key: string]: unknown;
}
export type Forecast = Omit<Schemas["Forecast"], "risks"> & { risks: Risk[] };
export interface Candidate {
  physician_id: string;
  consultation_id: string;
  hospital_id: string;
  action: string;
  start_at: string;
  end_at: string;
  score: number;
  eligibility: Eligibility;
  expected_effect: Record<string, unknown>;
  explanation: string | string[];
}
export interface Rejected {
  physician_id: string;
  eligibility?: Eligibility;
  rules?: Rule[];
  reason?: string;
  explanation?: string | string[];
  [key: string]: unknown;
}
export type Recommendation = Omit<
  Schemas["RecommendationResponse"],
  "candidate" | "alternatives" | "rejected"
> & {
  candidate: Candidate;
  alternatives: Candidate[];
  rejected: Rejected[];
};
export type Dashboard = Omit<
  Schemas["Dashboard"],
  | "physicians"
  | "consultations"
  | "hospitals"
  | "forecast"
  | "recommendations"
  | "jev"
  | "freshness"
> & {
  physicians: Physician[];
  consultations: Consultation[];
  hospitals: Hospital[];
  forecast: Forecast;
  recommendations: Recommendation[];
  jev: { mode: string; status: string; model: string };
  freshness: { stale: number | boolean; conflicts: number | boolean };
};
export interface Dataset {
  schema_version: "synthetic_v1";
  dataset_id: string;
  label: string;
  synthetic: true;
  as_of: string;
  hospitals: Hospital[];
  physicians: Omit<Physician, "availability">[];
  credentials: Credential[];
  shifts: Shift[];
  signals: Signal[];
  consultations: Consultation[];
}
export type Validation = Schemas["ValidationReport"];
export interface DatasetExample {
  id: string;
  label: string;
  dataset: Dataset;
}
export type EventInput = Schemas["Event"];
export interface Audit {
  id: string;
  actor: string;
  role: string;
  action: string;
  entity_id: string;
  before: unknown;
  after: unknown;
  reason: string;
  created_at: string;
}
export interface Scenario {
  id: string;
  label: string;
  description: string;
}
export type Simulation = Omit<
  Schemas["SimulationResponse"],
  "baseline" | "optimized"
> & {
  baseline: Record<string, number>;
  optimized: Record<string, number>;
};
