// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { InlineText } from './InlineText'

afterEach(cleanup)

describe('InlineText', () => {
  it('renders each segment and styles toned ones', () => {
    render(<InlineText segments={[{ text: 'plain ' }, { text: 'code', tone: 'mono' }]} />)
    expect(screen.getByText('plain')).toBeDefined()
    expect(screen.getByText('code').className).toContain('font-mono')
  })

  it('defaults to the plain tone without a class', () => {
    render(<InlineText segments={[{ text: 'bare' }]} />)
    expect(screen.getByText('bare').className).toBe('')
  })
})
