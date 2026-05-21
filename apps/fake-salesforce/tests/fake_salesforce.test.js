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

test('fake Salesforce creates and assigns cases while recording replay events', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'syntha-salesforce-'))
  const { app } = createApp({ dataDir })
  const server = await listen(app)

  try {
    const created = await request(server, 'POST', '/cases', {
      account_id: 'ACC-000001',
      subject: 'Billing dispute token=abc123',
      description: 'Customer avery@example.com reports duplicate charge',
      contact_email: 'avery@example.com',
      severity: 'high',
    })

    assert.equal(created.status, 201)
    assert.equal(created.body.account_id, 'ACC-000001')

    const assigned = await request(server, 'POST', `/cases/${created.body.id}/assign`, {
      owner: 'agent_42',
      status: 'working',
    })

    assert.equal(assigned.status, 200)
    assert.equal(assigned.body.owner, 'agent_42')
    assert.equal(assigned.body.status, 'working')

    const eventPath = path.join(dataDir, 'events', 'salesforce.jsonl')
    const lines = fs.readFileSync(eventPath, 'utf8').trim().split('\n')
    assert.equal(lines.length, 2)

    const firstEvent = JSON.parse(lines[0])
    assert.equal(firstEvent.kind, 'salesforce_case_created')
    assert.equal(firstEvent.metadata.schema_version, 'v1')
    assert.equal(typeof firstEvent.checksum, 'string')
    assert.match(firstEvent.payload.subject, /\[REDACTED_SECRET\]/)
    assert.match(firstEvent.payload.description, /XX/)
    assert.match(firstEvent.payload.contact_email, /XX/)

    const secondEvent = JSON.parse(lines[1])
    assert.equal(secondEvent.kind, 'salesforce_case_assigned')
    assert.equal(secondEvent.payload.owner, 'agent_42')
  } finally {
    await close(server)
  }
})
