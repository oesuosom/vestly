import type { NewsCacheEntry } from '@/storage/portfolioStore'

export async function fetchBankierNews(
  holdings: Array<{ ticker: string; name: string }>,
): Promise<NewsCacheEntry[]> {
  if (holdings.length === 0) return []

  const results = await Promise.allSettled(
    holdings.map(async (h) => {
      const url = `/api/bankier/inwestowanie/profile/quote.html?symbol=${encodeURIComponent(h.ticker)}`
      const res = await fetch(url)
      if (!res.ok) return null

      const html = await res.text()
      const headlines = parseBankierNews(html).slice(0, 3)
      if (headlines.length === 0) return null

      return { ticker: h.ticker, name: h.name, headlines } satisfies NewsCacheEntry
    })
  )

  return results
    .filter((r): r is PromiseFulfilledResult<NewsCacheEntry> => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value)
}

function parseBankierNews(html: string): string[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  // Find the "Najnowsze informacje" section heading, then its sibling/parent list
  const headings = Array.from(doc.querySelectorAll('h2, h3, h4'))
  const newsHeading = headings.find((el) =>
    el.textContent?.includes('Najnowsze informacje')
  )

  let items: Element[] = []

  if (newsHeading) {
    // Walk siblings/parent to find the <ul> or <ol> containing news <li> elements
    let sibling = newsHeading.nextElementSibling
    while (sibling) {
      const lis = sibling.tagName === 'UL' || sibling.tagName === 'OL'
        ? Array.from(sibling.querySelectorAll('li'))
        : Array.from(sibling.querySelectorAll('ul li, ol li'))
      if (lis.length > 0) {
        items = lis
        break
      }
      sibling = sibling.nextElementSibling
    }

    // Fallback: check parent's siblings
    if (items.length === 0 && newsHeading.parentElement) {
      let parentSibling = newsHeading.parentElement.nextElementSibling
      while (parentSibling) {
        const lis = Array.from(parentSibling.querySelectorAll('li'))
        if (lis.length > 0) {
          items = lis
          break
        }
        parentSibling = parentSibling.nextElementSibling
      }
    }
  }

  // Last resort: grab all <li><a> items from the page that look like news
  if (items.length === 0) {
    items = Array.from(doc.querySelectorAll('li')).filter((li) => {
      const a = li.querySelector('a')
      return a && a.textContent && a.textContent.trim().length > 20
    })
  }

  return items
    .map((li) => {
      const a = li.querySelector('a')
      return a?.textContent?.trim() ?? ''
    })
    .filter((text) => text.length > 10)
}
