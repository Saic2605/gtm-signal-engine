// ─── Re-export Prisma enums so the rest of the codebase imports from one place ─

import type { Individual, Signal } from '@prisma/client'

export { BuyerProfile, SignalCategory, SignalTaxonomy } from '@prisma/client'
export type { Individual, Signal, Suppression } from '@prisma/client'

// ─── Client Config ────────────────────────────────────────────────────────────

export type TargetType = 'individual' | 'company'

export interface ScoringConfig {
  qualifyThreshold: number        // default 50
  urgentThreshold: number         // default 40
  urgentSignalCount: number       // default 3
  urgentWindowDays: number        // default 7
  scoringWindowDays: number       // default 30
  requalifyAfterDays: number      // default 30
  deduplicationWindowDays: number // default 7
}

export interface BuyerProfileConfig {
  role: string
  title: string[]
  seniority: string[]
  triggers: string[]
}

export interface SignalConfig {
  name: string
  description: string
  searchTerms: string[]
  platforms: string[]   // "linkedin" | "twitter" | "reddit" | "hn" | "clay_community" | "ph"
  weight: number
}

export interface KeyPersonConfig {
  name: string
  role?: string
  platform?: string
  profileUrl?: string
  linkedinSlug?: string
  twitterHandle?: string
  isPrimary?: boolean
}

export interface CompetitorConfig {
  name: string
  url?: string
  terms?: string[]
  differentiator?: string
}

export type OutreachChannel = 'linkedin' | 'email' | 'twitter'

export interface OutreachStep {
  channel: OutreachChannel
  delayDays: number
  template: string
}

export interface OutreachSequenceConfig {
  name: string
  steps: OutreachStep[]
}

export interface ClientConfig {
  client: {
    name: string
    website: string
    targetType: TargetType
    industry?: string
    description?: string
    valuePropositions?: string[]
    // Loaded from .env at runtime — optional here so config stays credential-free
    slackAlertsWebhook?: string
    slackReviewWebhook?: string
  }
  buyerProfiles: BuyerProfileConfig[]
  scoring: ScoringConfig
  signals: SignalConfig[]
  keyPeople: KeyPersonConfig[]
  suppressionKeywords: string[]
  competitors: CompetitorConfig[]
  outreachSequences: OutreachSequenceConfig[]
}

// ─── Engine Events ────────────────────────────────────────────────────────────

export type UrgencyLevel = 'URGENT' | 'STANDARD'

export interface QualificationEvent {
  individual: Individual & { signals: Signal[] }
  score: number
  urgency: UrgencyLevel
  windowSignals: Signal[]   // signals within the scoring window
  urgentSignals: Signal[]   // signals within the urgent window
  triggeredAt: Date
}

// ─── Collector Result ─────────────────────────────────────────────────────────

export interface DetectedSignal {
  handle: string
  platform: string
  profileUrl?: string
  signalType: string
  category: import('@prisma/client').SignalCategory
  taxonomy: import('@prisma/client').SignalTaxonomy
  weight: number
  sourceUrl?: string
  rawData: Record<string, unknown>
  buyerProfile: import('@prisma/client').BuyerProfile
  detectedAt?: Date
}
