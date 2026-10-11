export const promptFixture = {
  version: 'prompt-derived-v1',
  mode: 'mock' as const,
  originalScenarioClock: '18:20',
  sourceMatchCount: 208,
  hospital: 'Suncrest',
  consultCount: 5,
  recommendedPhysician: 'Grace',
  candidates: Array.from({ length: 6 }, (_, index) => ({
    id: `candidate-slot-${index + 1}`,
    label: `Candidate explanation ${index + 1}`,
    eligibility: 'unverified' as const,
    explanation: 'Candidate-specific source explanation was not included in the supplied material.',
  })),
} as const

export type MockWorkflowState =
  | 'idle'
  | 'proposal-preview'
  | 'lead-approved-preview'
  | 'sent-simulation-preview'
  | 'accepted-simulation-preview'
  | 'declined-simulation-preview'
  | 'cancelled-preview'
  | 'expired-preview'

export type HistoryItem = {
  runId: string
  state: MockWorkflowState
  label: string
  time: string
}