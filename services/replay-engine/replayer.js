const fs = require('fs')
const path = require('path')
const {
  deterministicCompare,
  normalizeEvent,
  parseJSONLFile,
  validateEvent,
  withIntegrity,
} = require('./event_schema')

// Deterministic replay packer: normalizes and orders events before writing a replay file.
async function pack() {
  const repoRoot = path.resolve(__dirname, '../../')
  const eventsDir = path.join(repoRoot, 'data', 'events')
  const replaysDir = path.join(repoRoot, 'data', 'replays')
  if (!fs.existsSync(eventsDir)) {
    console.error('no events directory:', eventsDir)
    process.exit(1)
  }
  if (!fs.existsSync(replaysDir)) fs.mkdirSync(replaysDir, { recursive: true })

  const files = fs.readdirSync(eventsDir).filter(f => f.endsWith('.jsonl')).sort()
  const packedEvents = []
  const runID = process.env.REPLAY_RUN_ID || `run-${Date.now()}`

  for (const file of files) {
    const fullPath = path.join(eventsDir, file)
    const parsed = parseJSONLFile(fullPath)
    for (const item of parsed) {
      const normalized = normalizeEvent(item.event, {
        runID,
        sourceFile: file,
        sourceLine: item.line,
      })
      validateEvent(normalized)
      packedEvents.push(normalized)
    }
  }

  packedEvents.sort(deterministicCompare)
  const withSequence = packedEvents.map((event, idx) => withIntegrity(event, idx + 1))

  const outPath = path.join(replaysDir, `replay-${Date.now()}.jsonl`)
  const out = fs.createWriteStream(outPath)
  for (const event of withSequence) {
    out.write(`${JSON.stringify(event)}\n`)
  }
  out.end()
  console.log(`wrote replay: ${outPath} (${withSequence.length} events, run_id=${runID})`)
}

pack().catch(err => { console.error(err); process.exit(2) })
