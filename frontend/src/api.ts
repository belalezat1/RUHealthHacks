import type { OperationalWrite, RunContext } from './types'

export type WriteRequirements = {
  endpoint: string
  method: 'POST' | 'PATCH' | 'DELETE'
  context: RunContext
  payload: Record<string, unknown>
  csrfToken: string
  csrfHeaderName: string
  idempotencyKey: string
}

export function buildOperationalWriteRequest(input: WriteRequirements): RequestInit {
  if (!input.context.expected_run_id || input.context.expected_revision === undefined) {
    throw new Error('Operational writes require the displayed run ID and revision.')
  }
  if (!input.csrfToken || !input.csrfHeaderName || !input.idempotencyKey) {
    throw new Error('Operational writes require contract-configured CSRF and idempotency values.')
  }

  const body: OperationalWrite = {
    ...input.payload,
    expected_run_id: input.context.expected_run_id,
    expected_revision: input.context.expected_revision,
  }

  return {
    method: input.method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
      [input.csrfHeaderName]: input.csrfToken,
    },
    body: JSON.stringify(body),
  }
}

export class RunRequestScope {
  private controllers = new Set<AbortController>()

  createSignal(): AbortSignal {
    const controller = new AbortController()
    this.controllers.add(controller)
    controller.signal.addEventListener('abort', () => this.controllers.delete(controller), { once: true })
    return controller.signal
  }

  discardPending(): void {
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
  }
}