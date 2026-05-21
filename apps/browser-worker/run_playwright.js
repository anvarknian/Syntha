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

function parseURLs(targetURL, extraURLsRaw) {
  const extras = String(extraURLsRaw || '')
    .split(',')
    .map(url => url.trim())
    .filter(Boolean)
  return [targetURL, ...extras]
}

function boolFromEnv(name, defaultValue) {
  const value = process.env[name]
  if (value === undefined) return defaultValue
  return /^(1|true|yes)$/i.test(value)
}

async function hasCaptchaSignal(page) {
  const selectors = [
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    '.g-recaptcha',
    '[data-sitekey]',
    'input[name*="captcha" i]',
  ]

  for (const selector of selectors) {
    if (await page.locator(selector).count() > 0) {
      return true
    }
  }

  const html = (await page.content()).toLowerCase()
  return html.includes('captcha') || html.includes('recaptcha') || html.includes('hcaptcha')
}

async function run() {
  const dataDir = path.resolve(__dirname, '../../data')
  const artifactsDir = path.join(dataDir, 'artifacts')
  const eventsDir = path.join(dataDir, 'events')
  const domSnapshotsDir = path.join(dataDir, 'dom-snapshots')
  const sessionDir = path.join(dataDir, 'browser-sessions')
  const runID = process.env.BROWSER_WORKER_RUN_ID || `browser-worker-${process.pid}`
  const targetURL = process.env.PLAYWRIGHT_TARGET_URL || 'about:blank'
  const urls = parseURLs(targetURL, process.env.PLAYWRIGHT_EXTRA_URLS)
  const sessionID = process.env.PLAYWRIGHT_SESSION_ID || 'default'
  const persistSession = boolFromEnv('PLAYWRIGHT_PERSIST_SESSION', true)
  const captureDOM = boolFromEnv('PLAYWRIGHT_CAPTURE_DOM', true)
  const captchaTimeoutMS = parseInt(process.env.PLAYWRIGHT_CAPTCHA_TIMEOUT_MS || '2000', 10)

  fs.mkdirSync(artifactsDir, { recursive: true })
  fs.mkdirSync(eventsDir, { recursive: true })
  fs.mkdirSync(domSnapshotsDir, { recursive: true })
  fs.mkdirSync(sessionDir, { recursive: true })

  const storageStatePath = path.join(sessionDir, `${sessionID}.json`)
  const contextOptions = {}
  if (persistSession && fs.existsSync(storageStatePath)) {
    contextOptions.storageState = storageStatePath
  }

  const browser = await chromium.launch()
  const context = await browser.newContext(contextOptions)

  const tabs = []
  let sessionLoaded = false

  if (persistSession && fs.existsSync(storageStatePath)) {
    sessionLoaded = true
  }

  for (let idx = 0; idx < urls.length; idx++) {
    const url = urls[idx]
    const page = await context.newPage()
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

    const captchaDetected = await hasCaptchaSignal(page)
    if (captchaDetected && captchaTimeoutMS > 0) {
      await page.waitForTimeout(captchaTimeoutMS)
    }

    const suffix = `${Date.now()}-tab${idx + 1}`
    const screenshotName = `screenshot-${suffix}.png`
    const screenshotPath = path.join(artifactsDir, screenshotName)
    await page.screenshot({ path: screenshotPath, fullPage: true })

    let domSnapshotName = null
    if (captureDOM) {
      domSnapshotName = `dom-${suffix}.html`
      const domSnapshotPath = path.join(domSnapshotsDir, domSnapshotName)
      const content = await page.content()
      fs.writeFileSync(domSnapshotPath, content, 'utf8')
    }

    tabs.push({
      tab_index: idx + 1,
      requested_url: url,
      final_url: page.url(),
      title: await page.title(),
      status: response ? response.status() : (url === 'about:blank' ? 204 : null),
      captcha_detected: captchaDetected,
      screenshot: screenshotName,
      dom_snapshot: domSnapshotName,
    })

    await page.close()
  }

  if (persistSession) {
    await context.storageState({ path: storageStatePath })
  }

  await context.close()
  await browser.close()

  const rawEvent = {
    id: `playwright-${Date.now()}`,
    timestamp: new Date().toISOString(),
    kind: 'playwright_run',
    seed: deterministicSeed(urls.join('|')),
    payload: {
      url: targetURL,
      tab_count: tabs.length,
      tabs,
      screenshot: tabs[0] ? tabs[0].screenshot : null,
      dom_snapshot: tabs[0] ? tabs[0].dom_snapshot : null,
      session_id: sessionID,
      session_loaded: sessionLoaded,
      session_persisted: persistSession,
    },
    metadata: {
      worker: 'browser-worker-playwright',
      expected_status: String(tabs[0] && tabs[0].status ? tabs[0].status : 200),
    },
  }

  const eventsFile = path.join(eventsDir, 'playwright.jsonl')
  const sequence = nextEventSequence(eventsFile)
  const event = withIntegrity(normalizeEvent(rawEvent, {
    runID,
    sourceFile: 'playwright.jsonl',
    sourceLine: sequence,
  }), sequence)

  fs.appendFileSync(eventsFile, JSON.stringify(event) + '\n')
  console.log(`Wrote ${tabs.length} tab event(s), screenshots, and DOM snapshots`)
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
