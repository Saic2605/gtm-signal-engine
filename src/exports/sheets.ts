/**
 * Google Sheets exporter — appends qualified leads to the GTM Signal Engine
 * sheet so they can be imported into Clay for enrichment and outreach.
 *
 * Two entry points:
 *   appendLeadRow()  — called on every lead.qualified event (real-time)
 *   appendDailyDigest() — called by the 9am daily cron (summary row)
 *
 * Sheet columns (row 1 is a header, appended automatically on first run):
 *   Date Qualified | Handle | Platform | Profile URL | Buyer Profile |
 *   Score | Urgency | Signal Count | Top Signals | Source URLs |
 *   Status | Notes
 */

import { google } from 'googleapis'
import type { QualificationEvent } from '../types/index.js'

const SHEET_ID  = process.env.GOOGLE_SHEETS_ID
const SA_JSON   = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
const TAB_LEADS  = 'Leads'
const TAB_DIGEST = 'Daily Digest'

// ── Auth ──────────────────────────────────────────────────────────────────────

function getSheets() {
  if (!SHEET_ID || !SA_JSON) {
    throw new Error('GOOGLE_SHEETS_ID or GOOGLE_SERVICE_ACCOUNT_JSON not set in .env')
  }

  const credentials = JSON.parse(SA_JSON) as {
    client_email: string
    private_key: string
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })

  return google.sheets({ version: 'v4', auth })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ensureTab(sheets: ReturnType<typeof getSheets>, tab: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID! })
  const exists = meta.data.sheets?.some(s => s.properties?.title === tab)
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID!,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tab } } }],
      },
    })
    console.log(`[Sheets] Created tab "${tab}"`)
  }
}

async function ensureHeader(tab: string, headers: string[]): Promise<void> {
  const sheets = getSheets()

  // Create the tab if it doesn't exist
  await ensureTab(sheets, tab)

  // Read row 1 to check if header row exists
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID!,
    range: `${tab}!A1:Z1`,
  })

  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID!,
      range: `${tab}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    })
    console.log(`[Sheets] Created header row in "${tab}"`)
  }
}

async function appendRow(tab: string, row: (string | number)[]): Promise<void> {
  const sheets = getSheets()
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID!,
    range: `${tab}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  })
}

// ── Lead row ──────────────────────────────────────────────────────────────────

const LEAD_HEADERS = [
  'Date Qualified',
  'Handle',
  'Platform',
  'Profile URL',
  'Buyer Profile',
  'Score',
  'Urgency',
  'Signal Count',
  'Top Signals',
  'Source URLs',
  'Status',
  'Notes',
]

export async function appendLeadRow(event: QualificationEvent): Promise<void> {
  if (!SHEET_ID || !SA_JSON) {
    console.warn('⚠  Google Sheets not configured — skipping sheet export')
    return
  }

  const { individual, score, urgency, windowSignals, triggeredAt } = event

  // Deduplicate signal names for the "Top Signals" column
  const topSignals = [...new Set(windowSignals.map(s => s.type))].slice(0, 5).join(', ')

  // Collect unique source URLs
  const sourceUrls = windowSignals
    .map(s => s.sourceUrl)
    .filter(Boolean)
    .slice(0, 5)
    .join('\n')

  const row = [
    triggeredAt.toISOString(),
    individual.handle ?? '',
    individual.platform ?? '',
    individual.profileUrl ?? '',
    individual.buyerProfile,
    score,
    urgency,
    windowSignals.length,
    topSignals,
    sourceUrls,
    'New — Ready for Clay',
    '',
  ]

  await ensureHeader(TAB_LEADS, LEAD_HEADERS)
  await appendRow(TAB_LEADS, row)

  console.log(`[Sheets] ✓ Appended lead row for ${individual.handle}`)
}

// ── Daily digest row ──────────────────────────────────────────────────────────

const DIGEST_HEADERS = [
  'Date',
  'New Leads Qualified',
  'Total Signals Stored',
  'Top Handle',
  'Top Score',
  'Notes',
]

export async function appendDailyDigest(stats: {
  date: string
  newLeads: number
  totalSignals: number
  topHandle: string
  topScore: number
}): Promise<void> {
  if (!SHEET_ID || !SA_JSON) return

  const row = [
    stats.date,
    stats.newLeads,
    stats.totalSignals,
    stats.topHandle,
    stats.topScore,
    '',
  ]

  await ensureHeader(TAB_DIGEST, DIGEST_HEADERS)
  await appendRow(TAB_DIGEST, row)

  console.log(`[Sheets] ✓ Daily digest appended for ${stats.date}`)
}
