/**
 * LinkedIn collector — uses Serper API to search Google for LinkedIn posts
 * matching each signal's search terms (site:linkedin.com/posts).
 *
 * Serper returns post URL, title, and snippet from Google's index — enough
 * to classify the signal and extract the author's LinkedIn slug.
 *
 * Cost: 1 Serper credit per search. At 2 terms × 10 signals = 20 credits/day,
 * the 2,500 free credits last ~125 days.
 *
 * Runs daily at 10am — registered in src/index.ts.
 */

import { BuyerProfile, SignalCategory, SignalTaxonomy } from '@prisma/client'
import { config } from '../../client.config.js'
import { ingestSignal } from '../scoring/ingest.js'
import type { DetectedSignal } from '../types/index.js'

const SERPER_API_KEY = process.env.SERPER_API_KEY
const SERPER_URL = 'https://google.serper.dev/search'

// ── Signal metadata maps ──────────────────────────────────────────────────────

const BUYER_PROFILE_MAP: Record<string, BuyerProfile> = {
  'GTM Engineering Career Interest': BuyerProfile.CAREER_SEEKER,
  'SDR Career Frustration':          BuyerProfile.CAREER_SEEKER,
  'Wants to Learn Clay':             BuyerProfile.CAREER_SEEKER,
  'Clay Workflow Struggles':         BuyerProfile.CAREER_SEEKER,
  'Starting a Clay Agency':          BuyerProfile.AGENCY_BUILDER,
  'Agency Scaling Challenges':       BuyerProfile.AGENCY_BUILDER,
}

const CATEGORY_MAP: Record<string, SignalCategory> = {
  'Clay Bootcamp Mention or Inquiry': SignalCategory.BRAND_SIGNAL,
  'Wants to Learn Clay':              SignalCategory.COMMUNITY_INTENT,
  'Clay Workflow Struggles':          SignalCategory.COMMUNITY_INTENT,
  'Company Adopted Clay Recently':    SignalCategory.COMMUNITY_INTENT,
  'Starting a Clay Agency':           SignalCategory.COMMUNITY_INTENT,
  'Agency Scaling Challenges':        SignalCategory.COMMUNITY_INTENT,
  'GTM Engineering Career Interest':  SignalCategory.MARKET_SIGNAL,
  'SDR Career Frustration':           SignalCategory.MARKET_SIGNAL,
  'Outbound Automation Learning':     SignalCategory.MARKET_SIGNAL,
  'Hiring GTM Engineers':             SignalCategory.MARKET_SIGNAL,
}

const TAXONOMY_MAP: Record<string, SignalTaxonomy> = {
  'Company Adopted Clay Recently': SignalTaxonomy.TRIGGER,
  'Hiring GTM Engineers':          SignalTaxonomy.TRIGGER,
}

// ── Serper API types ──────────────────────────────────────────────────────────

interface SerperResult {
  title: string
  link: string
  snippet: string
  date?: string
  position: number
}

interface SerperResponse {
  organic: SerperResult[]
  credits: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extracts the LinkedIn author slug from a LinkedIn post URL.
 * https://www.linkedin.com/posts/timyakubson_some-post-title-activity-123-abc
 *                                   ^^^^^^^^^^^
 */
function extractSlug(url: string): string | null {
  const match = url.match(/linkedin\.com\/posts\/([^_]+)/)
  return match ? match[1] : null
}

async function searchLinkedIn(term: string): Promise<SerperResult[]> {
  if (!SERPER_API_KEY) {
    console.warn('[LinkedIn] SERPER_API_KEY not set — skipping')
    return []
  }

  let res: Response
  try {
    res = await fetch(SERPER_URL, {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: `site:linkedin.com/posts ${term}`,
        num: 10,
      }),
    })
  } catch (err) {
    console.warn(`[LinkedIn] Network error for "${term}":`, err)
    return []
  }

  if (!res.ok) {
    console.warn(`[LinkedIn] Serper search failed for "${term}": ${res.status}`)
    return []
  }

  const json = (await res.json()) as SerperResponse
  return json.organic ?? []
}

// ── Main collector ────────────────────────────────────────────────────────────

export async function runLinkedInCollector(): Promise<void> {
  if (!SERPER_API_KEY) {
    console.warn('[LinkedIn] SERPER_API_KEY not set — collector skipped')
    return
  }

  console.log('\n[LinkedIn] Collector starting...')

  let totalResults = 0
  let storedSignals = 0

  for (const signal of config.signals) {
    // 1 term per signal — most specific term only, keeps daily usage at 10 credits
    // 2,500 free Serper credits ÷ 10/day = 250 days of free LinkedIn coverage
    const terms = signal.searchTerms.slice(0, 1)

    for (const term of terms) {
      const results = await searchLinkedIn(term)
      console.log(`[LinkedIn] "${term}" → ${results.length} results`)

      for (const result of results) {
        const slug = extractSlug(result.link)
        if (!slug) continue // skip if we can't identify the author

        totalResults++

        const detected: DetectedSignal = {
          handle:     slug,
          platform:   'linkedin',
          profileUrl: `https://www.linkedin.com/in/${slug}`,
          signalType: 'LINKEDIN_POST',
          category:   CATEGORY_MAP[signal.name] ?? SignalCategory.COMMUNITY_INTENT,
          taxonomy:   TAXONOMY_MAP[signal.name] ?? SignalTaxonomy.INTENT,
          weight:     signal.weight,
          sourceUrl:  result.link,
          rawData: {
            title:      result.title,
            snippet:    result.snippet,
            date:       result.date ?? '',
            searchTerm: term,
            signalName: signal.name,
            position:   result.position,
          },
          buyerProfile: BUYER_PROFILE_MAP[signal.name] ?? BuyerProfile.UNKNOWN,
          detectedAt:   new Date(),
        }

        const ingestResult = await ingestSignal(detected)
        if (ingestResult.stored) {
          storedSignals++
          const tag = ingestResult.qualified ? ' 🔔 QUALIFIED' : ''
          console.log(`[LinkedIn] ✓ ${slug} | ${signal.name}${tag}`)
        }
      }
    }
  }

  console.log(`[LinkedIn] Done — ${storedSignals} stored from ${totalResults} results scanned.\n`)
}
