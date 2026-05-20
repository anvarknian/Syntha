const test = require('node:test')
const assert = require('node:assert/strict')
const { assertURLAllowed, parseAllowedOrigins } = require('../egress_policy')

test('parseAllowedOrigins uses defaults when unset', () => {
  const origins = parseAllowedOrigins('')
  assert.ok(origins.includes('http://localhost:3001'))
})

test('assertURLAllowed accepts allowed origins', () => {
  const allowed = ['http://localhost:3001', 'about:blank']
  assert.doesNotThrow(() => assertURLAllowed('http://localhost:3001/send', allowed))
  assert.doesNotThrow(() => assertURLAllowed('about:blank', allowed))
})

test('assertURLAllowed blocks disallowed origins', () => {
  const allowed = ['http://localhost:3001']
  assert.throws(() => assertURLAllowed('https://evil.example.com', allowed), /blocked outbound URL/)
})
