import type { Individual } from '@prisma/client'
import { db } from '../db/index.js'
import { emitLeadQualified } from '../bus/index.js'
import { config } from '../../client.config.js'
import type { ScoreResult } from './engine.js'

/**
 * Checks whether a freshly-scored individual should fire a qualification event.
 *
 * Guards:
 *   1. Must be qualified (score meets threshold or urgent path triggered)
 *   2. Re-qualification guard: 30 days must have passed since last qualification
 *      to prevent alert spam for individuals who stay above threshold
 *
 * On qualification: updates Individual.qualified + lastQualifiedAt, then
 * emits 'lead.qualified' on the event bus for Slack/Sheets/enrichment handlers.
 */
export async function checkAndQualify(
  individual: Individual,
  result: ScoreResult,
): Promise<boolean> {
  if (!result.qualified || !result.urgency) return false

  // Re-qualification guard
  if (individual.lastQualifiedAt) {
    const daysSince =
      (Date.now() - individual.lastQualifiedAt.getTime()) / (1000 * 60 * 60 * 24)
    if (daysSince < config.scoring.requalifyAfterDays) return false
  }

  // Mark as qualified and record timestamp
  const updated = await db.individual.update({
    where: { id: individual.id },
    data: { qualified: true, lastQualifiedAt: new Date() },
    include: { signals: true },
  })

  // Fire the event — Slack alert and Sheets write handlers listen here
  emitLeadQualified({
    individual: updated,
    score: result.score,
    urgency: result.urgency,
    windowSignals: result.windowSignals,
    urgentSignals: result.urgentSignals,
    triggeredAt: new Date(),
  })

  return true
}
