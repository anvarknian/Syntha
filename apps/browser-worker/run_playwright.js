require('./otel')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { chromium } = require('playwright')
const { normalizeEvent, withIntegrity } = require('../../services/replay-engine/event_schema')

function deterministicSeed(input) {
  const hash = crypto.createHash('sha256').update(input).digest()
  return hash.readInt32BE(0)
}

function nextEventSequence(filePath) {
  if (!fs.existsSync(filePath)) return 1
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
  return lines.length + 1
}

async function run() {
  const dataDir = path.resolve(__dirname, '../../data')
  const artifactsDir = path.join(dataDir, 'artifacts')
  const eventsDir = path.join(dataDir, 'events')
  const runID = process.env.BROWSER_WORKER_RUN_ID || `browser-worker-${process.pid}`
  const targetURL = process.env.PLAYWRIGHT_TARGET_URL || 'about:blank'
  if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true })
  if (!fs.existsSync(eventsDir)) fs.mkdirSync(eventsDir, { recursive: true })

  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(targetURL, { waitUntil: 'domcontentloaded', timeout: 30000 })
  const screenshotPath = path.join(artifactsDir, `screenshot-${Date.now()}.png`)
  await page.screenshot({ path: screenshotPath })
  await browser.close()

  const rawEvent = {
    id: `playwright-${Date.now()}`,
    timestamp: new Date().toISOString(),
    kind: 'playwright_run',
    seed: deterministicSeed(targetURL),
    payload: { url: targetURL, screenshot: path.basename(screenshotPath) },
    metadata: {
      worker: 'browser-worker-playwright',
      expected_status: targetURL === 'about:blank' ? '204' : '200',
    },
  }
  const eventsFile = path.join(eventsDir, 'playwright.jsonl')
  const sequence = nextEventSequence(eventsFile)
  const event = withIntegrity(normalizeEvent(rawEvent, {
    runID,
    sourceFile: 'playwright.jsonl',
    sourceLine: sequence,
  }), sequence)

  const line = JSON.stringify(event) + '\n'
  fs.appendFileSync(eventsFile, line)
  console.log('Wrote event and screenshot:', screenshotPath)
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
