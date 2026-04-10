import { db } from '../db/index.js'
import { config } from '../../client.config.js'

export interface SuppressionResult {
  suppressed: boolean
  reason?: string
}

/**
 * Two-gate suppression check. Runs before any signal is stored.
 *
 * Gate 1 — Handle lookup: is this Reddit/Twitter/LinkedIn handle in the
 *           Suppression table? (alumni, current students, manual blocks)
 *
 * Gate 2 — Keyword scan: does the raw post/comment text contain any
 *           self-identification phrases from suppressionKeywords in config?
 *           e.g. "graduated from Clay Bootcamp", "clay bootcamp alumni"
 */
export async function isSuppressed(
  handle: string,
  rawText?: string,
): Promise<SuppressionResult> {
  // Gate 1 — DB handle lookup
  const entry = await db.suppression.findUnique({
    where: { handle: handle.toLowerCase() },
  })
  if (entry) {
    return {
      suppressed: true,
      reason: `Handle "${handle}" suppressed (${entry.reason ?? entry.platform ?? 'manual'})`,
    }
  }

  // Gate 2 — Keyword scan
  if (rawText) {
    const lower = rawText.toLowerCase()
    for (const kw of config.suppressionKeywords) {
      if (lower.includes(kw.toLowerCase())) {
        return {
          suppressed: true,
          reason: `Keyword match: "${kw}"`,
        }
      }
    }
  }

  return { suppressed: false }
}

/**
 * Add a handle to the suppression list (e.g. when enrichment confirms alumni).
 */
export async function addSuppression(
  handle: string,
  platform: string,
  reason: 'alumni' | 'current_student' | 'manual',
): Promise<void> {
  await db.suppression.upsert({
    where: { handle: handle.toLowerCase() },
    create: { handle: handle.toLowerCase(), platform, reason },
    update: { platform, reason },
  })
}
