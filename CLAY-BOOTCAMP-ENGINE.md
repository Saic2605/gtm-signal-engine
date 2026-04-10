# GTM Signal Engine — Clay Bootcamp

**Status: Live and running as of April 2026**

This document is a plain-English overview of the GTM Signal Engine deployed for Clay Bootcamp. It explains what it monitors, what you'll see in Slack and Google Sheets, and how to turn a detected lead into an outreach.

---

## What It Does

The engine monitors Reddit, LinkedIn, and Hacker News 24/7 for people publicly expressing intent that matches Clay Bootcamp's ideal buyer — before those people have ever heard of Clay Bootcamp.

When someone qualifies, two things happen instantly:
1. A Slack alert fires in `#gtm-alerts`
2. A row appears in the Google Sheet, ready to import into Clay for enrichment and outreach

No manual searching. No missed signals. The engine runs while you sleep.

---

## Who It's Looking For

The engine classifies every detected person into one of two buyer profiles:

### Career Seeker
SDRs, BDRs, and sales reps who want to break into GTM Engineering or learn Clay.

**Signals it detects:**
- "How do I become a GTM Engineer?"
- "I want to learn Clay.com"
- "Tired of manual prospecting as an SDR"
- "Clay workflow help" / "stuck on a Clay build"
- "How to get started with Clay"

### Agency Builder
Freelancers and consultants launching or scaling a Clay/GTM agency.

**Signals it detects:**
- "Starting a Clay agency"
- "Looking for my first Clay client"
- "How do I price GTM Engineering services?"
- "Scaling a Claygency"
- "GTME agency pricing"

---

## Where It Listens

| Source | How Often | How It Works |
|---|---|---|
| **Reddit** | Every hour | Searches 30 keyword phrases across all of Reddit |
| **LinkedIn** | Every day (10am) | Google-indexes LinkedIn posts matching your signals |
| **Hacker News** | Every day (9am) | Searches HN stories and comments via Algolia API |

All three feed into the same scoring pipeline.

---

## How Scoring Works

Every signal carries a weight. Scores accumulate over a 30-day rolling window per person.

| Signal | Weight |
|---|---|
| Clay Bootcamp direct mention | 45 pts |
| Starting a Clay agency | 40 pts |
| GTM Engineering career interest | 35 pts |
| Wants to learn Clay | 30 pts |
| Agency scaling challenges | 30 pts |
| SDR career frustration | 25 pts |
| Clay workflow struggles | 25 pts |
| Company adopted Clay recently | 25 pts |
| Outbound automation learning | 20 pts |
| Hiring GTM Engineers | 20 pts |

**Qualification thresholds:**
- **Standard:** total score ≥ 50
- **URGENT:** 3+ signals in the past 7 days AND score ≥ 40

**Noise filters:**
- Known alumni and current students are suppressed automatically (no alerts for people already in the program)
- Duplicate signals from the same person within 7 days are ignored
- A person won't re-trigger an alert for 30 days after qualifying

---

## What You See in Slack (`#gtm-alerts`)

Every time someone qualifies, a message like this fires:

```
🔵 STANDARD lead qualified — LoveScoutCEO

Handle       LoveScoutCEO
Platform     reddit
Profile      reddit.com/user/LoveScoutCEO
Score        75
Signals      3 in window

Signals detected
• REDDIT_POST (reddit) — Starting a Clay Agency (weight 40)
• REDDIT_POST (reddit) — Agency Scaling Challenges (weight 30)

Triggered at 2026-04-10 · GTM Signal Engine
```

🔴 Red = URGENT (act today) — 🔵 Blue = STANDARD (act this week)

---

## What You See in Google Sheets

Every qualified lead gets a row in the **Leads** tab:

| Date Qualified | Handle | Platform | Profile URL | Buyer Profile | Score | Urgency | Signal Count | Top Signals | Source URLs | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-04-10 | LoveScoutCEO | reddit | reddit.com/user/... | AGENCY_BUILDER | 75 | STANDARD | 3 | REDDIT_POST | urls... | New — Ready for Clay | |

Status defaults to **"New — Ready for Clay"** so you know at a glance what hasn't been worked yet.

---

## How to Turn a Lead Into Outreach (The Clay Step)

1. **Open the Google Sheet** → filter by `Status = New — Ready for Clay`
2. **Export the tab as CSV** (File → Download → CSV)
3. **Import into Clay** → create a new table from the CSV
4. **Run enrichment in Clay:**
   - Reddit handle → find LinkedIn profile (Apollo or LinkedIn enrichment)
   - LinkedIn slug → find email (Hunter, Apollo, or Findymail waterfall)
   - Enrich company name and title
5. **Select the outreach sequence** based on Buyer Profile:
   - `CAREER_SEEKER` → Aspiring GTME / Career Changer sequence
   - `AGENCY_BUILDER` → Agency Founder / Scaling sequence
6. **Send** → update Status in the sheet to "Contacted"

The outreach templates for each buyer profile are in `client.config.ts` → `outreachSequences`.

---

## Proof It's Working

First live run on **2026-04-10**:

| Metric | Result |
|---|---|
| Reddit signals stored (first sweep) | 100+ |
| LinkedIn signals stored (first sweep) | 50+ |
| Leads qualified (first combined run) | 15+ |
| Slack alerts fired | 15+ |
| Google Sheet rows written | 15+ |

**Sample qualified leads from first run:**

| Handle | Platform | Profile | Buyer Profile | Score |
|---|---|---|---|---|
| LoveScoutCEO | Reddit | reddit.com/user/LoveScoutCEO | AGENCY_BUILDER | 75 |
| fintechappdev | Reddit | reddit.com/user/fintechappdev | CAREER_SEEKER | 70 |
| brendan-short | LinkedIn | linkedin.com/in/brendan-short | CAREER_SEEKER | 70 |
| michaelsaruggia | LinkedIn | linkedin.com/in/michaelsaruggia | AGENCY_BUILDER | 65 |
| outboundphd | LinkedIn | linkedin.com/in/outboundphd | AGENCY_BUILDER | 65 |
| Historical-Till-6199 | Reddit | reddit.com/user/Historical-Till-6199 | CAREER_SEEKER | 70 |

---

## Running the Engine

```bash
# Start the engine (runs all collectors + stays alive)
npm run dev

# Regenerate config from your website (run once, or when ICP changes)
npm run setup
```

The engine starts immediately on `npm run dev`:
- Reddit sweeps every hour automatically
- HN sweeps daily at 9am
- LinkedIn sweeps daily at 10am

Qualified leads appear in Slack and Google Sheets in real time.

---

## Key Links

| Resource | Link |
|---|---|
| Google Sheet (Leads) | [GTM Signal Engine — Clay Bootcamp](https://docs.google.com/spreadsheets/d/1SSGxBEL1FSYRjB_E6MS35VtdySDz22ZcAGJvhfjdGm8) |
| Slack channel | `#gtm-alerts` |
| GitHub repo | https://github.com/Saic2605/gtm-signal-engine |
| Clay Bootcamp website | https://www.claybootcamp.com |

---

## Suppression List (Alumni / Current Students)

The engine automatically drops signals from people who are already in the program. Suppression keywords currently configured:

- "Clay Bootcamp graduate / alumni / student"
- "graduated from / joined / enrolled in Clay Bootcamp"
- "Nathan Lippi 🥾"
- "bootcamp 🥾"
- "#GirlsWhoClay"
- "Clay Bootcamp changed my life / tribe / mentor / coach"

To add a handle to the suppression list directly (e.g. a current student's Reddit username), insert a row into the `Suppression` table in Supabase.
