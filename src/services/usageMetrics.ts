const usageMetricsEndpoint = import.meta.env.VITE_USAGE_METRICS_ENDPOINT?.trim()

type UsageCountResponse = {
  todayCount?: number
}

export function trackEstimateCalculated(eventDetails: {
  hasMatchedAddress: boolean
  hasParcelId: boolean
}): void {
  if (!usageMetricsEndpoint) {
    return
  }

  const payload = {
    event: 'estimate_calculated',
    at: new Date().toISOString(),
    hasMatchedAddress: eventDetails.hasMatchedAddress,
    hasParcelId: eventDetails.hasParcelId,
  }

  // Fire-and-forget: usage metrics must never block the user flow.
  void fetch(usageMetricsEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    // Ignore telemetry errors to avoid user-visible failures.
  })
}

export async function fetchEstimateUsageCount(): Promise<number | null> {
  if (!usageMetricsEndpoint) {
    return null
  }

  try {
    const response = await fetch(usageMetricsEndpoint, {
      method: 'GET',
      cache: 'no-store',
    })

    if (!response.ok) {
      return null
    }

    const payload = (await response.json()) as UsageCountResponse
    if (typeof payload.todayCount !== 'number') {
      return null
    }

    return payload.todayCount
  } catch {
    return null
  }
}
