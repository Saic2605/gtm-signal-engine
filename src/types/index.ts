// ─── Re-export Prisma enums so the rest of the codebase imports from one place ─

export { BuyerProfile, SignalCategory, SignalTaxonomy } from '@prisma/client'
export type { Individual, Signal, Suppression } from '@prisma/client'

// ─── Client Config ────────────────────────────────────────────────────────────

export type TargetType = 'individual' | 'company'

export interface ScoringConfig {
  qualifyThreshold: number       // default 50
  urgentThreshold: number        // default 40
  urgentSignalCount: number      // default 3
  urgentWindowDays: number       // default 7
  scoringWindowDays: number      // default 30
  requalifyAfterDays: number     // default 30
  deduplicationWindowDays: number // default 7
}

export interface RedditSignalConfig {
  subreddits: string[]
  careerSeekerTerms?: string[]
  agencyBuilderTerms?: string[]
  brandTerms: string[]
  competitorTerms: string[]
}

export interface HNSignalConfig {
  careerSeekerTerms?: string[]
  agencyBuilderTerms?: string[]
  brandTerms: string[]
  competitorTerms: string[]
}

export interface ClayCommunityConfig {
  triggerPhrases: string[]
}

export interface TwitterConfig {
  handles: string[]      // e.g. ["nathanlippi"]
  brandTerms: string[]
}

export interface SignalsConfig {
  reddit?: RedditSignalConfig
  hn?: HNSignalConfig
  clayCommunity?: ClayCommunityConfig
  twitter?: TwitterConfig
}

export interface KeyPerson {
  name: string
  linkedinSlug?: string
  twitterHandle?: string
}

export interface Competitor {
  name: string
  terms: string[]
}

export interface OutreachSequences {
  careerSeekerCommunityIntent?: string
  careerSeekerCompetitorSignal?: string
  agencyBuilderCommunityIntent?: string
  agencyBuilderCompetitorSignal?: string
  authorityEngagement?: string
  brandSignal?: string
}

export interface ClientConfig {
  client: {
    name: string
    website: string
    targetType: TargetType
    slackAlertsWebhook: string
    slackReviewWebhook: string
  }
  buyerProfiles: import('@prisma/client').BuyerProfile[]
  scoring: ScoringConfig
  signals: SignalsConfig
  keyPeople: KeyPerson[]
  suppressionKeywords: string[]  // alumni self-identification phrases
  competitors: Competitor[]
  outreachSequences: OutreachSequences
}

// ─── Engine Events ────────────────────────────────────────────────────────────

export type UrgencyLevel = 'URGENT' | 'STANDARD'

export interface QualificationEvent {
  individual: Individual & { signals: Signal[] }
  score: number
  urgency: UrgencyLevel
  windowSignals: Signal[]       // signals within the scoring window
  urgentSignals: Signal[]       // signals within the urgent window
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
