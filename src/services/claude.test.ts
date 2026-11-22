import { describe, expect, it } from 'vitest'
import { AnthropicApiError, describeInsightError } from '@/services/claude'

describe('describeInsightError', () => {
  it('puts common Anthropic answers in plain words', () => {
    expect(describeInsightError(new AnthropicApiError(401, 'invalid x-api-key'))).toBe(
      'Anthropic answered: invalid API key (401). Check the key in Settings → AI Providers, then try again.',
    )
    expect(describeInsightError(new AnthropicApiError(429, ''))).toBe(
      'Anthropic answered: too many requests (429). Wait a minute, then try again.',
    )
  })

  it("passes on Anthropic's own reason for anything else", () => {
    expect(describeInsightError(new AnthropicApiError(400, 'Your credit balance is too low.'))).toBe(
      'Anthropic answered: Your credit balance is too low (400). Try again, or check Settings → AI Providers.',
    )
  })

  it('reads a failed request as a connection problem', () => {
    expect(describeInsightError(new TypeError('Failed to fetch'))).toBe(
      "Couldn't reach Anthropic. Check your connection, then try again.",
    )
  })
})
