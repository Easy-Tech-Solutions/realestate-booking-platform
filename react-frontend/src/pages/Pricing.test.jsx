import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import Pricing from './Pricing'

describe('Pricing page', () => {
  it('renders a heading', () => {
    const { getByText } = render(<Pricing />)
    expect(getByText('Pricing')).toBeTruthy()
  })
})
