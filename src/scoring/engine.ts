import type { Signal } from '@prisma/client'
import { db } from '../db/index.js'
import { config } from '../../client.config.js'
import type { UrgencyLevel } from '../types/index.js'

export interface ScoreResult {
  score: number
  windowSignals: Signal[]   // all signals within scoringWindowDays
  urgentSignals: Signal[]   // signals within urgentWindowDays
  qualified: boolean
  urgency: UrgencyLevel | null
}

/**
 * Recalculates an individual's score using a rolling window of signals.
 * Signals older than scoringWindowDays do not count — they fall out naturally.
 * Updates Individual.score in the database.
 *
 * Qualification paths:
 *   STANDARD — score ≥ qualifyThreshold (default 50)
 *   URGENT   — 3+ signals in 7 days AND score ≥ urgentThreshold (default 40)
 */
export async function recalculateScore(individualId: string): Promise<ScoreResult> {
  const { scoringWindowDays, urgentWindowDays, urgentSignalCount, urgentThreshold, qualifyThreshold } =
    config.scoring

  const now = new Date()
  const windowStart = new Date(now.getTime() - scoringWindowDays * 24 * 60 * 60 * 1000)
  const urgentStart = new Date(now.getTime() - urgentWindowDays * 24 * 60 * 60 * 1000)

  // All signals in the scoring window (30 days)
  const windowSignals = await db.signal.findMany({
    where: { individualId, detectedAt: { gte: windowStart } },
    orderBy: { detectedAt: 'desc' },
  })

  const score = windowSignals.reduce((sum, s) => sum + s.weight, 0)

  // Subset within the urgency window (7 days)
  const urgentSignals = windowSignals.filter((s) => s.detectedAt >= urgentStart)

  // Determine qualification path
  const isUrgent = urgentSignals.length >= urgentSignalCount && score >= urgentThreshold
  const isStandard = score >= qualifyThreshold

  const qualified = isUrgent || isStandard
  const urgency: UrgencyLevel | null = isUrgent ? 'URGENT' : isStandard ? 'STANDARD' : null

  // Persist updated score
  await db.individual.update({
    where: { id: individualId },
    data: { score },
  })

  return { score, windowSignals, urgentSignals, qualified, urgency }
}
