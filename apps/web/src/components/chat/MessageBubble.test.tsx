// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MessageBubble } from './MessageBubble'

afterEach(cleanup)

describe('MessageBubble', () => {
  it('renders a user message without the agent label', () => {
    render(<MessageBubble author="user" segments={[{ text: 'hello there' }]} />)
    expect(screen.getByText('hello there')).toBeDefined()
    expect(screen.queryByText(/claude code/i)).toBeNull()
  })

  it('renders a brain message with the agent label and markdown', () => {
    render(<MessageBubble author="brain" segments={[{ text: '**bold**' }]} />)
    expect(screen.getByText(/claude code/i)).toBeDefined()
    expect(screen.getByText('bold').tagName).toBe('STRONG')
  })
})
