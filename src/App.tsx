import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import { lookupTaxableValueByAddress } from './services/oaklandParcel'

type TaxBreakdown = {
  annual: number
  monthly: number
}

const DEFAULT_CURRENT_MILLAGE = 2.0991
const DEFAULT_PROPOSED_MILLAGE = 2.5

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

  async function handleLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

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
        <p className="eyebrow">Hazel Park Library Proposal</p>
        <h1>Millage Impact Calculator</h1>
        <p className="hero-copy">
          Enter an address to pull taxable value from parcel data, then compare
          current and proposed library tax. Estimates are based on taxable value,
          not market value.
        </p>
      </header>

      <section className="panel">
        <form className="lookup-form" onSubmit={handleLookup}>
          <label htmlFor="address">Property Address</label>
          <div className="lookup-row">
            <input
              id="address"
              name="address"
              type="text"
              placeholder="e.g. 123 E Nine Mile Rd, Hazel Park, MI"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
            <button type="submit" disabled={isLookingUp}>
              {isLookingUp ? 'Looking up...' : 'Look Up Taxable Value'}
            </button>
          </div>
        </form>

        {lookupError ? <p className="error">{lookupError}</p> : null}

        {matchedAddress ? (
          <p className="meta">
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
            Taxable Value ($)
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
            Current Library Millage
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
            Proposed Library Millage
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
            <article>
              <h3>Current</h3>
              <p>{toCurrency(calculations.current.annual)} / year</p>
              <p>{toCurrency(calculations.current.monthly)} / month</p>
            </article>

            <article>
              <h3>Proposed</h3>
              <p>{toCurrency(calculations.proposed.annual)} / year</p>
              <p>{toCurrency(calculations.proposed.monthly)} / month</p>
            </article>

            <article className="difference">
              <h3>Difference</h3>
              <p>{toCurrency(calculations.difference.annual)} / year</p>
              <p>{toCurrency(calculations.difference.monthly)} / month</p>
            </article>
          </div>
        ) : (
          <p className="placeholder">
            Enter a valid taxable value and both millage rates to see annual and
            monthly totals.
          </p>
        )}

        <p className="small-note">
          If parcel lookup is unavailable, enter taxable value manually.
        </p>
      </section>
    </main>
  )
}

export default App
