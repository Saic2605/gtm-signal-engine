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

const SHEET_ID   = process.env.GOOGLE_SHEETS_ID
const SA_JSON    = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
const TAB_LEADS     = 'Leads'
const TAB_DIGEST    = 'Daily Digest'
const TAB_DASHBOARD = 'Dashboard'

// Status options shown in the Leads tab dropdown
const STATUS_OPTIONS = [
  'New — Ready for Clay',
  'In Clay',
  'Contacted',
  'Converted',
  'Not a Fit',
]

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

// ── Dashboard setup ───────────────────────────────────────────────────────────

/**
 * One-time setup: creates the Dashboard tab, writes live-formula content,
 * and applies formatting to the Leads tab (freeze, conditional format,
 * status dropdown, column widths).
 *
 * Safe to re-run — formatting requests are idempotent.
 */
export async function initializeDashboard(): Promise<void> {
  if (!SHEET_ID || !SA_JSON) {
    console.warn('⚠  Google Sheets not configured — skipping dashboard setup')
    return
  }

  const sheets = getSheets()

  // Ensure all tabs exist
  await ensureTab(sheets, TAB_LEADS)
  await ensureTab(sheets, TAB_DIGEST)
  await ensureTab(sheets, TAB_DASHBOARD)

  // Get numeric sheet IDs needed for formatting requests
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID! })
  const sheetMap = Object.fromEntries(
    (meta.data.sheets ?? []).map(s => [s.properties!.title!, s.properties!.sheetId!])
  )
  const leadsId     = sheetMap[TAB_LEADS]
  const dashboardId = sheetMap[TAB_DASHBOARD]

  // ── 1. Write Dashboard content ──────────────────────────────────────────────

  const dashboardValues = [
    // Row 1 — Title
    ['GTM Signal Engine — Clay Bootcamp', '', ''],
    // Row 2 — Last updated
    ['Last Updated', '=NOW()', ''],
    ['', '', ''],
    // Row 4 — Overview header
    ['OVERVIEW', '', ''],
    ['Total Leads Qualified',  '=COUNTA(Leads!B2:B)', ''],
    ['URGENT',                 '=COUNTIF(Leads!G:G,"URGENT")', ''],
    ['STANDARD',               '=COUNTIF(Leads!G:G,"STANDARD")', ''],
    ['', '', ''],
    // Row 9 — By Platform
    ['BY PLATFORM', '', ''],
    ['Reddit',       '=COUNTIF(Leads!C:C,"reddit")',   ''],
    ['LinkedIn',     '=COUNTIF(Leads!C:C,"linkedin")', ''],
    ['Hacker News',  '=COUNTIF(Leads!C:C,"hn")',       ''],
    ['', '', ''],
    // Row 14 — By Buyer Profile
    ['BY BUYER PROFILE', '', ''],
    ['Career Seeker',  '=COUNTIF(Leads!E:E,"CAREER_SEEKER")', ''],
    ['Agency Builder', '=COUNTIF(Leads!E:E,"AGENCY_BUILDER")', ''],
    ['Unknown',        '=COUNTIF(Leads!E:E,"UNKNOWN")', ''],
    ['', '', ''],
    // Row 19 — By Status
    ['BY STATUS', '', ''],
    ['New — Ready for Clay', '=COUNTIF(Leads!K:K,"New — Ready for Clay")', ''],
    ['In Clay',              '=COUNTIF(Leads!K:K,"In Clay")',              ''],
    ['Contacted',            '=COUNTIF(Leads!K:K,"Contacted")',            ''],
    ['Converted',            '=COUNTIF(Leads!K:K,"Converted")',            ''],
    ['Not a Fit',            '=COUNTIF(Leads!K:K,"Not a Fit")',            ''],
    ['', '', ''],
    // Row 26 — Top Leads
    ['TOP 5 LEADS BY SCORE', '', ''],
    ['Handle', 'Platform', 'Score', 'Buyer Profile', 'Status'],
    ...Array.from({ length: 5 }, (_, i) => [
      `=IFERROR(INDEX(Leads!B:B,MATCH(LARGE(Leads!F:F,${i + 1}),Leads!F:F,0)),"")`,
      `=IFERROR(INDEX(Leads!C:C,MATCH(LARGE(Leads!F:F,${i + 1}),Leads!F:F,0)),"")`,
      `=IFERROR(LARGE(Leads!F:F,${i + 1}),"")`,
      `=IFERROR(INDEX(Leads!E:E,MATCH(LARGE(Leads!F:F,${i + 1}),Leads!F:F,0)),"")`,
      `=IFERROR(INDEX(Leads!K:K,MATCH(LARGE(Leads!F:F,${i + 1}),Leads!F:F,0)),"")`,
    ]),
  ]

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID!,
    range: `${TAB_DASHBOARD}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: dashboardValues },
  })
  console.log('[Sheets] Dashboard content written')

  // ── 2. Batch formatting requests ────────────────────────────────────────────

  // Helper: solid color object
  const rgb = (r: number, g: number, b: number) => ({
    red: r, green: g, blue: b,
  })

  // Section header rows in Dashboard (0-indexed): 0=title, 3=OVERVIEW, 8=PLATFORM, 13=PROFILE, 18=STATUS, 25=TOP5, 26=top5header
  const sectionRows = [0, 3, 8, 13, 18, 25, 26]
  const sectionFormatRequests = sectionRows.map(rowIndex => ({
    repeatCell: {
      range: { sheetId: dashboardId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: 5 },
      cell: {
        userEnteredFormat: {
          backgroundColor: rowIndex === 0 ? rgb(0.13, 0.24, 0.45) : rgb(0.23, 0.47, 0.78),
          textFormat: {
            bold: true,
            foregroundColor: rgb(1, 1, 1),
            fontSize: rowIndex === 0 ? 13 : 11,
          },
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat)',
    },
  }))

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID!,
    requestBody: {
      requests: [
        // ── Dashboard: freeze row 1 ──
        {
          updateSheetProperties: {
            properties: { sheetId: dashboardId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },

        // ── Dashboard: column widths ──
        {
          updateDimensionProperties: {
            range: { sheetId: dashboardId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
            properties: { pixelSize: 220 },
            fields: 'pixelSize',
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId: dashboardId, dimension: 'COLUMNS', startIndex: 1, endIndex: 5 },
            properties: { pixelSize: 160 },
            fields: 'pixelSize',
          },
        },

        // ── Dashboard: section header colours ──
        ...sectionFormatRequests,

        // ── Leads: freeze row 1 ──
        {
          updateSheetProperties: {
            properties: { sheetId: leadsId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },

        // ── Leads: header row bold + dark blue ──
        {
          repeatCell: {
            range: { sheetId: leadsId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: rgb(0.13, 0.24, 0.45),
                textFormat: { bold: true, foregroundColor: rgb(1, 1, 1) },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          },
        },

        // ── Leads: URGENT rows → light red background ──
        {
          addConditionalFormatRule: {
            rule: {
              ranges: [{ sheetId: leadsId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 12 }],
              booleanRule: {
                condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=$G2="URGENT"' }] },
                format: { backgroundColor: rgb(0.96, 0.80, 0.80) },
              },
            },
            index: 0,
          },
        },

        // ── Leads: STANDARD rows → light blue background ──
        {
          addConditionalFormatRule: {
            rule: {
              ranges: [{ sheetId: leadsId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 12 }],
              booleanRule: {
                condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=$G2="STANDARD"' }] },
                format: { backgroundColor: rgb(0.81, 0.89, 0.98) },
              },
            },
            index: 1,
          },
        },

        // ── Leads: Status column dropdown (col K = index 10) ──
        {
          setDataValidation: {
            range: { sheetId: leadsId, startRowIndex: 1, startColumnIndex: 10, endColumnIndex: 11 },
            rule: {
              condition: {
                type: 'ONE_OF_LIST',
                values: STATUS_OPTIONS.map(v => ({ userEnteredValue: v })),
              },
              showCustomUi: true,
              strict: false,
            },
          },
        },

        // ── Leads: column widths ──
        { updateDimensionProperties: { range: { sheetId: leadsId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 180 }, fields: 'pixelSize' } }, // Date
        { updateDimensionProperties: { range: { sheetId: leadsId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 180 }, fields: 'pixelSize' } }, // Handle
        { updateDimensionProperties: { range: { sheetId: leadsId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 100 }, fields: 'pixelSize' } }, // Platform
        { updateDimensionProperties: { range: { sheetId: leadsId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 220 }, fields: 'pixelSize' } }, // Profile URL
        { updateDimensionProperties: { range: { sheetId: leadsId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 150 }, fields: 'pixelSize' } }, // Buyer Profile
        { updateDimensionProperties: { range: { sheetId: leadsId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 70 },  fields: 'pixelSize' } }, // Score
        { updateDimensionProperties: { range: { sheetId: leadsId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 100 }, fields: 'pixelSize' } }, // Urgency
        { updateDimensionProperties: { range: { sheetId: leadsId, dimension: 'COLUMNS', startIndex: 7, endIndex: 8 }, properties: { pixelSize: 100 }, fields: 'pixelSize' } }, // Signal Count
        { updateDimensionProperties: { range: { sheetId: leadsId, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 200 }, fields: 'pixelSize' } }, // Top Signals
        { updateDimensionProperties: { range: { sheetId: leadsId, dimension: 'COLUMNS', startIndex: 9, endIndex: 10 }, properties: { pixelSize: 280 }, fields: 'pixelSize' } }, // Source URLs
        { updateDimensionProperties: { range: { sheetId: leadsId, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 }, properties: { pixelSize: 180 }, fields: 'pixelSize' } }, // Status
        { updateDimensionProperties: { range: { sheetId: leadsId, dimension: 'COLUMNS', startIndex: 11, endIndex: 12 }, properties: { pixelSize: 200 }, fields: 'pixelSize' } }, // Notes
      ],
    },
  })

  console.log('[Sheets] ✓ Dashboard formatting applied')
  console.log('[Sheets] ✓ Leads tab: frozen header, conditional format, status dropdown, column widths set')
  console.log('[Sheets] Dashboard setup complete.')
}
