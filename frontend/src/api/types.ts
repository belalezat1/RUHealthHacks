export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'gray';
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export interface Signal { id: string; physician_id: string; source: string; kind: string; value: string; observed_at: string; received_at: string; }
export interface Availability { status: string; connected: boolean; stale: boolean; conflicts: (string | Record<string, unknown>)[]; workload: number; on_shift: boolean; signals: Signal[]; }
export interface Credential { id: string; physician_id: string; kind: string; jurisdiction?: string; hospital_id?: string; expires_at: string; }
export interface Shift { id: string; physician_id: string; hospital_id: string; start_at: string; end_at: string; status: string; mandatory: boolean; }
export interface Physician { id: string; name: string; specialties: string[]; max_concurrent: number; metadata?: Record<string, unknown>; availability: Availability; credentials?: Credential[]; shifts?: Shift[]; }
export interface Hospital { id: string; name: string; jurisdiction: string; timezone: string; specialty: string; minimum_coverage: number; arrival_work_minutes_per_bin: number; }
export interface Consultation { id: string; hospital_id: string; specialty: string; priority: string; requested_at: string; deadline_at: string; duration_minutes: number; status: string; physician_id?: string; }
export interface Rule { code: string; status: 'pass' | 'fail' | 'unknown'; observed: unknown; required: unknown; source: string; observed_at: string | null; explanation: string; }
export interface Eligibility { physician_id: string; outcome: string; action: string; rules: Rule[]; }
export interface HospitalBin { hospital_id: string; demand_minutes: number; capacity_minutes: number; unmet_minutes: number; severity: string; reason: string; }
export interface ForecastBin { start_at: string; end_at: string; demand_minutes: number; capacity_minutes: number; unmet_minutes: number; hospitals: HospitalBin[]; }
export interface Risk { id?: string; hospital_id: string; severity: string; reason?: string; explanation?: string; start_at?: string; end_at?: string; unmet_minutes?: number; [key: string]: unknown; }
export interface Forecast { intervals: ForecastBin[]; risks: Risk[]; assumptions: (string | Record<string, unknown>)[]; as_of: string; valid_until: string; }
export interface Candidate { physician_id: string; consultation_id: string; hospital_id: string; action: string; start_at: string; end_at: string; score: number; eligibility: Eligibility; expected_effect: Record<string, unknown>; explanation: string | string[]; }
export interface Rejected { physician_id: string; eligibility?: Eligibility; rules?: Rule[]; reason?: string; explanation?: string | string[]; [key: string]: unknown; }
export interface Recommendation { id: string; status: string; workflow_version: number; source_version: number; expires_at: string; candidate: Candidate; alternatives: Candidate[]; rejected: Rejected[]; solver: Record<string, unknown>; assumptions: (string | Record<string, unknown>)[]; advisory?: Record<string, unknown>; [key: string]: unknown; }
export interface Dashboard { dataset_id: string | null; source_version: number; as_of: string; valid_until: string; synthetic: boolean; counts: { physicians: number; consultations: number; waiting: number; assigned: number; at_risk_hospitals: number; pending_interventions: number }; physicians: Physician[]; consultations: Consultation[]; hospitals: Hospital[]; forecast: Forecast; recommendations: Recommendation[]; jev: { mode: string; status: string; model: string }; freshness: { stale: number | boolean; conflicts: number | boolean }; }
export interface Dataset { schema_version: 'synthetic_v1'; dataset_id: string; label: string; synthetic: true; as_of: string; hospitals: Hospital[]; physicians: Omit<Physician, 'availability'>[]; credentials: Credential[]; shifts: Shift[]; signals: Signal[]; consultations: Consultation[]; }
export interface Validation { valid: boolean; errors: { path: string; field: string; reason: string }[]; counts?: Record<string, number>; }
export interface DatasetExample { id: string; label: string; dataset: Dataset; }
export interface EventInput { dataset_id: string; source: string; event_id: string; event_type: string; entity_id: string; observed_at: string; source_sequence?: number; payload: Record<string, unknown>; }
export interface Audit { id: string; actor: string; role: string; action: string; entity_id: string; before: unknown; after: unknown; reason: string; created_at: string; }
export interface Scenario { id: string; label: string; description: string; }
export interface Simulation { id: string; baseline: Record<string, number>; optimized: Record<string, number>; trace: Record<string, unknown>[]; metadata: Record<string, unknown>; }
