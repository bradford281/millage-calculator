import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import App from '../src/App'

vi.mock('../src/services/oaklandParcel', () => ({
  lookupTaxableValueByAddress: vi.fn(),
  suggestPropertyAddresses: vi.fn().mockResolvedValue([]),
}))

describe('millage calculator smoke test', () => {
  it('shows formatted difference values after entering taxable value', () => {
    render(<App />)

    const taxableValueInput = screen.getByLabelText('Taxable Value ($)')
    fireEvent.change(taxableValueInput, { target: { value: '100000' } })

    const differenceHeading = screen.getByRole('heading', { name: 'Difference' })
    const differenceCard = differenceHeading.closest('article')

    if (!differenceCard) {
      throw new Error('Difference card not found')
    }

    const scoped = within(differenceCard)
    expect(scoped.getByText('$3.34 / month')).toBeTruthy()
    expect(scoped.getByText('$40.09 / year')).toBeTruthy()
  })
})
