const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

process.env.SYNTHA_DISABLE_OTEL = '1'
process.env.EXPORT_DENY_FIELDS = ''
process.env.FAKE_SLACK_RATE_LIMIT_PER_MINUTE = '120'

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

test('fake Slack stores messages and writes replay events', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'syntha-slack-'))
  const { app } = createApp({ dataDir })
  const server = await listen(app)
  try {
    const sent = await request(server, 'POST', '/send', {
      text: 'Customer avery@example.com says token=abc123 failed',
      user: 'U00000001',
    })
    assert.equal(sent.status, 201)
    assert.equal(sent.body.channel_id, 'C00000001')

    const listed = await request(server, 'GET', '/channels/C00000001/messages')
    assert.equal(listed.status, 200)
    assert.equal(listed.body.messages.length, 1)

    const eventPath = path.join(dataDir, 'events', 'slack.jsonl')
    const lines = fs.readFileSync(eventPath, 'utf8').trim().split('\n')
    assert.equal(lines.length, 1)
    const event = JSON.parse(lines[0])
    assert.equal(event.kind, 'slack_message_posted')
    assert.match(event.payload.text, /XX/)
    assert.match(event.payload.text, /\[REDACTED_SECRET\]/)
    assert.equal(event.metadata.schema_version, 'v1')
    assert.equal(typeof event.checksum, 'string')
  } finally {
    await close(server)
  }
})
