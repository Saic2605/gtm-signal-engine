/**
 * Slack alert handler — posts to #gtm-alerts on lead.qualified events.
 *
 * URGENT leads get a red header block with all signals listed.
 * STANDARD leads get a blue header block with a summary.
 *
 * Uses Block Kit so messages are readable at a glance in Slack.
 */

import type { QualificationEvent } from '../types/index.js'

const ALERTS_WEBHOOK = process.env.SLACK_ALERTS_WEBHOOK

/**
 * Posts a lead qualification alert to #gtm-alerts.
 * Silently skips if SLACK_ALERTS_WEBHOOK is not set.
 */
export async function sendLeadAlert(event: QualificationEvent): Promise<void> {
  if (!ALERTS_WEBHOOK) {
    console.warn('⚠  SLACK_ALERTS_WEBHOOK not set — skipping Slack alert')
    return
  }

  const { individual, score, urgency, windowSignals, urgentSignals, triggeredAt } = event

  const isUrgent = urgency === 'URGENT'
  const emoji = isUrgent ? '🔴' : '🔵'
  const label = isUrgent ? 'URGENT' : 'STANDARD'
  const color = isUrgent ? '#E01E5A' : '#2EB886'

  // Build signal list (show urgent ones first for URGENT leads)
  const signalsToShow = isUrgent
    ? [...new Map([...urgentSignals, ...windowSignals].map(s => [s.id, s])).values()]
    : windowSignals
  const signalLines = signalsToShow
    .slice(0, 8) // cap at 8 to avoid wall-of-text
    .map(s => `• ${s.type} (${s.source}) — weight ${s.weight}`)
    .join('\n')

  const profileUrl = individual.profileUrl
    ? `<${individual.profileUrl}|${individual.handle}>`
    : `*${individual.handle}*`

  const body = {
    attachments: [
      {
        color,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `${emoji} ${label} lead qualified — ${individual.handle}`,
              emoji: true,
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Handle*\n${profileUrl}` },
              { type: 'mrkdwn', text: `*Platform*\n${individual.platform}` },
              { type: 'mrkdwn', text: `*Score*\n${score}` },
              { type: 'mrkdwn', text: `*Signals (window)*\n${windowSignals.length}` },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Signals detected*\n${signalLines || '_none recorded_'}`,
            },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Triggered at ${triggeredAt.toISOString()} · GTM Signal Engine`,
              },
            ],
          },
        ],
      },
    ],
  }

  const res = await fetch(ALERTS_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    console.error(`❌ Slack alert failed: ${res.status} ${await res.text()}`)
  }
}
