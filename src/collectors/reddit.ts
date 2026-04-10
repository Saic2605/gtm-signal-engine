/**
 * Reddit collector — uses Reddit's public JSON API (no OAuth required).
 *
 * For each signal tagged for Reddit, searches the top 3 search terms against
 * Reddit's /search.json endpoint (past week, sorted new). Maps each hit to a
 * DetectedSignal and calls ingestSignal() — the full suppress → dedup → score
 * → qualify pipeline runs automatically.
 *
 * Rate limit: 1.1s between requests keeps us under Reddit's 1 req/sec limit
 * for unauthenticated clients. At 10 signals × 3 terms = 30 requests per run,
 * a full hourly sweep takes ~33 seconds.
 */

import { BuyerProfile, SignalCategory, SignalTaxonomy } from '@prisma/client'
import { config } from '../../client.config.js'
import { ingestSignal } from '../scoring/ingest.js'
import type { DetectedSignal } from '../types/index.js'

// Only process signals that are configured for Reddit
const REDDIT_SIGNALS = config.signals.filter(s => s.platforms.includes('reddit'))

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

// ── Reddit API types ──────────────────────────────────────────────────────────

interface RedditPost {
  author: string
  title: string
  selftext: string
  url: string
  permalink: string
  subreddit: string
  created_utc: number
  is_self: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

const USER_AGENT = 'gtm-signal-engine/1.0 (public signal collector; contact via github)'

async function searchReddit(term: string): Promise<RedditPost[]> {
  const url =
    `https://www.reddit.com/search.json` +
    `?q=${encodeURIComponent(term)}&sort=new&t=week&limit=25&type=link`

  let res: Response
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  } catch (err) {
    console.warn(`[Reddit] Network error for "${term}":`, err)
    return []
  }

  if (res.status === 429) {
    console.warn(`[Reddit] Rate limited — waiting 10s before continuing`)
    await sleep(10_000)
    return []
  }

  if (!res.ok) {
    console.warn(`[Reddit] Search failed for "${term}": ${res.status}`)
    return []
  }

  const json = (await res.json()) as {
    data: { children: Array<{ data: RedditPost }> }
  }

  return json.data.children
    .map(c => c.data)
    .filter(p => p.author !== '[deleted]' && p.author !== 'AutoModerator')
}

// ── Main collector ────────────────────────────────────────────────────────────

export async function runRedditCollector(): Promise<void> {
  console.log('\n[Reddit] Collector starting...')

  let totalPosts = 0
  let storedSignals = 0

  for (const signal of REDDIT_SIGNALS) {
    // Cap at 3 terms per signal — 30 requests/hour well within rate limits
    const terms = signal.searchTerms.slice(0, 3)

    for (const term of terms) {
      await sleep(1_100) // stay under 1 req/sec

      const posts = await searchReddit(term)
      console.log(`[Reddit] "${term}" → ${posts.length} results`)

      for (const post of posts) {
        totalPosts++

        const detected: DetectedSignal = {
          handle:     post.author,
          platform:   'reddit',
          profileUrl: `https://www.reddit.com/user/${post.author}`,
          signalType: 'REDDIT_POST',
          category:   CATEGORY_MAP[signal.name] ?? SignalCategory.COMMUNITY_INTENT,
          taxonomy:   TAXONOMY_MAP[signal.name] ?? SignalTaxonomy.INTENT,
          weight:     signal.weight,
          sourceUrl:  `https://www.reddit.com${post.permalink}`,
          rawData: {
            title:      post.title,
            selftext:   post.selftext?.slice(0, 500) ?? '',
            subreddit:  post.subreddit,
            searchTerm: term,
            signalName: signal.name,
            created_utc: post.created_utc,
          },
          buyerProfile: BUYER_PROFILE_MAP[signal.name] ?? BuyerProfile.UNKNOWN,
          detectedAt:   new Date(post.created_utc * 1000),
        }

        const result = await ingestSignal(detected)
        if (result.stored) {
          storedSignals++
          const tag = result.qualified ? ' 🔔 QUALIFIED' : ''
          console.log(
            `[Reddit] ✓ u/${post.author} | ${signal.name}${tag}`,
          )
        }
      }
    }
  }

  console.log(`[Reddit] Done — ${storedSignals} stored from ${totalPosts} posts scanned.\n`)
}
