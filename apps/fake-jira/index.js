if (process.env.SYNTHA_DISABLE_OTEL !== '1') {
  require('./otel')
}

const express = require('express')
const bodyParser = require('body-parser')
const fs = require('fs')
const path = require('path')
const { normalizeEvent, withIntegrity } = require('../../services/replay-engine/event_schema')

const DEFAULT_PROJECTS = [
  { id: 'PRJ-1', key: 'SUP', name: 'Support Platform' },
  { id: 'PRJ-2', key: 'SEC', name: 'Security Operations' },
]

function buildState() {
  return {
    projects: new Map(DEFAULT_PROJECTS.map(project => [project.key, { ...project }])),
    issues: new Map(),
    issueCounter: 0,
    eventCounter: 0,
  }
}

function createApp(options = {}) {
  const app = express()
  const state = options.state || buildState()
  const runID = process.env.FAKE_JIRA_RUN_ID || `fake-jira-${process.pid}`
  const dataDir = options.dataDir || process.env.SYNTHA_DATA_DIR || path.resolve(__dirname, '../../data')
  const allowRawPII = /^(1|true|yes)$/i.test(process.env.EXPORT_ALLOW_RAW_PII || '')
  const deniedFields = (process.env.EXPORT_DENY_FIELDS || '')
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean)

  app.use(bodyParser.json({ limit: '256kb' }))

  app.get('/healthz', (req, res) => {
    res.status(200).json({ ok: true, service: 'fake-jira' })
  })

  app.get('/projects', (req, res) => {
    res.json({ projects: Array.from(state.projects.values()) })
  })

  app.post('/issues', (req, res) => {
    const { project_key: projectKey, summary, description, reporter, priority } = req.body || {}
    if (typeof projectKey !== 'string' || !state.projects.has(projectKey)) {
      res.status(400).json({ error: { code: 'invalid_project', message: 'project_key must reference an existing project' } })
      return
    }
    if (typeof summary !== 'string' || summary.trim() === '') {
      res.status(400).json({ error: { code: 'invalid_summary', message: 'summary is required' } })
      return
    }

    state.issueCounter += 1
    const issue = {
      id: `JIRA-${String(state.issueCounter).padStart(6, '0')}`,
      key: `${projectKey}-${state.issueCounter}`,
      project_key: projectKey,
      summary: summary.trim(),
      description: typeof description === 'string' ? description : '',
      reporter: typeof reporter === 'string' ? reporter : 'agent',
      assignee: null,
      priority: typeof priority === 'string' ? priority : 'medium',
      status: 'todo',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    state.issues.set(issue.id, issue)

    recordEvent(state, dataDir, runID, deniedFields, allowRawPII, 'jira_issue_created', issue, {
      service: 'fake-jira',
      expected_status: '201',
    })

    res.status(201).json(issue)
  })

  app.get('/issues/:issueID', (req, res) => {
    const issue = state.issues.get(req.params.issueID)
    if (!issue) {
      res.status(404).json({ error: { code: 'issue_not_found', message: 'issue does not exist' } })
      return
    }
    res.json(issue)
  })

  app.post('/issues/:issueID/transition', (req, res) => {
    const issue = state.issues.get(req.params.issueID)
    if (!issue) {
      res.status(404).json({ error: { code: 'issue_not_found', message: 'issue does not exist' } })
      return
    }

    const { status, assignee } = req.body || {}
    if (typeof status !== 'string' || status.trim() === '') {
      res.status(400).json({ error: { code: 'invalid_status', message: 'status is required' } })
      return
    }

    issue.status = status.trim().toLowerCase()
    if (typeof assignee === 'string' && assignee.trim() !== '') {
      issue.assignee = assignee.trim()
    }
    issue.updated_at = new Date().toISOString()

    recordEvent(state, dataDir, runID, deniedFields, allowRawPII, 'jira_issue_transitioned', issue, {
      service: 'fake-jira',
      expected_status: '200',
    })

    res.json(issue)
  })

  return { app, state }
}

function recordEvent(state, dataDir, runID, deniedFields, allowRawPII, kind, payload, metadata) {
  const eventsDir = path.join(dataDir, 'events')
  if (!fs.existsSync(eventsDir)) fs.mkdirSync(eventsDir, { recursive: true })

  state.eventCounter += 1
  const event = normalizeEvent({
    id: `jira_evt_${String(state.eventCounter).padStart(8, '0')}`,
    timestamp: new Date().toISOString(),
    kind,
    payload: applyExportControls(payload, deniedFields, allowRawPII),
    metadata,
  }, {
    runID,
    sourceFile: 'jira.jsonl',
    sourceLine: state.eventCounter,
  })
  const replayEvent = withIntegrity(event, state.eventCounter)
  fs.appendFileSync(path.join(eventsDir, 'jira.jsonl'), JSON.stringify(replayEvent) + '\n')
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
  const port = process.env.PORT || 3003
  const { app } = createApp()
  app.listen(port, () => console.log('fake-jira listening on', port))
}

module.exports = {
  buildState,
  createApp,
}
