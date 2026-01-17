import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import Home from '@pages/Home'

describe('App smoke test', () => {
  it('renders Home page heading', () => {
    const { getByText } = render(<Home />)
    expect(getByText('Homepage')).toBeTruthy()
  })
})
