const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  deterministicCompare,
  normalizeEvent,
  parseJSONLFile,
  validateEvent,
  withIntegrity,
} = require('../event_schema')

test('normalizeEvent and withIntegrity produce valid replay event', () => {
  const normalized = normalizeEvent({
    timestamp: '2026-05-20T01:00:00.000Z',
    kind: 'email_received',
    payload: { to: 'alice@example.com', from: 'bob@example.com' },
    metadata: { service: 'fake-gmail' },
  }, { runID: 'run-test', sourceFile: 'sample.jsonl', sourceLine: 7 })

  const withChecksum = withIntegrity(normalized, 1)
  validateEvent(withChecksum, { requireSequence: true, requireChecksum: true })
  assert.equal(withChecksum.metadata.run_id, 'run-test')
  assert.equal(withChecksum.metadata.schema_version, 'v1')
})

test('validateEvent rejects checksum mismatch', () => {
  const normalized = normalizeEvent({
    id: 'evt-1',
    timestamp: '2026-05-20T01:00:00.000Z',
    kind: 'playwright_run',
    seed: 42,
    payload: { url: 'about:blank' },
    metadata: { schema_version: 'v1', run_id: 'run-test' },
  })
  const good = withIntegrity(normalized, 1)
  const tampered = { ...good, checksum: '0'.repeat(64) }
  assert.throws(() => validateEvent(tampered, { requireSequence: true, requireChecksum: true }), /checksum mismatch/)
})

test('parseJSONLFile parses valid JSONL and keeps line numbers', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'syntha-replay-test-'))
  const file = path.join(tmpDir, 'events.jsonl')
  fs.writeFileSync(file, '{"a":1}\n\n{"b":2}\n')
  const parsed = parseJSONLFile(file)
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].line, 1)
  assert.equal(parsed[1].line, 3)
})

test('deterministicCompare sorts by timestamp, kind, id', () => {
  const events = [
    { id: 'b', kind: 'x', timestamp: '2026-05-20T02:00:00.000Z' },
    { id: 'a', kind: 'a', timestamp: '2026-05-20T01:00:00.000Z' },
    { id: 'c', kind: 'b', timestamp: '2026-05-20T01:00:00.000Z' },
  ]
  events.sort(deterministicCompare)
  assert.deepEqual(events.map(e => e.id), ['a', 'c', 'b'])
})
