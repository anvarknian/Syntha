const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const runner = spawn(process.execPath, [path.join(__dirname, '..', 'run_playwright.js')], { stdio: 'inherit' })

runner.on('close', (code) => {
  if (code !== 0) {
    console.error('runner exited with', code)
    process.exit(code)
  }
  const eventsFile = path.resolve(__dirname, '../../../data/events/playwright.jsonl')
  const artifactsDir = path.resolve(__dirname, '../../../data/artifacts')
  if (!fs.existsSync(eventsFile)) {
    console.error('events file not found:', eventsFile)
    process.exit(2)
  }
  const contents = fs.readFileSync(eventsFile, 'utf8')
  if (!contents.trim()) {
    console.error('events file empty')
    process.exit(3)
  }
  const lines = contents.trim().split('\n')
  const last = JSON.parse(lines[lines.length - 1])
  const screenshotName = last.payload && last.payload.screenshot
  const screenshotPath = path.join(artifactsDir, screenshotName)
  if (!fs.existsSync(screenshotPath)) {
    console.error('screenshot not found:', screenshotPath)
    process.exit(4)
  }
  console.log('Test OK — found event and screenshot')
  process.exit(0)
})
