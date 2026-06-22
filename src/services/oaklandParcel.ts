export type ParcelLookupResult = {
  taxableValue: number
  parcelId?: string
  matchedAddress?: string
}

const API_URL = import.meta.env.VITE_OAKLAND_PARCEL_API_URL as string | undefined
const GOOGLE_GEOCODING_API_KEY = import.meta.env.VITE_GOOGLE_GEOCODING_API_KEY as
  | string
  | undefined
const GOOGLE_GEOCODING_REGION = (import.meta.env.VITE_GOOGLE_GEOCODING_REGION as
  | string
  | undefined) ?? 'us'

type LooseObject = Record<string, unknown>
type GeoPoint = { lat: number; lng: number }

type ArcGisCandidate = {
  address?: string
  location?: {
    x?: number
    y?: number
  }
}

type GoogleGeocodeResolution = {
  formattedAddress?: string
  location?: GeoPoint
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
    const value = record[key]
    if (typeof value === 'string' || typeof value === 'number') {
      return value
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

const tokenVariants: Record<string, string[]> = {
  N: ['N', 'NORTH'],
  S: ['S', 'SOUTH'],
  E: ['E', 'EAST'],
  W: ['W', 'WEST'],
  ST: ['ST', 'STREET'],
  RD: ['RD', 'ROAD'],
  AVE: ['AVE', 'AVENUE'],
  BLVD: ['BLVD', 'BOULEVARD'],
  DR: ['DR', 'DRIVE'],
  CT: ['CT', 'COURT'],
  LN: ['LN', 'LANE'],
  CIR: ['CIR', 'CIRCLE'],
  PKWY: ['PKWY', 'PARKWAY'],
  HWY: ['HWY', 'HIGHWAY'],
}

function escapeSqlLike(value: string): string {
  return value.replaceAll("'", "''")
}

function getTokenAlternates(token: string): string[] {
  const direct = tokenVariants[token]
  if (direct) {
    return direct
  }

  const mapped = Object.entries(tokenVariants).find(([, variants]) => variants.includes(token))
  if (mapped) {
    return mapped[1]
  }

  return [token]
}

function buildTokenClause(field: string, token: string): string {
  const variants = [...new Set(getTokenAlternates(token).map(escapeSqlLike))]
  if (variants.length === 1) {
    return `UPPER(${field}) LIKE '%${variants[0]}%'`
  }

  const variantClauses = variants.map((variant) => `UPPER(${field}) LIKE '%${variant}%'`)
  return `(${variantClauses.join(' OR ')})`
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

function buildWhereClauses(address: string): string[] {
  const parts = splitAddress(address)
  const cityClause = parts.cityToken
    ? buildTokenClause('SITECITY', escapeSqlLike(parts.cityToken))
    : null

  const houseClause = parts.houseNumber
    ? `UPPER(SITEADDRESS) LIKE '%${escapeSqlLike(parts.houseNumber)}%'`
    : null

  const streetClauses = parts.streetTokens.slice(0, 4).map((token) => buildTokenClause('SITEADDRESS', token))

  const strictClauses = [houseClause, ...streetClauses, cityClause].filter(
    (value): value is string => Boolean(value),
  )
  const mediumClauses = [houseClause, ...streetClauses.slice(0, 2), cityClause].filter(
    (value): value is string => Boolean(value),
  )
  const looseStreetClause = streetClauses.length > 0 ? `(${streetClauses.join(' OR ')})` : null
  const looseClauses = [houseClause, looseStreetClause].filter(
    (value): value is string => Boolean(value),
  )

  const fallback = normalizeText(address)
  const fallbackClause = fallback
    ? `UPPER(SITEADDRESS) LIKE '%${escapeSqlLike(fallback)}%'`
    : null

  const queries = [
    strictClauses.length > 0 ? strictClauses.join(' AND ') : null,
    mediumClauses.length > 0 ? mediumClauses.join(' AND ') : null,
    looseClauses.length > 0 ? looseClauses.join(' AND ') : null,
    fallbackClause,
  ].filter((value): value is string => Boolean(value))

  return [...new Set(queries)]
}

function buildSuggestionWhereClause(addressInput: string): string {
  const normalized = normalizeText(addressInput)
  const tokens = normalized.split(' ').filter((token) => token.length > 1).slice(0, 5)

  if (tokens.length === 0) {
    return '1=0'
  }

  return tokens
    .map((token) => `UPPER(SITEADDRESS) LIKE '%${escapeSqlLike(token)}%'`)
    .join(' AND ')
}

function dedupeAddressList(addresses: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []

  for (const address of addresses) {
    const normalized = normalizeText(address)
    if (!normalized || seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    output.push(address)
  }

  return output
}

async function queryArcGisLayer(endpointUrl: string, whereClause: string): Promise<LooseObject[]> {
  const queryUrl = new URL(endpointUrl.endsWith('/query') ? endpointUrl : `${endpointUrl}/query`)

  queryUrl.searchParams.set('f', 'pjson')
  queryUrl.searchParams.set('where', whereClause)
  queryUrl.searchParams.set(
    'outFields',
    'KEYPIN,PIN,SITEADDRESS,SITECITY,TAXABLEVALUE,ASSESSEDVALUE',
  )
  queryUrl.searchParams.set('returnGeometry', 'false')
  queryUrl.searchParams.set('resultRecordCount', '25')

  const payload = await fetchJson(queryUrl)
  return getRecords(payload)
}

async function suggestFromArcGisServicesRoot(
  servicesRoot: string,
  addressInput: string,
): Promise<string[]> {
  const geocodeUrl = toUrl(
    servicesRoot,
    'Locators/Oakland_Addresses/GeocodeServer/findAddressCandidates',
  )
  geocodeUrl.searchParams.set('f', 'pjson')
  geocodeUrl.searchParams.set('SingleLine', addressInput)
  geocodeUrl.searchParams.set('maxLocations', '8')

  const payload = (await fetchJson(geocodeUrl)) as LooseObject
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : []

  const suggestions = candidates
    .map((candidate) => {
      if (!candidate || typeof candidate !== 'object') {
        return null
      }

      const maybeCandidate = candidate as LooseObject
      return typeof maybeCandidate.address === 'string' ? maybeCandidate.address : null
    })
    .filter((address): address is string => Boolean(address))

  return dedupeAddressList(suggestions).slice(0, 8)
}

async function suggestFromArcGisLayerEndpoint(
  endpointUrl: string,
  addressInput: string,
): Promise<string[]> {
  const queryUrl = new URL(endpointUrl.endsWith('/query') ? endpointUrl : `${endpointUrl}/query`)

  queryUrl.searchParams.set('f', 'pjson')
  queryUrl.searchParams.set('where', buildSuggestionWhereClause(addressInput))
  queryUrl.searchParams.set('outFields', 'SITEADDRESS,SITECITY')
  queryUrl.searchParams.set('returnGeometry', 'false')
  queryUrl.searchParams.set('resultRecordCount', '12')

  const payload = await fetchJson(queryUrl)
  const records = getRecords(payload)

  const suggestions = records
    .map((record) => {
      const siteAddress = typeof record.SITEADDRESS === 'string' ? record.SITEADDRESS.trim() : ''
      const siteCity = typeof record.SITECITY === 'string' ? record.SITECITY.trim() : ''

      if (!siteAddress) {
        return null
      }

      return siteCity ? `${siteAddress}, ${siteCity}` : siteAddress
    })
    .filter((address): address is string => Boolean(address))

  return dedupeAddressList(suggestions).slice(0, 8)
}

async function queryArcGisLayerByPoint(endpointUrl: string, point: GeoPoint): Promise<LooseObject[]> {
  const queryUrl = new URL(endpointUrl.endsWith('/query') ? endpointUrl : `${endpointUrl}/query`)

  queryUrl.searchParams.set('f', 'pjson')
  queryUrl.searchParams.set('geometryType', 'esriGeometryPoint')
  queryUrl.searchParams.set('spatialRel', 'esriSpatialRelIntersects')
  queryUrl.searchParams.set('inSR', '4326')
  queryUrl.searchParams.set('outSR', '4326')
  queryUrl.searchParams.set('returnGeometry', 'false')
  queryUrl.searchParams.set(
    'outFields',
    'KEYPIN,PIN,SITEADDRESS,SITECITY,TAXABLEVALUE,ASSESSEDVALUE',
  )
  queryUrl.searchParams.set('resultRecordCount', '25')
  queryUrl.searchParams.set(
    'geometry',
    JSON.stringify({
      x: point.lng,
      y: point.lat,
      spatialReference: { wkid: 4326 },
    }),
  )

  const payload = await fetchJson(queryUrl)
  return getRecords(payload)
}

async function fetchRecordsFromSearchAddresses(
  endpointUrl: string,
  searchAddresses: string[],
): Promise<LooseObject[]> {
  for (const searchAddress of searchAddresses) {
    const whereClauses = buildWhereClauses(searchAddress)

    for (const whereClause of whereClauses) {
      const records = await queryArcGisLayer(endpointUrl, whereClause)
      if (records.length > 0) {
        return records
      }
    }
  }

  return []
}

function scoreTokenMatch(siteAddress: string, token: string): number {
  const alternates = getTokenAlternates(token)
  return alternates.some((candidate) => siteAddress.includes(candidate)) ? 10 : -6
}

function scoreRecord(record: LooseObject, address: string): number {
  const parts = splitAddress(address)
  const siteAddress = typeof record.SITEADDRESS === 'string' ? normalizeText(record.SITEADDRESS) : ''
  const siteCity = typeof record.SITECITY === 'string' ? normalizeText(record.SITECITY) : ''
  const full = `${siteAddress} ${siteCity}`.trim()

  let score = 0

  if (parts.houseNumber) {
    score += siteAddress.includes(parts.houseNumber) ? 45 : -25
  }

  for (const token of parts.streetTokens) {
    score += scoreTokenMatch(siteAddress, token)
  }

  if (parts.cityToken) {
    score += siteCity.includes(parts.cityToken) ? 12 : -4
  }

  if (parts.normalizedInput && full.includes(parts.normalizedInput)) {
    score += 25
  }

  return score
}

function chooseBestRecord(records: LooseObject[], preferredAddress: string): LooseObject | null {
  return (
    records
      .map((candidate) => ({ candidate, score: scoreRecord(candidate, preferredAddress) }))
      .sort((a, b) => b.score - a.score)[0]?.candidate ?? null
  )
}

function mapArcGisRecordToResult(record: LooseObject): ParcelLookupResult {
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

async function fetchJson(url: URL): Promise<unknown> {
  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error('Parcel lookup request failed. Please check the API endpoint.')
  }
  return response.json() as Promise<unknown>
}

async function resolveAddressWithGoogle(address: string): Promise<GoogleGeocodeResolution | null> {
  if (!GOOGLE_GEOCODING_API_KEY) {
    return null
  }

  const geocodeUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  geocodeUrl.searchParams.set('address', address)
  geocodeUrl.searchParams.set('components', 'country:US|administrative_area:MI')
  geocodeUrl.searchParams.set('region', GOOGLE_GEOCODING_REGION)
  geocodeUrl.searchParams.set('key', GOOGLE_GEOCODING_API_KEY)

  try {
    const payload = (await fetchJson(geocodeUrl)) as LooseObject
    if (payload.status !== 'OK' || !Array.isArray(payload.results) || payload.results.length === 0) {
      return null
    }

    const topResult = payload.results[0] as LooseObject
    const formattedAddress =
      typeof topResult.formatted_address === 'string' ? topResult.formatted_address : undefined

    const geometryObject =
      topResult.geometry && typeof topResult.geometry === 'object'
        ? (topResult.geometry as LooseObject)
        : null
    const locationObject =
      geometryObject?.location && typeof geometryObject.location === 'object'
        ? (geometryObject.location as LooseObject)
        : null

    const lat = locationObject ? parseNumber(locationObject.lat) : null
    const lng = locationObject ? parseNumber(locationObject.lng) : null

    return {
      formattedAddress,
      location:
        lat !== null && lng !== null
          ? {
              lat,
              lng,
            }
          : undefined,
    }
  } catch {
    return null
  }
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
  const googleResolution = await resolveAddressWithGoogle(address)
  const preferredAddress = googleResolution?.formattedAddress ?? address
  const searchAddresses = preferredAddress === address ? [address] : [preferredAddress, address]

  const records = googleResolution?.location
    ? await queryArcGisLayerByPoint(endpointUrl, googleResolution.location)
    : await fetchRecordsFromSearchAddresses(endpointUrl, searchAddresses)

  const resolvedRecords =
    records.length > 0 ? records : await fetchRecordsFromSearchAddresses(endpointUrl, searchAddresses)
  const record = chooseBestRecord(resolvedRecords, preferredAddress)

  if (!record) {
    throw new Error('No parcel record was returned for that address.')
  }

  return mapArcGisRecordToResult(record)
}

export async function suggestPropertyAddresses(addressInput: string): Promise<string[]> {
  const trimmedInput = addressInput.trim()

  if (!API_URL || trimmedInput.length < 3) {
    return []
  }

  const suggestions: string[] = []

  const shouldUseGoogleSuggestion =
    Boolean(GOOGLE_GEOCODING_API_KEY) && /\d/.test(trimmedInput) && trimmedInput.length >= 6

  if (shouldUseGoogleSuggestion) {
    const googleResolution = await resolveAddressWithGoogle(trimmedInput)
    if (googleResolution?.formattedAddress) {
      suggestions.push(googleResolution.formattedAddress)
    }
  }

  if (isArcGisServicesRoot(API_URL)) {
    const serviceSuggestions = await suggestFromArcGisServicesRoot(API_URL, trimmedInput)
    suggestions.push(...serviceSuggestions)
  } else if (isArcGisLayerEndpoint(API_URL)) {
    const layerSuggestions = await suggestFromArcGisLayerEndpoint(API_URL, trimmedInput)
    suggestions.push(...layerSuggestions)
  }

  return dedupeAddressList(suggestions).slice(0, 8)
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