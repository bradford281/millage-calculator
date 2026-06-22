import { beforeEach, describe, expect, it, vi } from 'vitest'

type MockJson = Record<string, unknown>

function createResponse(payload: MockJson, ok = true): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response
}

describe('usageMetrics service', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('does not send telemetry when endpoint is missing', async () => {
    vi.stubEnv('VITE_USAGE_METRICS_ENDPOINT', '')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { trackEstimateCalculated } = await import('../src/services/usageMetrics')

    trackEstimateCalculated({ hasMatchedAddress: true, hasParcelId: false })

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sends telemetry payload when endpoint exists', async () => {
    vi.stubEnv('VITE_USAGE_METRICS_ENDPOINT', 'https://metrics.example/api')
    const fetchSpy = vi.fn().mockResolvedValue(createResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchSpy)

    const { trackEstimateCalculated } = await import('../src/services/usageMetrics')

    trackEstimateCalculated({ hasMatchedAddress: true, hasParcelId: true })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://metrics.example/api')
    expect(options.method).toBe('POST')
    expect(options.keepalive).toBe(true)

    const body = JSON.parse(String(options.body)) as {
      event: string
      hasMatchedAddress: boolean
      hasParcelId: boolean
      at: string
    }

    expect(body.event).toBe('estimate_calculated')
    expect(body.hasMatchedAddress).toBe(true)
    expect(body.hasParcelId).toBe(true)
    expect(typeof body.at).toBe('string')
  })

  it('swallows telemetry errors', async () => {
    vi.stubEnv('VITE_USAGE_METRICS_ENDPOINT', 'https://metrics.example/api')
    const fetchSpy = vi.fn().mockRejectedValue(new Error('network'))
    vi.stubGlobal('fetch', fetchSpy)

    const { trackEstimateCalculated } = await import('../src/services/usageMetrics')

    expect(() =>
      trackEstimateCalculated({ hasMatchedAddress: false, hasParcelId: false }),
    ).not.toThrow()
  })

  it('returns null when usage endpoint is missing', async () => {
    vi.stubEnv('VITE_USAGE_METRICS_ENDPOINT', '')
    vi.stubGlobal('fetch', vi.fn())

    const { fetchEstimateUsageCount } = await import('../src/services/usageMetrics')

    await expect(fetchEstimateUsageCount()).resolves.toBeNull()
  })

  it('returns null when fetch response is not ok', async () => {
    vi.stubEnv('VITE_USAGE_METRICS_ENDPOINT', 'https://metrics.example/api')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createResponse({}, false)))

    const { fetchEstimateUsageCount } = await import('../src/services/usageMetrics')

    await expect(fetchEstimateUsageCount()).resolves.toBeNull()
  })

  it('returns null for invalid response payload', async () => {
    vi.stubEnv('VITE_USAGE_METRICS_ENDPOINT', 'https://metrics.example/api')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createResponse({ todayCount: 2 })))

    const { fetchEstimateUsageCount } = await import('../src/services/usageMetrics')

    await expect(fetchEstimateUsageCount()).resolves.toBeNull()
  })

  it('returns usage counts for valid payloads', async () => {
    vi.stubEnv('VITE_USAGE_METRICS_ENDPOINT', 'https://metrics.example/api')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(createResponse({ todayCount: 3, allTimeCount: 10 })),
    )

    const { fetchEstimateUsageCount } = await import('../src/services/usageMetrics')

    await expect(fetchEstimateUsageCount()).resolves.toEqual({
      todayCount: 3,
      allTimeCount: 10,
    })
  })

  it('returns null when fetch throws', async () => {
    vi.stubEnv('VITE_USAGE_METRICS_ENDPOINT', 'https://metrics.example/api')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))

    const { fetchEstimateUsageCount } = await import('../src/services/usageMetrics')

    await expect(fetchEstimateUsageCount()).resolves.toBeNull()
  })
})
