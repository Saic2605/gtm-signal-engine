/**
 * npm run dev — main engine entry point
 *
 * Loads config, connects to the database, registers cron jobs for all
 * enabled collectors, and starts listening for qualification events.
 *
 * Phases 2–6 will populate the collectors and action handlers imported here.
 */

import 'dotenv/config'
import { db } from './db/index.js'
import { bus, onLeadQualified } from './bus/index.js'
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

  // Register qualification handler (Slack + Sheets added in Phase 3/5)
  onLeadQualified((event: QualificationEvent) => {
    const { individual, score, urgency } = event
    console.log(
      `\n🔔 lead.qualified — ${individual.handle} (${individual.platform}) | score: ${score} | ${urgency}`,
    )
  })

  console.log('\n→ Engine running. Collectors will start in Phase 3.\n')
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
