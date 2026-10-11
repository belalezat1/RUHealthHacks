export type RunContext = {
  expected_run_id: string
  expected_revision: string | number
}

export type OperationalReport = {
  run_id: string
  revision: string | number
  scenario_clock: string
  generated_at: string
  consults: Array<{
    id: string
    hospital: string
    delay_minutes?: number
    priority?: string
    status: string
  }>
  candidates: Array<{
    id: string
    display_name: string
    eligibility: 'eligible' | 'ineligible' | 'unverified'
    explanation: string
    routable?: boolean
    planned_capacity_after_eta?: number
  }>
  coverage: Array<{
    minute: number
    available?: number
    required?: number
    gap?: number
  }>
  recommendation?: {
    candidate_id: string
    issue_id: string
    explanation: string
  }
}

export type OperationalWrite = RunContext & Record<string, unknown>