import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject,
} from 'react'
import './App.css'
import {
  lookupTaxableValueByAddress,
  suggestPropertyAddresses,
} from './services/oaklandParcel'
import {
  fetchEstimateUsageCount,
  trackEstimateCalculated,
} from './services/usageMetrics'

type TaxBreakdown = {
  annual: number
  monthly: number
}

type CalculationResult = {
  current: TaxBreakdown
  proposed: TaxBreakdown
  difference: TaxBreakdown
}

const DEFAULT_CURRENT_MILLAGE = 2.0991
const DEFAULT_PROPOSED_MILLAGE = 2.5
const DEFAULT_INCREMENTAL_MILLAGE =
  DEFAULT_PROPOSED_MILLAGE - DEFAULT_CURRENT_MILLAGE
const ANNUAL_COST_PER_100K = 100000 * (DEFAULT_INCREMENTAL_MILLAGE / 1000)
const PUBLIC_NOTICE_URL =
  'https://www.hazelpark.org/2026-05-05%20PUBLIC%20NOTICE%20-%20Copy.jpg?t=202605051454560'
const HPCAN_LOGO_URL = 'https://hpcan.org/assets/images/image03.png?v=bbf9bdb8'
const allowMillageInput = import.meta.env.VITE_ENABLE_MILLAGE_INPUT === 'true'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

function parsePositiveNumber(value: string): number | null {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null
  }
  return parsed
}

function calculateTaxBreakdown(
  taxableValue: number,
  millageRate: number,
): TaxBreakdown {
  const annual = taxableValue * (millageRate / 1000)
  return {
    annual,
    monthly: annual / 12,
  }
}

function toCurrency(value: number): string {
  return currencyFormatter.format(value)
}

type InitialQueryState = {
  address: string
  taxableValueInput: string
  currentMillageInput: string
  proposedMillageInput: string
  matchedAddress: string
  parcelId: string
}

function readInitialQueryState(): InitialQueryState {
  const state: InitialQueryState = {
    address: '',
    taxableValueInput: '',
    currentMillageInput: String(DEFAULT_CURRENT_MILLAGE),
    proposedMillageInput: String(DEFAULT_PROPOSED_MILLAGE),
    matchedAddress: '',
    parcelId: '',
  }

  if (globalThis.location === undefined) {
    return state
  }

  const params = new URLSearchParams(globalThis.location.search)
  const tv = params.get('tv')
  const cm = params.get('cm')
  const pm = params.get('pm')
  const sharedAddress = params.get('a')
  const ma = params.get('ma')
  const pid = params.get('pid')
  const addr = params.get('addr')

  if (tv !== null && parsePositiveNumber(tv) !== null) {
    state.taxableValueInput = tv
  }

  if (cm !== null && parsePositiveNumber(cm) !== null) {
    state.currentMillageInput = cm
  }

  if (pm !== null && parsePositiveNumber(pm) !== null) {
    state.proposedMillageInput = pm
  }

  const resolvedAddress = sharedAddress || ma || addr
  if (resolvedAddress) {
    state.address = resolvedAddress
    state.matchedAddress = resolvedAddress
  }

  if (pid) {
    state.parcelId = pid
  }

  return state
}

type CalculatorResultsPanelProps = Readonly<{
  calculations: CalculationResult | null
  currentMillage: number | null
  handlePrintEstimate: () => void
  handleShareEstimate: () => void
  lastLookupAt: string
  matchedAddress: string
  parcelId: string
  proposedMillage: number | null
  resultsRef: RefObject<HTMLDivElement | null>
  shareStatus: string
  taxableValue: number | null
}>

function CalculatorResultsPanel({
  calculations,
  currentMillage,
  handlePrintEstimate,
  handleShareEstimate,
  lastLookupAt,
  matchedAddress,
  parcelId,
  proposedMillage,
  resultsRef,
  shareStatus,
  taxableValue,
}: CalculatorResultsPanelProps) {
  return (
    <div className="results calculator-results" ref={resultsRef} tabIndex={-1}>
      <div className="results-header">
        <h2>
          Estimated Cost
          {' '}
          <span
            className="inline-hint"
            title="Taxable value is used for this estimate. Open Estimate details below for formula, source, and assumptions."
            aria-label="Estimate details hint"
          >
            i
          </span>
        </h2>
      </div>

      {calculations ? (
        <div className="print-summary">
          <div className="print-summary-header">
            <p className="print-brand-line">Hazel Park Civic Action Network</p>
            <h3>Hazel Park Library Millage Impact Report</h3>
            <p className="print-report-subtitle">
              Generated: {new Date().toLocaleString()}
            </p>
          </div>

          <section className="print-section" aria-label="Property details">
            <h4>Property Details</h4>
            <dl className="print-kv-grid">
              <div className="print-kv">
                <dt>Taxable value</dt>
                <dd>{taxableValue === null ? 'N/A' : toCurrency(taxableValue)}</dd>
              </div>
              <div className="print-kv">
                <dt>Matched address</dt>
                <dd>{matchedAddress || 'Not provided'}</dd>
              </div>
              <div className="print-kv">
                <dt>Parcel ID</dt>
                <dd>{parcelId || 'Not provided'}</dd>
              </div>
            </dl>
          </section>

          <section className="print-section" aria-label="Millage rates and costs">
            <h4>Millage And Cost Summary</h4>
            <table className="print-cost-table">
              <thead>
                <tr>
                  <th scope="col">Scenario</th>
                  <th scope="col">Monthly</th>
                  <th scope="col">Annual</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Difference</th>
                  <td>{toCurrency(calculations.difference.monthly)}</td>
                  <td>{toCurrency(calculations.difference.annual)}</td>
                </tr>
                <tr>
                  <th scope="row">Proposed</th>
                  <td>{toCurrency(calculations.proposed.monthly)}</td>
                  <td>{toCurrency(calculations.proposed.annual)}</td>
                </tr>
                <tr>
                  <th scope="row">Current</th>
                  <td>{toCurrency(calculations.current.monthly)}</td>
                  <td>{toCurrency(calculations.current.annual)}</td>
                </tr>
              </tbody>
            </table>
            <dl className="print-kv-grid print-rates-grid">
              <div className="print-kv">
                <dt>Current library millage</dt>
                <dd>{currentMillage === null ? 'N/A' : currentMillage.toFixed(4)} mills</dd>
              </div>
              <div className="print-kv">
                <dt>Proposed library millage</dt>
                <dd>{proposedMillage === null ? 'N/A' : proposedMillage.toFixed(4)} mills</dd>
              </div>
            </dl>
          </section>

          <section className="print-section" aria-label="Method and source">
            <h4>Method And Source</h4>
            <p>Annual tax = Taxable value x (millage / 1000); Monthly tax = Annual tax / 12.</p>
            <p>
              Parcel data source: Oakland County GIS
              {lastLookupAt ? ` | Last lookup: ${lastLookupAt}` : ''}
            </p>
          </section>
        </div>
      ) : null}

      {calculations ? (
        <div className="result-grid">
          <article className="difference">
            <h3>Difference</h3>
            <p className="metric-primary">
              {toCurrency(calculations.difference.monthly)} / month
            </p>
            <p className="metric-secondary">
              {toCurrency(calculations.difference.annual)} / year
            </p>
          </article>

          <article>
            <h3>Proposed</h3>
            <p className="metric-primary">
              {toCurrency(calculations.proposed.monthly)} / month
            </p>
            <p className="metric-secondary">
              {toCurrency(calculations.proposed.annual)} / year
            </p>
          </article>

          <article>
            <h3>Current</h3>
            <p className="metric-primary">
              {toCurrency(calculations.current.monthly)} / month
            </p>
            <p className="metric-secondary">
              {toCurrency(calculations.current.annual)} / year
            </p>
          </article>
        </div>
      ) : (
        <p className="placeholder">
          Enter a valid taxable value and both millage rates to see annual and
          monthly totals.
        </p>
      )}

      <p className="small-note">
        Parcel lookup unavailable? Enter taxable value manually.
      </p>

      <details className="fine-details" aria-label="Estimate assumptions and data source">
        <summary>Estimate details (formula, defaults, source, assumptions)</summary>
        <p>
          <strong>Formula:</strong>
          {' '}
          Annual tax = Taxable value x (millage / 1000); Monthly tax = Annual / 12.
        </p>
        <p>
          <strong>Default millage values:</strong>
          {' '}
          Hazel Park District Library 2026 ballot language (2.0991 renewal, 2.5 proposed total).
        </p>
        <p>
          <strong>Parcel data source:</strong>
          {' '}
          Oakland County GIS (queried live at lookup time)
          {lastLookupAt ? ` | Last lookup: ${lastLookupAt}` : ''}.
        </p>
        <ul className="proposal-list">
          <li>Tax calculations are based on taxable value, not market value.</li>
          <li>
            Inputs use the current and proposed millage rates shown above and may
            not include every item on a full tax bill.
          </li>
          <li>
            Parcel lookup data can occasionally lag, be incomplete, or include errors.
          </li>
        </ul>
      </details>

      <div className="result-actions result-actions-bottom">
        <button
          type="button"
          className="secondary-button"
          onClick={handleShareEstimate}
          disabled={!calculations}
        >
          Share Estimate
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={handlePrintEstimate}
          disabled={!calculations}
        >
          Print
        </button>
      </div>

      {shareStatus ? (
        <p className="meta share-status" role="status" aria-live="polite">
          {shareStatus}
        </p>
      ) : null}
    </div>
  )
}

function App() {
  const resultsRef = useRef<HTMLDivElement | null>(null)
  const hasTrackedEstimateUseRef = useRef(false)

  const [initialQueryState] = useState<InitialQueryState>(() => readInitialQueryState())

  const [address, setAddress] = useState(initialQueryState.address)
  const [taxableValueInput, setTaxableValueInput] = useState(initialQueryState.taxableValueInput)
  const [currentMillageInput, setCurrentMillageInput] = useState(
    initialQueryState.currentMillageInput,
  )
  const [proposedMillageInput, setProposedMillageInput] = useState(
    initialQueryState.proposedMillageInput,
  )
  const [matchedAddress, setMatchedAddress] = useState(initialQueryState.matchedAddress)
  const [parcelId, setParcelId] = useState(initialQueryState.parcelId)
  const [lookupError, setLookupError] = useState('')
  const [isLookingUp, setIsLookingUp] = useState(false)
  const [addressSuggestions, setAddressSuggestions] = useState<string[]>([])
  const [isSuggestingAddress, setIsSuggestingAddress] = useState(false)
  const [lastLookupAt, setLastLookupAt] = useState('')
  const [shareStatus, setShareStatus] = useState('')
  const [shouldFocusResults, setShouldFocusResults] = useState(false)
  const [todayUsageCount, setTodayUsageCount] = useState<number | null>(null)
  const [allTimeUsageCount, setAllTimeUsageCount] = useState<number | null>(null)

  const taxableValue = parsePositiveNumber(taxableValueInput)
  const currentMillage = parsePositiveNumber(currentMillageInput)
  const proposedMillage = parsePositiveNumber(proposedMillageInput)

  const calculations = useMemo(() => {
    if (
      taxableValue === null ||
      currentMillage === null ||
      proposedMillage === null
    ) {
      return null
    }

    const current = calculateTaxBreakdown(taxableValue, currentMillage)
    const proposed = calculateTaxBreakdown(taxableValue, proposedMillage)
    const difference = {
      annual: proposed.annual - current.annual,
      monthly: proposed.monthly - current.monthly,
    }

    return { current, proposed, difference }
  }, [taxableValue, currentMillage, proposedMillage])

  const lookupStatusMessage = useMemo(() => {
    if (isLookingUp) {
      return 'Looking up taxable value for the entered address.'
    }

    if (isSuggestingAddress) {
      return 'Finding address suggestions.'
    }

    if (lookupError) {
      return lookupError
    }

    if (matchedAddress) {
      return 'Address matched and taxable value updated.'
    }

    return ''
  }, [isLookingUp, isSuggestingAddress, lookupError, matchedAddress])

  const handleAddressChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextAddress = event.target.value
    setAddress(nextAddress)

    if (nextAddress.trim().length < 3) {
      setAddressSuggestions([])
      setIsSuggestingAddress(false)
    }
  }

  useEffect(() => {
    const searchText = address.trim()

    if (searchText.length < 3) {
      return
    }

    let cancelled = false
    const timeout = globalThis.setTimeout(async () => {
      setIsSuggestingAddress(true)

      try {
        const suggestions = await suggestPropertyAddresses(searchText)
        if (!cancelled) {
          setAddressSuggestions(suggestions)
        }
      } catch {
        if (!cancelled) {
          setAddressSuggestions([])
        }
      } finally {
        if (!cancelled) {
          setIsSuggestingAddress(false)
        }
      }
    }, 250)

    return () => {
      cancelled = true
      globalThis.clearTimeout(timeout)
    }
  }, [address])

  useEffect(() => {
    if (shouldFocusResults && calculations && resultsRef.current) {
      resultsRef.current.focus()
      setShouldFocusResults(false)
    }
  }, [shouldFocusResults, calculations])

  useEffect(() => {
    if (!calculations) {
      hasTrackedEstimateUseRef.current = false
      return
    }

    if (hasTrackedEstimateUseRef.current) {
      return
    }

    trackEstimateCalculated({
      hasMatchedAddress: Boolean(matchedAddress),
      hasParcelId: Boolean(parcelId),
    })
    hasTrackedEstimateUseRef.current = true
  }, [calculations, matchedAddress, parcelId])

  useEffect(() => {
    let cancelled = false

    const loadUsageCount = async () => {
      const count = await fetchEstimateUsageCount()
      if (!cancelled) {
        setTodayUsageCount(count?.todayCount ?? null)
        setAllTimeUsageCount(count?.allTimeCount ?? null)
      }
    }

    void loadUsageCount()

    return () => {
      cancelled = true
    }
  }, [])

  const buildShareUrl = () => {
    const url = new URL(globalThis.location.href)
    url.search = ''
    url.searchParams.set('tv', taxableValueInput)
    url.searchParams.set('cm', currentMillageInput)
    url.searchParams.set('pm', proposedMillageInput)
    if (parcelId) {
      url.searchParams.set('pid', parcelId)
    }
    const shareAddress = matchedAddress || address.trim()
    if (shareAddress) {
      url.searchParams.set('a', shareAddress)
    }
    return url.toString()
  }

  const buildEstimateReport = () => {
    if (!calculations) {
      return ''
    }

    const taxableDisplay = taxableValue === null ? 'N/A' : toCurrency(taxableValue)
    const generatedAt = new Date().toLocaleString()
    const sourceLine = lastLookupAt
      ? `Oakland County GIS | Last lookup: ${lastLookupAt}`
      : 'Oakland County GIS'
    const lines = [
      'HAZEL PARK LIBRARY MILLAGE IMPACT REPORT',
      'Prepared by Hazel Park Civic Action Network',
      `Generated: ${generatedAt}`,
      '',
      'PROPERTY',
      `Taxable value: ${taxableDisplay}`,
      `Matched address: ${matchedAddress || 'Not provided'}`,
      `Parcel ID: ${parcelId || 'Not provided'}`,
      '',
      'MILLAGE RATES',
      `Current library millage: ${currentMillage === null ? 'N/A' : currentMillage.toFixed(4)} mills`,
      `Proposed library millage: ${proposedMillage === null ? 'N/A' : proposedMillage.toFixed(4)} mills`,
      '',
      'ESTIMATED COST',
      `Difference: ${toCurrency(calculations.difference.monthly)} per month (${toCurrency(calculations.difference.annual)} per year)`,
      `Proposed: ${toCurrency(calculations.proposed.monthly)} per month (${toCurrency(calculations.proposed.annual)} per year)`,
      `Current: ${toCurrency(calculations.current.monthly)} per month (${toCurrency(calculations.current.annual)} per year)`,
      '',
      'METHODOLOGY',
      'Annual tax = Taxable value x (millage / 1000)',
      'Monthly tax = Annual tax / 12',
      '',
      'SOURCE',
      sourceLine,
    ]

    return lines.join('\n')
  }

  const buildShareText = () => {
    const shareUrl = buildShareUrl()
    const reportText = buildEstimateReport()
    return {
      shareUrl,
      shareText: `${reportText}\n\nSHARE LINK\n${shareUrl}`,
    }
  }

  const runBrowserShareFlow = async (shareUrl: string, shareText: string) => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share({
        title: 'Hazel Park Library Millage Impact Report',
        text: shareText,
        url: shareUrl,
      })
      return 'Report shared.'
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(shareText)
      return 'Report copied to clipboard. Paste it into email, notes, or text to share.'
    }

    if (typeof globalThis.prompt === 'function') {
      globalThis.prompt('Copy report text', shareText)
    }
    return 'Share APIs are not available here. A report copy dialog was opened.'
  }

  const runBrowserShareFallback = (shareText: string) => {
    if (typeof globalThis.prompt === 'function') {
      globalThis.prompt('Copy report text', shareText)
      return 'Share failed, but a report copy dialog was opened.'
    }

    return 'Could not share report. Copy the page URL manually.'
  }

  const handleShareEstimate = async () => {
    if (!calculations) {
      return
    }

    const { shareUrl, shareText } = buildShareText()

    try {
      setShareStatus('Preparing share...')
      const shareOutcome = await runBrowserShareFlow(shareUrl, shareText)
      setShareStatus(shareOutcome)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setShareStatus('Sharing canceled.')
        return
      }

      setShareStatus(runBrowserShareFallback(shareText))
    }
  }

  const handlePrintEstimate = () => {
    setShareStatus('')
    globalThis.print()
  }

  const handleLookup = async () => {
    if (!address.trim()) {
      setLookupError('Enter a property address to look up taxable value.')
      return
    }

    setIsLookingUp(true)
    setLookupError('')

    try {
      const result = await lookupTaxableValueByAddress(address)
      setTaxableValueInput(String(Math.round(result.taxableValue)))
      setMatchedAddress(result.matchedAddress ?? '')
      setParcelId(result.parcelId ?? '')
      setLastLookupAt(new Date().toLocaleString())
      setShouldFocusResults(true)
    } catch (error) {
      setMatchedAddress('')
      setParcelId('')
      setLookupError(
        error instanceof Error ? error.message : 'Could not retrieve parcel data.',
      )
    } finally {
      setIsLookingUp(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="hpcan-brand" aria-label="HPCAN branding">
          <a
            className="hpcan-logo-link"
            href="https://hpcan.org/"
            target="_blank"
            rel="noreferrer"
            aria-label="Hazel Park Civic Action Network"
          >
            <img
              className="hpcan-logo"
              src={HPCAN_LOGO_URL}
              alt="Hazel Park Civic Action Network logo"
              loading="lazy"
            />
          </a>
          <a
            className="hpcan-name"
            href="https://hpcan.org/"
            target="_blank"
            rel="noreferrer"
          >
            Hazel Park Civic Action Network
          </a>
        </div>
        <p className="eyebrow">Hazel Park Library Proposal</p>
        <h1>Millage Impact Calculator</h1>
        <p className="hero-copy">
          Enter an address to pull parcel taxable value, then compare current and
          proposed library tax estimates.
        </p>
      </header>

      <section className="panel calculator-panel">
        <form
          className="lookup-form"
          onSubmit={(event) => {
            event.preventDefault()
            void handleLookup()
          }}
        >
          <label htmlFor="address">Property Address</label>
          <div className="lookup-row">
            <input
              id="address"
              name="address"
              type="text"
              placeholder="e.g. 123 E Nine Mile Rd, Hazel Park, MI"
              list="address-suggestions"
              value={address}
              onChange={handleAddressChange}
            />
            <datalist id="address-suggestions">
              {addressSuggestions.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
            <button type="submit" disabled={isLookingUp}>
              {isLookingUp ? 'Looking up...' : 'Look Up Taxable Value'}
            </button>
          </div>
          {isSuggestingAddress ? (
            <p className="meta">Finding address suggestions...</p>
          ) : null}
          <p className="sr-only" role="status" aria-live="polite">
            {lookupStatusMessage}
          </p>
        </form>

        {lookupError ? (
          <p className="error" role="alert" aria-live="assertive">
            {lookupError}
          </p>
        ) : null}

        {matchedAddress ? (
          <p className="meta lookup-match-meta">
            Matched address: <strong>{matchedAddress}</strong>
            {parcelId ? (
              <>
                {' '}
                | Parcel ID: <strong>{parcelId}</strong>
              </>
            ) : null}
          </p>
        ) : null}

        <div className="input-grid">
          <label htmlFor="taxable-value">
            <span>Taxable Value ($)</span>
            <input
              id="taxable-value"
              type="number"
              min="0"
              step="1"
              value={taxableValueInput}
              onChange={(event) => setTaxableValueInput(event.target.value)}
              placeholder="Enter taxable value"
            />
          </label>

          <label htmlFor="current-millage">
            <span>Current Library Millage</span>
            <input
              id="current-millage"
              className={allowMillageInput ? undefined : 'millage-input-locked'}
              type="number"
              min="0"
              step="0.001"
              value={currentMillageInput}
              disabled={!allowMillageInput}
              readOnly={!allowMillageInput}
              onChange={(event) => setCurrentMillageInput(event.target.value)}
            />
          </label>

          <label htmlFor="proposed-millage">
            <span>Proposed Library Millage</span>
            <input
              id="proposed-millage"
              className={allowMillageInput ? undefined : 'millage-input-locked'}
              type="number"
              min="0"
              step="0.001"
              value={proposedMillageInput}
              disabled={!allowMillageInput}
              readOnly={!allowMillageInput}
              onChange={(event) => setProposedMillageInput(event.target.value)}
            />
          </label>
        </div>
        <CalculatorResultsPanel
          calculations={calculations}
          currentMillage={currentMillage}
          handlePrintEstimate={handlePrintEstimate}
          handleShareEstimate={handleShareEstimate}
          lastLookupAt={lastLookupAt}
          matchedAddress={matchedAddress}
          parcelId={parcelId}
          proposedMillage={proposedMillage}
          resultsRef={resultsRef}
          shareStatus={shareStatus}
          taxableValue={taxableValue}
        />
      </section>

      <section className="panel proposal-details">
        <h2>About The Proposal</h2>

        <div className="proposal-grid">
          <article className="proposal-highlight">
            <h3>Proposal At A Glance</h3>
            <p>
              Current rate: <strong>{DEFAULT_CURRENT_MILLAGE.toFixed(4)} mills</strong>
            </p>
            <p>
              Proposed total: <strong>{DEFAULT_PROPOSED_MILLAGE.toFixed(1)} mills</strong>
            </p>
            <p>
              Net change: <strong>{DEFAULT_INCREMENTAL_MILLAGE.toFixed(4)} mills</strong>
            </p>
            <p>
              About <strong>{toCurrency(ANNUAL_COST_PER_100K)}</strong> per year for
              every <strong>$100,000</strong> of taxable value.
            </p>
          </article>

          <article>
            <h3>What This Renewal Supports</h3>
            <p>
              The proposal continues core library operations and services while
              funding ongoing operating costs.
            </p>
            <ul className="proposal-list">
              <li>
                Operating hours and baseline staffing needed to keep the library
                open and responsive.
              </li>
              <li>
                Existing programming for children, teens, adults, and seniors,
                including recurring educational and community events.
              </li>
              <li>
                Continued access to collections, digital resources, computers,
                and internet service.
              </li>
              <li>
                Routine building operations, maintenance, and service delivery costs
                that are increasingly affected by inflation.
              </li>
            </ul>
          </article>
        </div>

        <div className="proposal-links">
          <h3>Public Notice</h3>
          <p>Click the image below to open the official public notice.</p>
          <a
            className="public-notice-link"
            href={PUBLIC_NOTICE_URL}
            target="_blank"
            rel="noreferrer"
          >
            <img
              src={PUBLIC_NOTICE_URL}
              alt="Hazel Park Public Notice"
              loading="lazy"
            />
          </a>          
          <h3>Open Meetings And Public Information</h3>
          <p>
            Check these official pages for district library details, meeting
            schedules, and recordings:
          </p>
          <ul className="proposal-list">
            <li>
              <a
                href="https://hazel-park.lib.mi.us/"
                target="_blank"
                rel="noreferrer"
              >
                Hazel Park District Library Page
              </a>
            </li>
            <li>
              <a
                href="https://www.hazelpark.org/visitors/meeting_information.php"
                target="_blank"
                rel="noreferrer"
              >
                Public Meeting Information (Open Meetings)
              </a>
            </li>
            <li>
              <a
                href="https://www.hazelpark.org/visitors/boards_and_commisions.php"
                target="_blank"
                rel="noreferrer"
              >
                Boards And Commissions (Includes Library-Related Bodies)
              </a>
            </li>
            <li>
              <a
                href="https://www.youtube.com/@cityofhazelparkcityhall7787/videos"
                target="_blank"
                rel="noreferrer"
              >
                City of Hazel Park City Hall YouTube Channel (Recordings)
              </a>
            </li>
          </ul>
        </div>

        <p className="small-note">
          Meeting schedules can change. Verify the latest details on official
          pages before attending.
        </p>
      </section>

      <section className="panel usage-metrics">
        {todayUsageCount !== null && allTimeUsageCount !== null ? (
          <>
          <h3 className="meta usage-count-meta" role="status" aria-live="polite">
            Estimates calculated today: <strong>{todayUsageCount}</strong>
          </h3>
          <h3 className="meta usage-count-meta" role="status" aria-live="polite">
            All-time estimates: <strong>{allTimeUsageCount}</strong>.
          </h3>
        </> ) : (
          <h3 className="meta usage-count-meta" role="status" aria-live="polite">
            Usage count unavailable right now.
          </h3>
        )}
        <p>
          If you find this information useful, please consider
          {' '}
          <a href="https://hpcan.org/donate" target="_blank" rel="noreferrer">
            donating to support HPCAN
          </a>.
        </p>
        <p className="small-note">
          Usage metrics are anonymous and reported only as aggregate counts. No
          personal identifiers are collected.
        </p>
      </section>
    </main>
  )
}

export default App



