import { describe, expect, it } from 'vitest'
import { buildOperationalWriteRequest, RunRequestScope } from './api'

describe('operational write safety', () => {
  it('includes displayed run context and required headers', () => {
    const request = buildOperationalWriteRequest({
      endpoint: '/not-sent-in-unit-test',
      method: 'POST',
      context: { expected_run_id: 'run-42', expected_revision: 7 },
      payload: { offer_id: 'offer-1' },
      csrfToken: 'csrf-value',
      csrfHeaderName: 'X-CSRF-Token',
      idempotencyKey: 'retry-key-1',
    })

    expect(request.headers).toMatchObject({
      'Idempotency-Key': 'retry-key-1',
      'X-CSRF-Token': 'csrf-value',
    })
    expect(JSON.parse(String(request.body))).toMatchObject({
      expected_run_id: 'run-42',
      expected_revision: 7,
      offer_id: 'offer-1',
    })
  })

  it('refuses operational writes without complete context or CSRF configuration', () => {
    expect(() => buildOperationalWriteRequest({
      endpoint: '/not-sent-in-unit-test',
      method: 'POST',
      context: { expected_run_id: '', expected_revision: 7 },
      payload: {},
      csrfToken: 'csrf-value',
      csrfHeaderName: 'X-CSRF-Token',
      idempotencyKey: 'retry-key-1',
    })).toThrow(/run ID and revision/)
  })

  it('aborts pending run-scoped work when a new run starts', () => {
    const scope = new RunRequestScope()
    const signal = scope.createSignal()
    scope.discardPending()
    expect(signal.aborted).toBe(true)
  })
})