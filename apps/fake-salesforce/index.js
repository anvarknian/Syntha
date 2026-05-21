if (process.env.SYNTHA_DISABLE_OTEL !== '1') {
  require('./otel')
}

const express = require('express')
const bodyParser = require('body-parser')
const fs = require('fs')
const path = require('path')
const { normalizeEvent, withIntegrity } = require('../../services/replay-engine/event_schema')

const DEFAULT_ACCOUNTS = [
  { id: 'ACC-000001', name: 'Acme Corp', tier: 'enterprise' },
  { id: 'ACC-000002', name: 'Globex LLC', tier: 'growth' },
]

function buildState() {
  return {
    accounts: new Map(DEFAULT_ACCOUNTS.map(account => [account.id, { ...account }])),
    cases: new Map(),
    caseCounter: 0,
    eventCounter: 0,
  }
}

function createApp(options = {}) {
  const app = express()
  const state = options.state || buildState()
  const runID = process.env.FAKE_SALESFORCE_RUN_ID || `fake-salesforce-${process.pid}`
  const dataDir = options.dataDir || process.env.SYNTHA_DATA_DIR || path.resolve(__dirname, '../../data')
  const allowRawPII = /^(1|true|yes)$/i.test(process.env.EXPORT_ALLOW_RAW_PII || '')
  const deniedFields = (process.env.EXPORT_DENY_FIELDS || '')
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean)

  app.use(bodyParser.json({ limit: '256kb' }))

  app.get('/healthz', (req, res) => {
    res.status(200).json({ ok: true, service: 'fake-salesforce' })
  })

  app.get('/accounts', (req, res) => {
    res.json({ accounts: Array.from(state.accounts.values()) })
  })

  app.post('/cases', (req, res) => {
    const { account_id: accountID, subject, description, severity, contact_email: contactEmail } = req.body || {}
    if (typeof accountID !== 'string' || !state.accounts.has(accountID)) {
      res.status(400).json({ error: { code: 'invalid_account', message: 'account_id must reference an existing account' } })
      return
    }
    if (typeof subject !== 'string' || subject.trim() === '') {
      res.status(400).json({ error: { code: 'invalid_subject', message: 'subject is required' } })
      return
    }

    state.caseCounter += 1
    const customerCase = {
      id: `CASE-${String(state.caseCounter).padStart(6, '0')}`,
      account_id: accountID,
      subject: subject.trim(),
      description: typeof description === 'string' ? description : '',
      contact_email: typeof contactEmail === 'string' ? contactEmail : '',
      severity: typeof severity === 'string' ? severity : 'medium',
      status: 'new',
      owner: 'queue_support',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    state.cases.set(customerCase.id, customerCase)

    recordEvent(state, dataDir, runID, deniedFields, allowRawPII, 'salesforce_case_created', customerCase, {
      service: 'fake-salesforce',
      expected_status: '201',
    })

    res.status(201).json(customerCase)
  })

  app.get('/cases/:caseID', (req, res) => {
    const customerCase = state.cases.get(req.params.caseID)
    if (!customerCase) {
      res.status(404).json({ error: { code: 'case_not_found', message: 'case does not exist' } })
      return
    }
    res.json(customerCase)
  })

  app.post('/cases/:caseID/assign', (req, res) => {
    const customerCase = state.cases.get(req.params.caseID)
    if (!customerCase) {
      res.status(404).json({ error: { code: 'case_not_found', message: 'case does not exist' } })
      return
    }

    const { owner, status } = req.body || {}
    if (typeof owner !== 'string' || owner.trim() === '') {
      res.status(400).json({ error: { code: 'invalid_owner', message: 'owner is required' } })
      return
    }

    customerCase.owner = owner.trim()
    if (typeof status === 'string' && status.trim() !== '') {
      customerCase.status = status.trim().toLowerCase()
    }
    customerCase.updated_at = new Date().toISOString()

    recordEvent(state, dataDir, runID, deniedFields, allowRawPII, 'salesforce_case_assigned', customerCase, {
      service: 'fake-salesforce',
      expected_status: '200',
    })

    res.json(customerCase)
  })

  return { app, state }
}

function recordEvent(state, dataDir, runID, deniedFields, allowRawPII, kind, payload, metadata) {
  const eventsDir = path.join(dataDir, 'events')
  if (!fs.existsSync(eventsDir)) fs.mkdirSync(eventsDir, { recursive: true })

  state.eventCounter += 1
  const event = normalizeEvent({
    id: `salesforce_evt_${String(state.eventCounter).padStart(8, '0')}`,
    timestamp: new Date().toISOString(),
    kind,
    payload: applyExportControls(payload, deniedFields, allowRawPII),
    metadata,
  }, {
    runID,
    sourceFile: 'salesforce.jsonl',
    sourceLine: state.eventCounter,
  })
  const replayEvent = withIntegrity(event, state.eventCounter)
  fs.appendFileSync(path.join(eventsDir, 'salesforce.jsonl'), JSON.stringify(replayEvent) + '\n')
}

function applyExportControls(value, deniedFields, allowRawPII) {
  if (allowRawPII) return value
  return scrubValue(value, deniedFields)
}

function scrubValue(value, deniedFields) {
  if (typeof value === 'string') return scrubString(value)
  if (Array.isArray(value)) return value.map(item => scrubValue(item, deniedFields))
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value)) {
      if (deniedFields.includes(key.toLowerCase())) {
        out[key] = '[REDACTED]'
        continue
      }
      out[key] = scrubValue(value[key], deniedFields)
    }
    return out
  }
  return value
}

function scrubString(input) {
  return input
    .replace(/\b(?:\d[ -]*?){13,16}\b/g, '[REDACTED_CCN]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, (email) => {
      const [local, domain] = email.split('@')
      if (!local || !domain) return '[REDACTED_EMAIL]'
      if (local.length <= 2) return `[REDACTED]@${domain}`
      return `${'X'.repeat(local.length - 2)}${local.slice(-2)}@${domain}`
    })
    .replace(/\b((?:api[_-]?key|token|secret|password)=)([^\s]+)/gi, '$1[REDACTED_SECRET]')
}

if (require.main === module) {
  const port = process.env.PORT || 3004
  const { app } = createApp()
  app.listen(port, () => console.log('fake-salesforce listening on', port))
}

module.exports = {
  buildState,
  createApp,
}
