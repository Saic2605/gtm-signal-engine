/**
 * npm run dev — main engine entry point
 *
 * Loads config, connects to the database, registers cron jobs for all
 * enabled collectors, and starts listening for qualification events.
 *
 * Phases 2–6 will populate the collectors and action handlers imported here.
 */

import 'dotenv/config'
import cron from 'node-cron'
import { db } from './db/index.js'
import { bus, onLeadQualified } from './bus/index.js'
import { sendLeadAlert } from './alerts/slack.js'
import { runRedditCollector } from './collectors/reddit.js'
import { runHNCollector } from './collectors/hn.js'
import { runLinkedInCollector } from './collectors/linkedin.js'
import { appendLeadRow } from './exports/sheets.js'
import type { QualificationEvent } from './types/index.js'

async function main() {
  console.log('\n╔═══════════════════════════════════════╗')
  console.log('║        GTM Signal Engine — Dev        ║')
  console.log('╚═══════════════════════════════════════╝\n')

  // Verify database connection
  await db.$connect()
  console.log('✓ Database connected')

  // Verify config exists
  try {
    await import('../client.config.js')
    console.log('✓ client.config.ts loaded')
  } catch {
    console.error(
      '❌ client.config.ts not found. Run npm run setup first.',
    )
    process.exit(1)
  }

  // Register qualification handler
  onLeadQualified((event: QualificationEvent) => {
    const { individual, score, urgency } = event
    console.log(
      `\n🔔 lead.qualified — ${individual.handle} (${individual.platform}) | score: ${score} | ${urgency}`,
    )
    sendLeadAlert(event).catch(err =>
      console.error('[Slack] Alert error:', (err as Error).message ?? err),
    )
    appendLeadRow(event).catch(err =>
      console.error('[Sheets] Export error:', (err as Error).message ?? err),
    )
  })

  // ── Collectors ──────────────────────────────────────────────────────────
  // Reddit: run once on startup, then every hour
  runRedditCollector().catch(err => console.error('[Reddit] Collector error:', err))
  cron.schedule('0 * * * *', () => {
    runRedditCollector().catch(err => console.error('[Reddit] Collector error:', err))
  })

  // HN: run once on startup, then daily at 9am
  runHNCollector().catch(err => console.error('[HN] Collector error:', err))
  cron.schedule('0 9 * * *', () => {
    runHNCollector().catch(err => console.error('[HN] Collector error:', err))
  })

  // LinkedIn: run once on startup, then daily at 10am
  runLinkedInCollector().catch(err => console.error('[LinkedIn] Collector error:', err))
  cron.schedule('0 10 * * *', () => {
    runLinkedInCollector().catch(err => console.error('[LinkedIn] Collector error:', err))
  })

  console.log('\n→ Engine running. Reddit (hourly) + HN (9am) + LinkedIn (10am) collectors active.\n')
  console.log('  Event bus ready:', bus.listenerCount('lead.qualified'), 'handler(s) registered')

  // Keep the process alive
  process.on('SIGINT', async () => {
    console.log('\n→ Shutting down...')
    await db.$disconnect()
    process.exit(0)
  })
}

main().catch(async (err) => {
  console.error('Fatal error:', err)
  await db.$disconnect()
  process.exit(1)
})
