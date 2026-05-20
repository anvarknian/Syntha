require('./otel')
const express = require('express')
const bodyParser = require('body-parser')
const fs = require('fs')
const path = require('path')
const { normalizeEvent, withIntegrity } = require('../../services/replay-engine/event_schema')

const app = express()
app.use(bodyParser.json())

const inbox = []
let messageCounter = 0
let eventCounter = 0
const runID = process.env.FAKE_GMAIL_RUN_ID || `fake-gmail-${process.pid}`
const allowRawPII = /^(1|true|yes)$/i.test(process.env.EXPORT_ALLOW_RAW_PII || '')
const deniedFields = (process.env.EXPORT_DENY_FIELDS || '')
  .split(',')
  .map(v => v.trim().toLowerCase())
  .filter(Boolean)

const emailRE = /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+)/g
const ccRE = /\b(?:\d[ -]*?){13,16}\b/g

function scrubString(input) {
  let output = input.replace(ccRE, '[REDACTED_CCN]')
  output = output.replace(emailRE, (full, local, domain) => {
    if (local.length <= 2) return `[REDACTED]@${domain}`
    return `${'X'.repeat(local.length - 2)}${local.slice(-2)}@${domain}`
  })
  return output
}

function scrubValue(value) {
  if (typeof value === 'string') return scrubString(value)
  if (Array.isArray(value)) return value.map(scrubValue)
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value)) {
      const deny = deniedFields.includes(key.toLowerCase())
      if (deny) {
        out[key] = '[REDACTED]'
        continue
      }
      out[key] = scrubValue(value[key])
    }
    return out
  }
  return value
}

function applyExportControls(value) {
  if (allowRawPII) return value
  return scrubValue(value)
}

function nextID(prefix, n) {
  return `${prefix}_${String(n).padStart(8, '0')}`
}

app.get('/inbox', (req, res) => {
  res.json({ messages: inbox })
})

app.get('/healthz', (req, res) => {
  res.status(200).json({ ok: true })
})

app.post('/send', (req, res) => {
  const { to, from, subject, body } = req.body || {}
  if (!to || !from) return res.status(400).json({ error: 'missing to/from' })
  messageCounter += 1
  const msg = {
    id: nextID('msg', messageCounter),
    to,
    from,
    subject: subject || '',
    body: body || '',
    timestamp: new Date().toISOString(),
  }
  inbox.push(msg)

  // Append event to data/events
  const dataDir = path.resolve(__dirname, '../../data')
  const eventsDir = path.join(dataDir, 'events')
  if (!fs.existsSync(eventsDir)) fs.mkdirSync(eventsDir, { recursive: true })
  eventCounter += 1
  const event = normalizeEvent({
    id: nextID('gmail_evt', eventCounter),
    timestamp: msg.timestamp,
    kind: 'email_received',
    payload: applyExportControls({ ...msg }),
    metadata: {
      service: 'fake-gmail',
      expected_status: '201',
    },
  }, {
    runID,
    sourceFile: 'gmail.jsonl',
    sourceLine: eventCounter,
  })
  const replayEvent = withIntegrity(event, eventCounter)
  fs.appendFileSync(path.join(eventsDir, 'gmail.jsonl'), JSON.stringify(replayEvent) + '\n')

  res.status(201).json(msg)
})

const port = process.env.PORT || 3001
app.listen(port, () => console.log('fake-gmail listening on', port))
