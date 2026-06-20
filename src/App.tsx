import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from 'react'
import './App.css'
import {
  lookupTaxableValueByAddress,
  suggestPropertyAddresses,
} from './services/oaklandParcel'

type TaxBreakdown = {
  annual: number
  monthly: number
}

const DEFAULT_CURRENT_MILLAGE = 2.0991
const DEFAULT_PROPOSED_MILLAGE = 2.5
const DEFAULT_INCREMENTAL_MILLAGE =
  DEFAULT_PROPOSED_MILLAGE - DEFAULT_CURRENT_MILLAGE
const ANNUAL_COST_PER_100K = 100000 * (DEFAULT_INCREMENTAL_MILLAGE / 1000)
const PUBLIC_NOTICE_URL =
  'https://www.hazelpark.org/2026-05-05%20PUBLIC%20NOTICE%20-%20Copy.jpg?t=202605051454560'
const HPCAN_LOGO_URL = 'https://hpcan.org/assets/images/image03.png?v=bbf9bdb8'

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

function App() {
  const [address, setAddress] = useState('')
  const [taxableValueInput, setTaxableValueInput] = useState('')
  const [currentMillageInput, setCurrentMillageInput] = useState(
    String(DEFAULT_CURRENT_MILLAGE),
  )
  const [proposedMillageInput, setProposedMillageInput] = useState(
    String(DEFAULT_PROPOSED_MILLAGE),
  )
  const [matchedAddress, setMatchedAddress] = useState('')
  const [parcelId, setParcelId] = useState('')
  const [lookupError, setLookupError] = useState('')
  const [isLookingUp, setIsLookingUp] = useState(false)
  const [addressSuggestions, setAddressSuggestions] = useState<string[]>([])
  const [isSuggestingAddress, setIsSuggestingAddress] = useState(false)

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

      <section className="panel">
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
        </form>

        {lookupError ? <p className="error">{lookupError}</p> : null}

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
              type="number"
              min="0"
              step="0.001"
              value={currentMillageInput}
              onChange={(event) => setCurrentMillageInput(event.target.value)}
            />
          </label>

          <label htmlFor="proposed-millage">
            <span>Proposed Library Millage</span>
            <input
              id="proposed-millage"
              type="number"
              min="0"
              step="0.001"
              value={proposedMillageInput}
              onChange={(event) => setProposedMillageInput(event.target.value)}
            />
          </label>
        </div>

        <p className="formula">
          Formula: Annual tax = Taxable value x (millage / 1000); Monthly tax =
          Annual / 12
        </p>

        <p className="small-note">
          Default millage values are based on Hazel Park District Library 2026
          ballot language (2.0991 renewal, 2.5 proposed total).
        </p>
      </section>

      <section className="panel results">
        <h2>Estimated Cost</h2>

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
              <h3>Current</h3>
              <p className="metric-primary">
                {toCurrency(calculations.current.monthly)} / month
              </p>
              <p className="metric-secondary">
                {toCurrency(calculations.current.annual)} / year
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
      </section>

      <section className="panel proposal-details">
        <h2>About The Proposal</h2>

        <div className="proposal-grid">
          <article>
            <h3>Proposal Snapshot</h3>
            <p>
              Current rate: <strong>{DEFAULT_CURRENT_MILLAGE.toFixed(4)} mills</strong>
            </p>
            <p>
              Proposed total: <strong>{DEFAULT_PROPOSED_MILLAGE.toFixed(1)} mills</strong>
            </p>
            <p>
              Net change: <strong>{DEFAULT_INCREMENTAL_MILLAGE.toFixed(4)} mills</strong>
            </p>
          </article>

          <article className="proposal-highlight">
            <h3>Estimated Cost Impact</h3>
            <p>
              About <strong>{toCurrency(ANNUAL_COST_PER_100K)}</strong> per year for
              every <strong>$100,000</strong> of taxable value.
            </p>
          </article>

          <article>
            <h3>What This Renewal Supports</h3>
            <ul className="proposal-list">
              <li>
                Primarily continuation of current library services residents rely
                on every week.
              </li>
              <li>
                Ongoing operating hours and baseline staffing needed to keep the
                library open and responsive.
              </li>
              <li>
                Existing programming for children, teens, adults, and seniors,
                including recurring educational and community events.
              </li>
              <li>
                Continued access to current collections, digital resources,
                computers, and internet services used by patrons daily.
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
    </main>
  )
}

export default App



