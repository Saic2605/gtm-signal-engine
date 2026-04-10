import { BuyerProfile } from '@prisma/client'
import { db } from '../db/index.js'
import { config } from '../../client.config.js'
import type { DetectedSignal } from '../types/index.js'
import { isSuppressed } from './suppress.js'
import { recalculateScore } from './engine.js'
import { checkAndQualify } from './qualify.js'

export interface IngestResult {
  stored: boolean
  reason?: string
  qualified?: boolean
}

/**
 * Main entry point for every signal a collector finds.
 *
 * Pipeline:
 *   1. Suppression — drop if handle or text matches
 *   2. Upsert Individual — find or create by (handle, platform)
 *   3. Deduplication — drop if same signal type+source seen within dedup window
 *   4. Store Signal
 *   5. Recalculate score (rolling 30-day window)
 *   6. Check qualification — emit lead.qualified if threshold crossed
 */
export async function ingestSignal(detected: DetectedSignal): Promise<IngestResult> {
  const rawText = typeof detected.rawData === 'object'
    ? JSON.stringify(detected.rawData)
    : String(detected.rawData)

  // ── 1. Suppression ────────────────────────────────────────────────────────
  const suppression = await isSuppressed(detected.handle, rawText)
  if (suppression.suppressed) {
    return { stored: false, reason: suppression.reason }
  }

  // ── 2. Upsert Individual ──────────────────────────────────────────────────
  const individual = await db.individual.upsert({
    where: {
      handle_platform: {
        handle: detected.handle,
        platform: detected.platform,
      },
    },
    create: {
      handle: detected.handle,
      platform: detected.platform,
      profileUrl: detected.profileUrl,
      buyerProfile: detected.buyerProfile,
    },
    update: {
      // Keep profileUrl fresh; upgrade buyer profile from UNKNOWN if we know now
      ...(detected.profileUrl ? { profileUrl: detected.profileUrl } : {}),
      ...(detected.buyerProfile !== BuyerProfile.UNKNOWN
        ? { buyerProfile: detected.buyerProfile }
        : {}),
    },
  })

  // ── 3. Deduplication ─────────────────────────────────────────────────────
  const dedupStart = new Date(
    Date.now() - config.scoring.deduplicationWindowDays * 24 * 60 * 60 * 1000,
  )
  const duplicate = await db.signal.findFirst({
    where: {
      individualId: individual.id,
      type: detected.signalType,
      source: detected.platform,
      // If sourceUrl provided, deduplicate on exact URL; otherwise deduplicate
      // on type+source within window (prevents same search term firing twice)
      ...(detected.sourceUrl ? { sourceUrl: detected.sourceUrl } : {}),
      detectedAt: { gte: dedupStart },
    },
  })
  if (duplicate) {
    return { stored: false, reason: `Duplicate signal within ${config.scoring.deduplicationWindowDays}-day window` }
  }

  // ── 4. Store Signal ───────────────────────────────────────────────────────
  try {
    await db.signal.create({
      data: {
        individualId: individual.id,
        type: detected.signalType,
        category: detected.category,
        taxonomy: detected.taxonomy,
        weight: detected.weight,
        source: detected.platform,
        sourceUrl: detected.sourceUrl ?? null,
        rawData: detected.rawData as object,
        buyerProfile: detected.buyerProfile,
        detectedAt: detected.detectedAt ?? new Date(),
      },
    })
  } catch (err: unknown) {
    // P2002 = unique constraint violation — treat as duplicate
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
      return { stored: false, reason: 'Duplicate signal (constraint)' }
    }
    throw err
  }

  // ── 5. Recalculate score ──────────────────────────────────────────────────
  const scoreResult = await recalculateScore(individual.id)

  // ── 6. Qualification check ────────────────────────────────────────────────
  const qualified = await checkAndQualify(individual, scoreResult)

  return { stored: true, qualified }
}
