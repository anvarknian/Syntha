const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const runner = spawn(process.execPath, [path.join(__dirname, '..', 'run_playwright.js')], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PLAYWRIGHT_TARGET_URL: process.env.PLAYWRIGHT_TARGET_URL || 'about:blank',
    PLAYWRIGHT_EXTRA_URLS: process.env.PLAYWRIGHT_EXTRA_URLS || 'about:blank',
    PLAYWRIGHT_SESSION_ID: process.env.PLAYWRIGHT_SESSION_ID || 'test-session',
    PLAYWRIGHT_PERSIST_SESSION: process.env.PLAYWRIGHT_PERSIST_SESSION || 'true',
    PLAYWRIGHT_CAPTURE_DOM: process.env.PLAYWRIGHT_CAPTURE_DOM || 'true',
  },
})

runner.on('close', (code) => {
  if (code !== 0) {
    console.error('runner exited with', code)
    process.exit(code)
  }

  const eventsFile = path.resolve(__dirname, '../../../data/events/playwright.jsonl')
  const artifactsDir = path.resolve(__dirname, '../../../data/artifacts')
  const domSnapshotsDir = path.resolve(__dirname, '../../../data/dom-snapshots')
  const sessionsDir = path.resolve(__dirname, '../../../data/browser-sessions')

  if (!fs.existsSync(eventsFile)) {
    console.error('events file not found:', eventsFile)
    process.exit(2)
  }

  const contents = fs.readFileSync(eventsFile, 'utf8').trim()
  if (!contents) {
    console.error('events file empty')
    process.exit(3)
  }

  const lines = contents.split('\n')
  const last = JSON.parse(lines[lines.length - 1])
  const tabs = Array.isArray(last.payload && last.payload.tabs) ? last.payload.tabs : []

  if (tabs.length < 1) {
    console.error('no tabs recorded in event payload')
    process.exit(4)
  }

  for (const tab of tabs) {
    if (!tab.screenshot) {
      console.error('tab missing screenshot entry:', tab)
      process.exit(5)
    }
    if (!tab.dom_snapshot) {
      console.error('tab missing dom snapshot entry:', tab)
      process.exit(6)
    }

    const screenshotPath = path.join(artifactsDir, tab.screenshot)
    if (!fs.existsSync(screenshotPath)) {
      console.error('screenshot not found:', screenshotPath)
      process.exit(7)
    }

    const domSnapshotPath = path.join(domSnapshotsDir, tab.dom_snapshot)
    if (!fs.existsSync(domSnapshotPath)) {
      console.error('dom snapshot not found:', domSnapshotPath)
      process.exit(8)
    }
  }

  if (!last.payload || !last.payload.session_id) {
    console.error('event missing session metadata')
    process.exit(9)
  }

  const sessionFile = path.join(sessionsDir, `${last.payload.session_id}.json`)
  if (!fs.existsSync(sessionFile)) {
    console.error('session state file not found:', sessionFile)
    process.exit(10)
  }

  console.log('Test OK — found event tabs, screenshots, DOM snapshots, and persistent session state')
  process.exit(0)
})
