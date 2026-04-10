/**
 * Hacker News collector — uses the HN Algolia API (no credentials required).
 *
 * Searches all signals against HN stories and comments from the past 7 days.
 * HN volume is lower than Reddit but the audience (technical operators,
 * founders, GTM engineers) tends to be higher quality signal.
 *
 * API: https://hn.algolia.com/api/v1/search
 * No rate limiting concerns — Algolia's HN API is very permissive.
 * Runs on a daily cron (9am) — registered in src/index.ts.
 */

import { BuyerProfile, SignalCategory, SignalTaxonomy } from '@prisma/client'
import { config } from '../../client.config.js'
import { ingestSignal } from '../scoring/ingest.js'
import type { DetectedSignal } from '../types/index.js'

// ── Signal metadata maps (same as Reddit collector) ───────────────────────────

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

// ── HN Algolia API types ──────────────────────────────────────────────────────

interface HNHit {
  objectID: string
  author: string
  title?: string           // present on stories
  story_text?: string      // present on Ask HN / Show HN stories
  comment_text?: string    // present on comments
  url?: string             // present on link stories
  created_at_i: number     // unix timestamp
  _tags: string[]          // includes 'story' | 'comment' | 'ask_hn' | 'show_hn'
}

interface HNSearchResponse {
  hits: HNHit[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const WEEK_IN_SECONDS = 7 * 24 * 60 * 60

async function searchHN(term: string): Promise<HNHit[]> {
  const weekAgo = Math.floor(Date.now() / 1000) - WEEK_IN_SECONDS
  const url =
    `https://hn.algolia.com/api/v1/search` +
    `?query=${encodeURIComponent(term)}` +
    `&tags=(story,comment)` +
    `&numericFilters=created_at_i>${weekAgo}` +
    `&hitsPerPage=20`

  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    console.warn(`[HN] Network error for "${term}":`, err)
    return []
  }

  if (!res.ok) {
    console.warn(`[HN] Search failed for "${term}": ${res.status}`)
    return []
  }

  const json = (await res.json()) as HNSearchResponse
  return json.hits.filter(h => h.author && h.author !== 'null')
}

function getSignalType(hit: HNHit): string {
  return hit._tags.includes('comment') ? 'HN_COMMENT' : 'HN_POST'
}

function getSourceUrl(hit: HNHit): string {
  return `https://news.ycombinator.com/item?id=${hit.objectID}`
}

function getSnippet(hit: HNHit): string {
  const text = hit.comment_text ?? hit.story_text ?? hit.title ?? ''
  return text.replace(/<[^>]*>/g, '').slice(0, 500) // strip HTML tags
}

// ── Main collector ────────────────────────────────────────────────────────────

export async function runHNCollector(): Promise<void> {
  console.log('\n[HN] Collector starting...')

  let totalHits = 0
  let storedSignals = 0

  for (const signal of config.signals) {
    // Top 2 search terms per signal — HN is lower volume, 2 is enough
    const terms = signal.searchTerms.slice(0, 2)

    for (const term of terms) {
      const hits = await searchHN(term)
      console.log(`[HN] "${term}" → ${hits.length} results`)

      for (const hit of hits) {
        totalHits++

        const detected: DetectedSignal = {
          handle:     hit.author,
          platform:   'hn',
          profileUrl: `https://news.ycombinator.com/user?id=${hit.author}`,
          signalType: getSignalType(hit),
          category:   CATEGORY_MAP[signal.name] ?? SignalCategory.COMMUNITY_INTENT,
          taxonomy:   TAXONOMY_MAP[signal.name] ?? SignalTaxonomy.INTENT,
          weight:     signal.weight,
          sourceUrl:  getSourceUrl(hit),
          rawData: {
            title:      hit.title ?? '',
            snippet:    getSnippet(hit),
            searchTerm: term,
            signalName: signal.name,
            tags:       hit._tags,
            created_at_i: hit.created_at_i,
          },
          buyerProfile: BUYER_PROFILE_MAP[signal.name] ?? BuyerProfile.UNKNOWN,
          detectedAt:   new Date(hit.created_at_i * 1000),
        }

        const result = await ingestSignal(detected)
        if (result.stored) {
          storedSignals++
          const tag = result.qualified ? ' 🔔 QUALIFIED' : ''
          console.log(`[HN] ✓ ${hit.author} | ${signal.name}${tag}`)
        }
      }
    }
  }

  console.log(`[HN] Done — ${storedSignals} stored from ${totalHits} hits scanned.\n`)
}
