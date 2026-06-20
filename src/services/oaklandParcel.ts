export type ParcelLookupResult = {
  taxableValue: number
  parcelId?: string
  matchedAddress?: string
}

const API_URL = import.meta.env.VITE_OAKLAND_PARCEL_API_URL as string | undefined

type LooseObject = Record<string, unknown>

type ArcGisCandidate = {
  address?: string
  location?: {
    x?: number
    y?: number
  }
}

function getFirstRecord(payload: unknown): LooseObject | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const maybeObject = payload as LooseObject

  if (
    Array.isArray(maybeObject.data) &&
    maybeObject.data[0] &&
    typeof maybeObject.data[0] === 'object'
  ) {
    return maybeObject.data[0] as LooseObject
  }

  if (
    Array.isArray(maybeObject.results) &&
    maybeObject.results[0] &&
    typeof maybeObject.results[0] === 'object'
  ) {
    return maybeObject.results[0] as LooseObject
  }

  if (
    Array.isArray(maybeObject.features) &&
    maybeObject.features[0] &&
    typeof maybeObject.features[0] === 'object'
  ) {
    const feature = maybeObject.features[0] as LooseObject
    if (feature.attributes && typeof feature.attributes === 'object') {
      return feature.attributes as LooseObject
    }
    return feature
  }

  return maybeObject
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const cleaned = value.replaceAll(',', '').replaceAll('$', '').trim()
    const parsed = Number.parseFloat(cleaned)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function pickValue(record: LooseObject, keys: string[]): string | number | null {
  for (const key of keys) {
    if (
      key in record &&
      (typeof record[key] === 'string' || typeof record[key] === 'number')
    ) {
      return record[key] as string | number
    }
  }
  return null
}

function toUrl(base: string, path: string): URL {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  return new URL(path, normalizedBase)
}

function isArcGisServicesRoot(url: string): boolean {
  return /\/rest\/services\/?$/i.test(url)
}

function isArcGisLayerEndpoint(url: string): boolean {
  return /\/(MapServer|FeatureServer)\/\d+\/?$/i.test(url)
}

function normalizeText(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function splitAddress(address: string): {
  houseNumber: string | null
  streetTokens: string[]
  cityToken: string | null
  normalizedInput: string
} {
  const [streetPart = '', cityPart = ''] = address.split(',')
  const normalizedStreet = normalizeText(streetPart)
  const normalizedCity = normalizeText(cityPart)
  const rawTokens = normalizedStreet.split(' ').filter(Boolean)

  const houseToken = rawTokens.find((token) => /^\d+[A-Z]?$/.test(token))

  const dropTokens = new Set([
    'APT',
    'UNIT',
    'STE',
    'SUITE',
    'FL',
    'FLOOR',
    'MI',
    'MICHIGAN',
    'USA',
  ])

  const streetTokens = rawTokens
    .filter((token) => token !== houseToken)
    .filter((token) => token.length > 1)
    .filter((token) => !dropTokens.has(token))

  const cityToken = normalizedCity ? normalizedCity.split(' ').slice(0, 2).join(' ') : null

  return {
    houseNumber: houseToken ?? null,
    streetTokens: streetTokens.slice(0, 5),
    cityToken,
    normalizedInput: normalizeText(address),
  }
}

function getRecords(payload: unknown): LooseObject[] {
  if (!payload || typeof payload !== 'object') {
    return []
  }

  const source = payload as LooseObject

  if (Array.isArray(source.features)) {
    return source.features
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null
        }
        const maybeFeature = entry as LooseObject
        if (maybeFeature.attributes && typeof maybeFeature.attributes === 'object') {
          return maybeFeature.attributes as LooseObject
        }
        return maybeFeature
      })
      .filter((item): item is LooseObject => item !== null)
  }

  const first = getFirstRecord(payload)
  return first ? [first] : []
}

function buildWhereClause(address: string): string {
  const parts = splitAddress(address)
  const clauses: string[] = []

  if (parts.houseNumber) {
    clauses.push(`UPPER(SITEADDRESS) LIKE '%${parts.houseNumber}%'`)
  }

  for (const token of parts.streetTokens.slice(0, 4)) {
    clauses.push(`UPPER(SITEADDRESS) LIKE '%${token}%'`)
  }

  if (parts.cityToken) {
    clauses.push(`UPPER(SITECITY) LIKE '%${parts.cityToken}%'`)
  }

  if (clauses.length === 0) {
    const fallback = normalizeText(address)
    return `UPPER(SITEADDRESS) LIKE '%${fallback}%'`
  }

  return clauses.join(' AND ')
}

function scoreRecord(record: LooseObject, address: string): number {
  const parts = splitAddress(address)
  const siteAddress = typeof record.SITEADDRESS === 'string' ? normalizeText(record.SITEADDRESS) : ''
  const siteCity = typeof record.SITECITY === 'string' ? normalizeText(record.SITECITY) : ''
  const full = `${siteAddress} ${siteCity}`.trim()

  let score = 0

  if (parts.houseNumber && siteAddress.includes(parts.houseNumber)) {
    score += 40
  }

  for (const token of parts.streetTokens) {
    score += siteAddress.includes(token) ? 10 : -8
  }

  if (parts.cityToken) {
    score += siteCity.includes(parts.cityToken) ? 12 : -6
  }

  if (parts.normalizedInput && full.includes(parts.normalizedInput)) {
    score += 25
  }

  return score
}

async function fetchJson(url: URL): Promise<unknown> {
  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error('Parcel lookup request failed. Please check the API endpoint.')
  }
  return response.json() as Promise<unknown>
}

async function lookupFromArcGisServicesRoot(
  servicesRoot: string,
  address: string,
): Promise<ParcelLookupResult> {
  const geocodeUrl = toUrl(
    servicesRoot,
    'Locators/Oakland_Addresses/GeocodeServer/findAddressCandidates',
  )
  geocodeUrl.searchParams.set('f', 'pjson')
  geocodeUrl.searchParams.set('SingleLine', address)
  geocodeUrl.searchParams.set('maxLocations', '1')

  const geocodePayload = (await fetchJson(geocodeUrl)) as LooseObject
  const candidates = Array.isArray(geocodePayload.candidates)
    ? (geocodePayload.candidates as ArcGisCandidate[])
    : []

  const topMatch = candidates[0]
  if (!topMatch?.location?.x || !topMatch?.location?.y) {
    throw new Error('No parcel match found for that address.')
  }

  const inWkidRaw =
    geocodePayload.spatialReference &&
    typeof geocodePayload.spatialReference === 'object' &&
    'wkid' in geocodePayload.spatialReference
      ? (geocodePayload.spatialReference as LooseObject).wkid
      : 102643

  const inWkid = parseNumber(inWkidRaw) ?? 102643

  const queryUrl = toUrl(servicesRoot, 'GISWebServices/MapServer/5/query')
  queryUrl.searchParams.set('f', 'pjson')
  queryUrl.searchParams.set('geometryType', 'esriGeometryPoint')
  queryUrl.searchParams.set('spatialRel', 'esriSpatialRelIntersects')
  queryUrl.searchParams.set('inSR', String(Math.round(inWkid)))
  queryUrl.searchParams.set('outSR', String(Math.round(inWkid)))
  queryUrl.searchParams.set('returnGeometry', 'false')
  queryUrl.searchParams.set(
    'outFields',
    'APN_GROUND,SITUS_HOUSE_NUMBER_N,SITUS_STREET_NAME,SITUS_CITY,ASSESSED_VALUE,LAND,IMPROVEMENTS',
  )
  queryUrl.searchParams.set(
    'geometry',
    JSON.stringify({
      x: topMatch.location.x,
      y: topMatch.location.y,
      spatialReference: { wkid: Math.round(inWkid) },
    }),
  )

  const parcelPayload = await fetchJson(queryUrl)
  const record = getFirstRecord(parcelPayload)
  if (!record) {
    throw new Error('Address matched, but parcel record was not found.')
  }

  const assessed = parseNumber(record.ASSESSED_VALUE)
  const land = parseNumber(record.LAND)
  const improvements = parseNumber(record.IMPROVEMENTS)

  const taxableValue =
    assessed ?? (land !== null && improvements !== null ? land + improvements : null)

  if (taxableValue === null) {
    throw new Error('Parcel was found, but taxable/assessed value was missing.')
  }

  const houseNumber = parseNumber(record.SITUS_HOUSE_NUMBER_N)
  const street = typeof record.SITUS_STREET_NAME === 'string' ? record.SITUS_STREET_NAME : ''
  const city = typeof record.SITUS_CITY === 'string' ? record.SITUS_CITY : ''
  const computedAddress = [houseNumber ? String(Math.round(houseNumber)) : '', street, city]
    .filter(Boolean)
    .join(' ')

  return {
    taxableValue,
    parcelId:
      typeof record.APN_GROUND === 'string' && record.APN_GROUND
        ? record.APN_GROUND
        : undefined,
    matchedAddress: computedAddress || topMatch.address,
  }
}

async function lookupFromGenericEndpoint(
  endpointUrl: string,
  address: string,
): Promise<ParcelLookupResult> {
  const url = new URL(endpointUrl)
  url.searchParams.set('address', address)

  const payload = await fetchJson(url)
  const record = getFirstRecord(payload)

  if (!record) {
    throw new Error('No parcel record was returned for that address.')
  }

  const taxableValueRaw = pickValue(record, [
    'taxableValue',
    'taxable_value',
    'taxable',
    'TAXABLE_VALUE',
    'TaxableValue',
    'TXBL_VAL',
    'ASSESSED_VALUE',
  ])

  const taxableValue = parseNumber(taxableValueRaw)
  if (taxableValue === null) {
    throw new Error('Parcel record was found, but taxable value was missing.')
  }

  const parcelId = pickValue(record, [
    'parcelId',
    'parcel_id',
    'PIN',
    'PARCEL_ID',
    'sid',
    'APN_GROUND',
  ])

  const matchedAddress = pickValue(record, [
    'matchedAddress',
    'address',
    'siteAddress',
    'SITE_ADDRESS',
    'SITUS_ADDR',
  ])

  return {
    taxableValue,
    parcelId: parcelId ? String(parcelId) : undefined,
    matchedAddress: matchedAddress ? String(matchedAddress) : undefined,
  }
}

async function lookupFromArcGisLayerEndpoint(
  endpointUrl: string,
  address: string,
): Promise<ParcelLookupResult> {
  const queryUrl = new URL(endpointUrl.endsWith('/query') ? endpointUrl : `${endpointUrl}/query`)

  queryUrl.searchParams.set('f', 'pjson')
  queryUrl.searchParams.set('where', buildWhereClause(address))
  queryUrl.searchParams.set(
    'outFields',
    'KEYPIN,PIN,SITEADDRESS,SITECITY,TAXABLEVALUE,ASSESSEDVALUE',
  )
  queryUrl.searchParams.set('returnGeometry', 'false')
  queryUrl.searchParams.set('resultRecordCount', '15')

  const payload = await fetchJson(queryUrl)
  const records = getRecords(payload)
  const record = records
    .map((candidate) => ({ candidate, score: scoreRecord(candidate, address) }))
    .sort((a, b) => b.score - a.score)[0]?.candidate

  if (!record) {
    throw new Error('No parcel record was returned for that address.')
  }

  const taxableValue = parseNumber(record.TAXABLEVALUE) ?? parseNumber(record.ASSESSEDVALUE)
  if (taxableValue === null) {
    throw new Error('Parcel record was found, but taxable value was missing.')
  }

  const city = typeof record.SITECITY === 'string' ? `, ${record.SITECITY}` : ''
  const matchedAddress =
    typeof record.SITEADDRESS === 'string' ? `${record.SITEADDRESS}${city}` : undefined

  const parcelId =
    (typeof record.PIN === 'string' && record.PIN) ||
    (typeof record.KEYPIN === 'string' && record.KEYPIN)

  return {
    taxableValue,
    parcelId: parcelId || undefined,
    matchedAddress,
  }
}

export async function lookupTaxableValueByAddress(
  address: string,
): Promise<ParcelLookupResult> {
  if (!API_URL) {
    throw new Error(
      'Set VITE_OAKLAND_PARCEL_API_URL in a .env file to enable automatic taxable value lookup.',
    )
  }

  if (isArcGisServicesRoot(API_URL)) {
    return lookupFromArcGisServicesRoot(API_URL, address)
  }

  if (isArcGisLayerEndpoint(API_URL)) {
    return lookupFromArcGisLayerEndpoint(API_URL, address)
  }

  return lookupFromGenericEndpoint(API_URL, address)
}