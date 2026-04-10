/**
 * npm run setup
 *
 * Scrapes a client website with Firecrawl, feeds the content to Claude,
 * and writes a fully-configured client.config.ts to the project root.
 * The user reviews the file, adds API keys to .env, then runs npm run dev.
 */

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import prompts from 'prompts'
import Anthropic from '@anthropic-ai/sdk'
import FirecrawlApp from '@mendable/firecrawl-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../')

// ─── Pre-flight checks ────────────────────────────────────────────────────────

function checkEnv() {
  const missing: string[] = []
  if (!process.env.FIRECRAWL_API_KEY) missing.push('FIRECRAWL_API_KEY')
  if (!process.env.ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY')

  if (missing.length > 0) {
    console.error('\n❌ Missing required keys in .env:\n')
    missing.forEach((k) => console.error(`   ${k}=`))
    console.error('\nCopy .env.example → .env and fill in these two keys first.\n')
    process.exit(1)
  }
}

// ─── Scrape ───────────────────────────────────────────────────────────────────

async function scrapeWebsite(url: string): Promise<string> {
  console.log(`\n→ Scraping ${url} with Firecrawl...`)

  const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! })

  // Crawl up to 10 pages: homepage, about, program, pricing, testimonials, etc.
  const result = await firecrawl.crawlUrl(url, {
    limit: 10,
    scrapeOptions: { formats: ['markdown'] },
  })

  if (!result.success || !result.data || result.data.length === 0) {
    throw new Error(`Firecrawl returned no data for ${url}`)
  }

  const pages = result.data
    .filter((p) => p.markdown)
    .map((p) => `## Page: ${p.metadata?.url ?? 'unknown'}\n\n${p.markdown}`)
    .join('\n\n---\n\n')

  console.log(`   ✓ Scraped ${result.data.length} pages`)
  return pages
}

// ─── Claude config generation ─────────────────────────────────────────────────

const CONFIG_SYSTEM_PROMPT = `You are a GTM signal intelligence analyst. You will be given website content and you must generate a production-ready TypeScript configuration file for a GTM signal monitoring engine.

Your output must be ONLY valid TypeScript — no explanation, no markdown fences, just the raw TypeScript file content starting with import statements.

The config must accurately reflect what you read from the website:
- Extract the actual company name, product description, and buyer personas
- Identify the target type: 'individual' (EdTech, training, communities, creator tools, courses) or 'company' (B2B SaaS, tools, agencies, enterprise software)
- Generate realistic signal search terms based on the actual product and audience
- Identify key people (founders, educators, public-facing team members) from the website
- List real competitors mentioned or implied by the content
- Write outreach sequence openers that reference the actual product value propositions
- For suppressionKeywords: include phrases that existing customers/students/alumni would use when self-identifying

The scoring defaults are:
- qualifyThreshold: 50
- urgentThreshold: 40
- urgentSignalCount: 3
- urgentWindowDays: 7
- scoringWindowDays: 30
- requalifyAfterDays: 30
- deduplicationWindowDays: 7`

async function generateConfig(
  websiteContent: string,
  websiteUrl: string,
  targetType: 'individual' | 'company',
): Promise<string> {
  console.log('\n→ Analysing with Claude API...')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const userPrompt = `Website URL: ${websiteUrl}
Target type: ${targetType}

Website content:
${websiteContent.slice(0, 80000)}

Generate the client.config.ts file. It must:
1. Import ClientConfig from './src/types/index.js'
2. Export a single const named \`config\` typed as ClientConfig
3. Use process.env references for all webhook/API key values
4. Include all fields: client, buyerProfiles, scoring, signals, keyPeople, suppressionKeywords, competitors, outreachSequences

For outreach sequences, write them as multi-line template strings with [placeholder] variables for dynamic parts.
The sequences should sound human, specific to this product, and lead with the prospect's world — not the product's features.`

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 16000,
    thinking: { type: 'enabled', budget_tokens: 8000 },
    system: CONFIG_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })

  // Extract text from response (skip thinking blocks)
  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('')

  // Strip markdown code fences if Claude wrapped it anyway
  return text
    .replace(/^```typescript\n?/, '')
    .replace(/^```ts\n?/, '')
    .replace(/\n?```$/, '')
    .trim()
}

// ─── Write config ─────────────────────────────────────────────────────────────

function writeConfig(content: string) {
  const configPath = path.join(ROOT, 'client.config.ts')
  const header = `// ─── Generated by npm run setup ─────────────────────────────────────────────
// Review this file carefully before running npm run dev.
// Commit it once you're happy — it's the single source of truth for this client.
//
// DO NOT commit your .env file.

`
  fs.writeFileSync(configPath, header + content, 'utf-8')
  return configPath
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔═══════════════════════════════════════╗')
  console.log('║       GTM Signal Engine — Setup       ║')
  console.log('╚═══════════════════════════════════════╝\n')

  checkEnv()

  // Support non-interactive mode via CLI args: --url <url> --type individual|company
  const args = process.argv.slice(2)
  const urlArgIdx = args.indexOf('--url')
  const typeArgIdx = args.indexOf('--type')

  let answers: { url: string; targetType: 'individual' | 'company' }

  if (urlArgIdx !== -1 && typeArgIdx !== -1) {
    answers = {
      url: args[urlArgIdx + 1],
      targetType: args[typeArgIdx + 1] as 'individual' | 'company',
    }
    console.log(`→ URL: ${answers.url}`)
    console.log(`→ Target type: ${answers.targetType}\n`)
  } else {
    const prompted = await prompts([
      {
        type: 'text',
        name: 'url',
        message: 'Client website URL:',
        validate: (v: string) =>
          v.startsWith('http') ? true : 'Enter a full URL including https://',
      },
      {
        type: 'select',
        name: 'targetType',
        message: 'Target type:',
        choices: [
          {
            title: 'Individual — EdTech, training, communities, creator tools',
            value: 'individual',
          },
          {
            title: 'Company — B2B SaaS, tools, agencies selling to businesses',
            value: 'company',
          },
        ],
      },
    ])

    if (!prompted.url || !prompted.targetType) {
      console.log('\nSetup cancelled.\n')
      process.exit(0)
    }
    answers = prompted
  }

  const websiteContent = await scrapeWebsite(answers.url)
  const configContent = await generateConfig(
    websiteContent,
    answers.url,
    answers.targetType,
  )

  const configPath = writeConfig(configContent)

  console.log('\n╔═══════════════════════════════════════╗')
  console.log('║             Setup complete            ║')
  console.log('╚═══════════════════════════════════════╝')
  console.log(`\n✓ Config written to: ${configPath}`)
  console.log('\nNext steps:')
  console.log('  1. Review client.config.ts — adjust any search terms or sequences')
  console.log('  2. Fill in remaining API keys in .env (Reddit, Supabase, Serper…)')
  console.log('  3. Run: npx prisma db push')
  console.log('  4. Run: npm run dev\n')
}

main().catch((err) => {
  console.error('\n❌ Setup failed:', err.message ?? err)
  process.exit(1)
})
