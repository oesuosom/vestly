import type { DividendCacheEntry, NewsCacheEntry } from '@/storage/portfolioStore'

export type InsightTopHolding = {
  name: string
  ticker?: string
  category: string
  valuePercent: number
  pnlPercent: number
}

export type InsightInput = {
  totalValue: number
  delta: number
  deltaPercent: number
  period: string
  currentAllocation: { bonds: number; stocks: number; cash: number; crypto: number }
  unrealizedPnL: number
  realizedPnL: number
  topHoldings: InsightTopHolding[]
  upcomingDividends: DividendCacheEntry[]
  newsHeadlines: NewsCacheEntry[]
}

type ClaudeResponse = {
  content: Array<{ type: string; text: string }>
}

function formatPLN(value: number): string {
  return new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 }).format(value) + ' PLN'
}

function formatPct(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

export function buildInsightPrompt(input: InsightInput): string {
  const lines: string[] = []

  const sign = input.delta >= 0 ? '+' : ''
  lines.push(`Portfolio total: ${formatPLN(input.totalValue)}`)
  lines.push(`Change: ${sign}${formatPLN(input.delta)} (${formatPct(input.deltaPercent)}) ${input.period}`)
  lines.push(
    `Allocation: stocks ${input.currentAllocation.stocks.toFixed(0)}%, bonds ${input.currentAllocation.bonds.toFixed(0)}%, crypto ${input.currentAllocation.crypto.toFixed(0)}%, cash ${input.currentAllocation.cash.toFixed(0)}%`
  )
  lines.push(
    `Unrealised P&L: ${input.unrealizedPnL >= 0 ? '+' : ''}${formatPLN(input.unrealizedPnL)} | Realised P&L: ${input.realizedPnL >= 0 ? '+' : ''}${formatPLN(input.realizedPnL)}`
  )

  if (input.topHoldings.length > 0) {
    lines.push('')
    lines.push('Top holdings by weight:')
    for (const h of input.topHoldings) {
      const label = h.ticker ? `${h.name} (${h.ticker}, ${h.category})` : `${h.name} (${h.category})`
      lines.push(`- ${label}: ${h.valuePercent.toFixed(1)}% of portfolio, ${formatPct(h.pnlPercent)} since purchase`)
    }
  }

  if (input.upcomingDividends.length > 0) {
    lines.push('')
    lines.push('Upcoming ex-dividend dates:')
    for (const d of input.upcomingDividends) {
      const est = d.estimatedPLN > 0 ? `, est. ${formatPLN(d.estimatedPLN)}` : ''
      lines.push(`- ${d.name} (${d.ticker}): ${d.exDividendDate} (${d.daysUntil} days)${est}`)
    }
  }

  if (input.newsHeadlines.length > 0) {
    lines.push('')
    lines.push('Recent news headlines:')
    for (const entry of input.newsHeadlines) {
      lines.push(`${entry.name}:`)
      for (const headline of entry.headlines) {
        lines.push(`  • "${headline}"`)
      }
    }
  }

  return lines.join('\n')
}

export type AccountInsightHolding = {
  name: string
  ticker?: string
  category: string
  quantity: number
  valuePLN: number
  returnPLN: number
  returnPercent: number
  allocationPercent: number
}

export type AccountInsightInput = {
  accountName: string
  accountType: string
  totalValuePLN: number
  costBasisPLN: number
  totalReturnPLN: number
  totalReturnPercent: number
  holdings: AccountInsightHolding[]
  ikeLimitPLN?: number
  ikeRemainingPLN?: number
  ikzeLimitPLN?: number
  ikzeRemainingPLN?: number
}

function buildAccountInsightPrompt(input: AccountInsightInput): string {
  const topPerformer = input.holdings.reduce<AccountInsightHolding | null>(
    (best, h) => (!best || h.returnPercent > best.returnPercent ? h : best),
    null
  )
  const largestHolding = input.holdings.reduce<AccountInsightHolding | null>(
    (best, h) => (!best || h.allocationPercent > best.allocationPercent ? h : best),
    null
  )

  const accountData: Record<string, unknown> = {
    total_value_pln: Math.round(input.totalValuePLN),
    total_book_cost_pln: Math.round(input.costBasisPLN),
    total_return_pln: Math.round(input.totalReturnPLN),
    total_return_pct: parseFloat(input.totalReturnPercent.toFixed(1)),
    positions: input.holdings.length,
  }

  if (topPerformer) {
    accountData.top_performer = {
      name: topPerformer.ticker ?? topPerformer.name,
      return_pct: parseFloat(topPerformer.returnPercent.toFixed(1)),
    }
  }

  if (largestHolding) {
    accountData.largest_holding = {
      name: largestHolding.ticker ?? largestHolding.name,
      allocation_pct: parseFloat(largestHolding.allocationPercent.toFixed(1)),
    }
  }

  // Limits come from the user's contribution settings for the current year —
  // they change annually per Polish tax law, so nothing is hardcoded here.
  if (input.ikeRemainingPLN !== undefined && input.ikeLimitPLN !== undefined) {
    accountData.ike_limit_pln = Math.round(input.ikeLimitPLN)
    accountData.ike_contributed_pln = Math.max(0, Math.round(input.ikeLimitPLN - input.ikeRemainingPLN))
    accountData.ike_remaining_pln = Math.round(input.ikeRemainingPLN)
  }

  if (input.ikzeRemainingPLN !== undefined && input.ikzeLimitPLN !== undefined) {
    accountData.ikze_limit_pln = Math.round(input.ikzeLimitPLN)
    accountData.ikze_contributed_pln = Math.max(0, Math.round(input.ikzeLimitPLN - input.ikzeRemainingPLN))
    accountData.ikze_remaining_pln = Math.round(input.ikzeRemainingPLN)
  }

  accountData.holdings = input.holdings.map((h) => ({
    name: h.name,
    ...(h.ticker ? { ticker: h.ticker } : {}),
    category: h.category,
    quantity: h.quantity,
    value_pln: Math.round(h.valuePLN),
    allocation_pct: parseFloat(h.allocationPercent.toFixed(1)),
    return_pln: Math.round(h.returnPLN),
    return_pct: parseFloat(h.returnPercent.toFixed(1)),
  }))

  return [
    `Account type: ${input.accountType.toUpperCase()}`,
    '',
    'Account data:',
    JSON.stringify(accountData, null, 2),
    '',
    'Write a 200–230 character insight summary for this account. Output only the final summary — no reasoning, no character count, no annotations.',
  ].join('\n')
}

const ACCOUNT_INSIGHT_SYSTEM = `You are a financial insight writer for a personal portfolio tracking app. Your job is to write a short, punchy account summary that surfaces the 2–3 most relevant facts about the account right now — the kind of thing a knowledgeable friend would say, not a report generator.

Output rules — non-negotiable:
- Write 2–3 sentences, approximately 35–45 words. If your draft is shorter than 35 words, add another specific fact from the data before responding.
- No greeting. No account name or type label. No bullet points.
- Write in second person ("your", "you have", "you're").
- Lead with the most interesting or actionable fact.
- Embed numbers naturally into sentences — do not list them.
- Output only the final summary. No reasoning, no word count, no annotations of any kind.

What to highlight by account type:

BROKERAGE
- Weekly or monthly portfolio change (PLN + %)
- Top performer and worst performer if notable
- Any dividends received recently

IKE
- Total return since purchase (PLN + %)
- Best performing bond by %
- Mention the remaining annual limit only if ike_remaining_pln is present in the account data — never estimate or infer it from cost basis or total value

IKZE
- Weekly gain/loss (PLN + %)
- Top and worst performing position
- Mention the remaining annual limit only if ikze_remaining_pln is present in the account data — never estimate or infer it from cost basis or total value

CRYPTO
- Biggest mover by % (up or down)
- Total account value in PLN
- Any significant 7-day swing worth flagging

SAVINGS
- Interest earned this month and year-to-date
- Current balance
- Effective rate if it has changed

For Polish government bonds, the ticker encodes maturity: EDOMMYY means it matures in month MM of year 20YY (e.g. EDO0535 → May 2035, EDO0935 → September 2035).

Use markup: wrap positive amounts and percentages in {+X} (e.g. {+329 PLN}, {+40.9%}), negative amounts and percentages in {-X} (e.g. {-14.2%}, {-50 PLN}), ticker and instrument names in [TICKER]. No financial advice language.`

const CLAUDE_HEADERS = {
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
  'content-type': 'application/json',
}

export async function generateAccountInsight(input: AccountInsightInput, apiKey: string): Promise<string> {
  const userMessage = buildAccountInsightPrompt(input)

  const res = await fetch('/api/anthropic/v1/messages', {
    method: 'POST',
    headers: { ...CLAUDE_HEADERS, 'x-api-key': apiKey },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      temperature: 0.3,
      system: ACCOUNT_INSIGHT_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new Error(`Claude API error ${res.status}: ${body}`)
  }

  const data = (await res.json()) as ClaudeResponse
  const text = data.content?.[0]?.text?.trim()
  if (!text) throw new Error('Empty response from Claude API')

  // If too short (< 30 words), retry once with an explicit nudge
  const wordCount = text.split(/\s+/).length
  if (wordCount < 30) {
    const retryRes = await fetch('/api/anthropic/v1/messages', {
      method: 'POST',
      headers: { ...CLAUDE_HEADERS, 'x-api-key': apiKey },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        temperature: 0.3,
        system: ACCOUNT_INSIGHT_SYSTEM,
        messages: [
          { role: 'user', content: userMessage },
          { role: 'assistant', content: text },
          {
            role: 'user',
            content: `That summary is only ${wordCount} words — too short. Expand it to 35–45 words by adding one more specific fact from the data (e.g. the largest holding's allocation, a maturity date, or the remaining annual limit). Output only the revised summary.`,
          },
        ],
      }),
    })
    if (retryRes.ok) {
      const retryData = (await retryRes.json()) as ClaudeResponse
      const retryText = retryData.content?.[0]?.text?.trim()
      if (retryText) return retryText
    }
  }

  return text
}

// Parses markup like {+246 PLN}, {-50 PLN}, [EDO0535] into styled React nodes.
// Returns an array of strings and React elements for inline rendering.
export function parseAccountInsightMarkup(text: string): Array<string | { type: 'positive' | 'negative' | 'ticker'; text: string }> {
  const parts: Array<string | { type: 'positive' | 'negative' | 'ticker'; text: string }> = []
  // Matches {+...}, {-...}, and [...]
  const pattern = /(\{\+[^}]+\}|\{-[^}]+\}|\[[^\]]+\])/g
  let last = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index))
    }
    const token = match[0]
    if (token.startsWith('{+')) {
      parts.push({ type: 'positive', text: token.slice(2, -1) })
    } else if (token.startsWith('{-')) {
      parts.push({ type: 'negative', text: token.slice(1, -1) })
    } else {
      parts.push({ type: 'ticker', text: token.slice(1, -1) })
    }
    last = match.index + token.length
  }

  if (last < text.length) {
    parts.push(text.slice(last))
  }

  return parts
}

export async function generateInsight(input: InsightInput, apiKey: string): Promise<string> {
  const userMessage = buildInsightPrompt(input)

  const res = await fetch('/api/anthropic/v1/messages', {
    method: 'POST',
    headers: { ...CLAUDE_HEADERS, 'x-api-key': apiKey },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 250,
      system:
        'You are a personal finance briefing assistant for a Polish investor. Write exactly 2-3 sentences in English. Be concrete with numbers in PLN. Mention upcoming dividends if close (under 10 days). Reference news headlines to explain why specific holdings moved — but only if the connection is plausible. Tone: factual, friendly, conversational — like a trusted dashboard assistant. No financial advice language.',
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new Error(`Claude API error ${res.status}: ${body}`)
  }

  const data = (await res.json()) as ClaudeResponse
  const text = data.content?.[0]?.text
  if (!text) throw new Error('Empty response from Claude API')
  return text.trim()
}
