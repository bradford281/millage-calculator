import { beforeEach, describe, expect, it, vi } from 'vitest'

function createResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response
}

describe('oaklandParcel service', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('throws when API url is not configured', async () => {
    vi.stubEnv('VITE_OAKLAND_PARCEL_API_URL', '')
    const { lookupTaxableValueByAddress } = await import('../src/services/oaklandParcel')

    await expect(lookupTaxableValueByAddress('1 Main St')).rejects.toThrow(
      /VITE_OAKLAND_PARCEL_API_URL/,
    )
  })

  it('returns empty suggestions for short input', async () => {
    vi.stubEnv('VITE_OAKLAND_PARCEL_API_URL', 'https://example.com/rest/services')
    vi.stubGlobal('fetch', vi.fn())
    const { suggestPropertyAddresses } = await import('../src/services/oaklandParcel')

    await expect(suggestPropertyAddresses('12')).resolves.toEqual([])
  })

  it('looks up taxable value from a generic endpoint', async () => {
    vi.stubEnv('VITE_OAKLAND_PARCEL_API_URL', 'https://example.com/parcel')

    const fetchSpy = vi.fn().mockResolvedValue(
      createResponse({
        data: [
          {
            taxable_value: '123,456.78',
            parcel_id: 987654,
            address: '123 Main St, Hazel Park',
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    const { lookupTaxableValueByAddress } = await import('../src/services/oaklandParcel')
    const result = await lookupTaxableValueByAddress('123 Main St, Hazel Park')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      taxableValue: 123456.78,
      parcelId: '987654',
      matchedAddress: '123 Main St, Hazel Park',
    })
  })

  it('throws when generic endpoint has no parcel record', async () => {
    vi.stubEnv('VITE_OAKLAND_PARCEL_API_URL', 'https://example.com/parcel')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createResponse(null)))

    const { lookupTaxableValueByAddress } = await import('../src/services/oaklandParcel')

    await expect(lookupTaxableValueByAddress('404 Missing')).rejects.toThrow(
      /No parcel record was returned/,
    )
  })

  it('suggests and de-duplicates addresses from ArcGIS services root', async () => {
    vi.stubEnv('VITE_OAKLAND_PARCEL_API_URL', 'https://example.com/rest/services')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        createResponse({
          candidates: [
            { address: '123 Main St, Hazel Park' },
            { address: '123 Main St, Hazel Park' },
            { address: '125 Main St, Hazel Park' },
          ],
        }),
      ),
    )

    const { suggestPropertyAddresses } = await import('../src/services/oaklandParcel')
    const suggestions = await suggestPropertyAddresses('123 main')

    expect(suggestions).toEqual(['123 Main St, Hazel Park', '125 Main St, Hazel Park'])
  })

  it('looks up taxable value from ArcGIS layer endpoint', async () => {
    vi.stubEnv('VITE_OAKLAND_PARCEL_API_URL', 'https://example.com/FeatureServer/2')
    vi.stubEnv('VITE_GOOGLE_GEOCODING_API_KEY', '')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        createResponse({
          features: [
            {
              attributes: {
                TAXABLEVALUE: '210000',
                SITEADDRESS: '500 Oak Ave',
                SITECITY: 'Hazel Park',
                PIN: '63-25-123-456',
              },
            },
          ],
        }),
      ),
    )

    const { lookupTaxableValueByAddress } = await import('../src/services/oaklandParcel')
    const result = await lookupTaxableValueByAddress('500 Oak Ave, Hazel Park')

    expect(result).toEqual({
      taxableValue: 210000,
      parcelId: '63-25-123-456',
      matchedAddress: '500 Oak Ave, Hazel Park',
    })
  })

  it('looks up from ArcGIS services root using assessed fallback', async () => {
    vi.stubEnv('VITE_OAKLAND_PARCEL_API_URL', 'https://example.com/rest/services')

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        createResponse({
          candidates: [
            {
              address: '42 Elm St, Hazel Park',
              location: { x: -83.1, y: 42.4 },
            },
          ],
          spatialReference: { wkid: 102643 },
        }),
      )
      .mockResolvedValueOnce(
        createResponse({
          data: [
            {
              APN_GROUND: 'parcel-1',
              LAND: '100000',
              IMPROVEMENTS: '50000',
              SITUS_HOUSE_NUMBER_N: '42',
              SITUS_STREET_NAME: 'Elm St',
              SITUS_CITY: 'Hazel Park',
            },
          ],
        }),
      )

    vi.stubGlobal('fetch', fetchSpy)

    const { lookupTaxableValueByAddress } = await import('../src/services/oaklandParcel')
    const result = await lookupTaxableValueByAddress('42 Elm St, Hazel Park')

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      taxableValue: 150000,
      parcelId: 'parcel-1',
      matchedAddress: '42 Elm St Hazel Park',
    })
  })
})
