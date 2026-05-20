const fs = require('fs')
const path = require('path')
const { parseJSONLFile, validateEvent } = require('./event_schema')

// Simple deterministic replayer: reads a replay JSONL file and validates event order and deterministic seeds.
// Usage: node services/replay-engine/replayer_run.js <replay-file>

function usage() {
  console.error('Usage: node services/replay-engine/replayer_run.js <replay-file>')
  process.exit(2)
}

async function run() {
  const args = process.argv.slice(2)
  if (args.length < 1) usage()
  const file = path.resolve(args[0])
  if (!fs.existsSync(file)) {
    console.error('replay file not found:', file)
    process.exit(2)
  }
  const parsed = parseJSONLFile(file)
  console.log('Loaded', parsed.length, 'events')

  let lastTimestamp = null
  let lastSequence = 0
  let runID = null
  for (let i = 0; i < parsed.length; i++) {
    const { event: ev } = parsed[i]
    try {
      validateEvent(ev, { requireSequence: true, requireChecksum: true })
    } catch (err) {
      console.error(`invalid event at line ${i + 1}: ${err.message}`)
      process.exit(3)
    }

    const ts = new Date(ev.timestamp)
    if (lastTimestamp && ts < lastTimestamp) {
      console.error('non-monotonic timestamp at line', i + 1)
      process.exit(4)
    }
    lastTimestamp = ts

    if (ev.sequence !== lastSequence + 1) {
      console.error('non-contiguous sequence at line', i + 1)
      process.exit(5)
    }
    lastSequence = ev.sequence

    const eventRunID = ev.metadata && ev.metadata.run_id
    if (!eventRunID) {
      console.error('missing run_id metadata at line', i + 1)
      process.exit(6)
    }
    if (runID === null) runID = eventRunID
    if (runID !== eventRunID) {
      console.error('run_id mismatch at line', i + 1)
      process.exit(6)
    }

    // Simple replay action: for known kinds, print a one-line description
    switch (ev.kind) {
      case 'email_received':
        console.log(`[${i + 1}] email_received seq=${ev.sequence} id=${ev.id}`)
        break
      case 'playwright_run':
        console.log(`[${i + 1}] playwright_run seq=${ev.sequence} url=${ev.payload && ev.payload.url}`)
        break
      default:
        console.log(`[${i + 1}] ${ev.kind} seq=${ev.sequence}`)
    }
  }

  console.log(`Replay validation completed successfully (run_id=${runID})`)
}

run().catch(err => { console.error(err); process.exit(2) })
