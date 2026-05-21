const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

process.env.SYNTHA_DISABLE_OTEL = '1'
process.env.EXPORT_DENY_FIELDS = ''

const { createApp } = require('../index')

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve(server))
  })
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()))
  })
}

async function request(server, method, pathname, body) {
  const address = server.address()
  const response = await fetch(`http://127.0.0.1:${address.port}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return {
    status: response.status,
    body: await response.json(),
  }
}

test('fake Jira creates and transitions issues while recording replay events', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'syntha-jira-'))
  const { app } = createApp({ dataDir })
  const server = await listen(app)

  try {
    const created = await request(server, 'POST', '/issues', {
      project_key: 'SUP',
      summary: 'Customer token=abc123 leaked in support thread',
      description: 'Please investigate user avery@example.com incident',
      reporter: 'U10001',
      priority: 'high',
    })

    assert.equal(created.status, 201)
    assert.equal(created.body.project_key, 'SUP')

    const transitioned = await request(server, 'POST', `/issues/${created.body.id}/transition`, {
      status: 'in_progress',
      assignee: 'U20002',
    })

    assert.equal(transitioned.status, 200)
    assert.equal(transitioned.body.status, 'in_progress')

    const eventPath = path.join(dataDir, 'events', 'jira.jsonl')
    const lines = fs.readFileSync(eventPath, 'utf8').trim().split('\n')
    assert.equal(lines.length, 2)

    const firstEvent = JSON.parse(lines[0])
    assert.equal(firstEvent.kind, 'jira_issue_created')
    assert.equal(firstEvent.metadata.schema_version, 'v1')
    assert.equal(typeof firstEvent.checksum, 'string')
    assert.match(firstEvent.payload.summary, /\[REDACTED_SECRET\]/)
    assert.match(firstEvent.payload.description, /XX/)

    const secondEvent = JSON.parse(lines[1])
    assert.equal(secondEvent.kind, 'jira_issue_transitioned')
    assert.equal(secondEvent.payload.status, 'in_progress')
  } finally {
    await close(server)
  }
})
