#!/usr/bin/env node
const path = require('path')
const { assertURLAllowed, parseAllowedOrigins } = require('./egress_policy')
const { parseJSONLFile, validateEvent } = require('./event_schema')

// Replay runner: re-executes events against live services.
// Usage: node services/replay-engine/runner.js <replay-file> [--delay-ms=100] [--continue-on-error]

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function usage() {
  console.error('Usage: node services/replay-engine/runner.js <replay-file> [--delay-ms=100] [--continue-on-error]')
  process.exit(2)
}

async function postJson(url, obj) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  })
  const text = await res.text()
  return { status: res.status, body: text }
}

function parseArgs(args) {
  if (args.length < 1) usage()
  const file = path.resolve(args[0])
  const delayArg = args.find(a => a.startsWith('--delay-ms='))
  const delay = delayArg ? Number.parseInt(delayArg.split('=')[1], 10) : 100
  const continueOnError = args.includes('--continue-on-error')
  if (!Number.isInteger(delay) || delay < 0) {
    throw new Error('delay must be a non-negative integer')
  }
  return { file, delay, continueOnError }
}

function expectedStatusForEvent(event, fallback) {
  const fromMeta = event.metadata && event.metadata.expected_status
  const fromPayload = event.payload && event.payload.expected_status
  const raw = fromMeta !== undefined ? fromMeta : fromPayload
  if (raw === undefined || raw === null || raw === '') return fallback
  const parsed = Number.parseInt(String(raw), 10)
  if (!Number.isInteger(parsed)) {
    throw new Error(`invalid expected_status for event ${event.id}`)
  }
  return parsed
}

function validateReplayOrder(events) {
  let lastSeq = 0
  let lastTS = null
  let runID = null
  for (const [idx, event] of events.entries()) {
    validateEvent(event, { requireSequence: true, requireChecksum: true })
    const ts = new Date(event.timestamp)
    if (lastTS !== null && ts < lastTS) {
      throw new Error(`non-monotonic timestamp at line ${idx + 1}`)
    }
    lastTS = ts
    if (event.sequence !== lastSeq + 1) {
      throw new Error(`non-contiguous sequence at line ${idx + 1}`)
    }
    lastSeq = event.sequence
    const eventRunID = event.metadata && event.metadata.run_id
    if (!eventRunID) {
      throw new Error(`missing run_id metadata at line ${idx + 1}`)
    }
    if (runID === null) runID = eventRunID
    if (eventRunID !== runID) {
      throw new Error(`run_id mismatch at line ${idx + 1}`)
    }
  }
  return { runID }
}

function sanitizePayload(payload) {
  const cloned = { ...payload }
  delete cloned.expected_status
  return cloned
}

async function replayEvent(event, cfg) {
  if (event.kind === 'email_received' || (event.metadata && event.metadata.service === 'fake-gmail')) {
    const endpoint = `${cfg.fakeGmailURL.replace(/\/$/, '')}/send`
    assertURLAllowed(endpoint, cfg.allowedOrigins)
    const result = await postJson(endpoint, sanitizePayload(event.payload || {}))
    const expectedStatus = expectedStatusForEvent(event, 201)
    if (result.status !== expectedStatus) {
      throw new Error(`status mismatch: expected ${expectedStatus}, got ${result.status}`)
    }
    return { action: `POST ${endpoint}`, status: result.status }
  }

  if (event.kind === 'playwright_run') {
    const url = event.payload && event.payload.url ? event.payload.url : 'about:blank'
    assertURLAllowed(url, cfg.allowedOrigins)
    if (url === 'about:blank') {
      return { action: 'SKIP about:blank', status: 204 }
    }
    const res = await fetch(url)
    const expectedStatus = expectedStatusForEvent(event, 200)
    if (res.status !== expectedStatus) {
      throw new Error(`status mismatch: expected ${expectedStatus}, got ${res.status}`)
    }
    return { action: `GET ${url}`, status: res.status }
  }

  if (event.metadata && event.metadata.target_url) {
    const endpoint = event.metadata.target_url
    assertURLAllowed(endpoint, cfg.allowedOrigins)
    const result = await postJson(endpoint, sanitizePayload(event.payload || {}))
    const expectedStatus = expectedStatusForEvent(event, 200)
    if (result.status !== expectedStatus) {
      throw new Error(`status mismatch: expected ${expectedStatus}, got ${result.status}`)
    }
    return { action: `POST ${endpoint}`, status: result.status }
  }

  return { action: 'NOOP', status: 0 }
}

async function run() {
  const args = parseArgs(process.argv.slice(2))
  const parsed = parseJSONLFile(args.file)
  const events = parsed.map(item => item.event)
  const { runID } = validateReplayOrder(events)
  console.log('Loaded', events.length, 'events from', args.file, `(run_id=${runID})`)

  const allowedOrigins = parseAllowedOrigins(process.env.REPLAY_ALLOWED_ORIGINS)
  const fakeGmailURL = process.env.FAKE_GMAIL_URL || 'http://localhost:3001'
  const cfg = { fakeGmailURL, allowedOrigins }
  let failed = 0
  let replayed = 0

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    console.log(`[${i + 1}/${events.length}] seq=${ev.sequence} kind=${ev.kind} timestamp=${ev.timestamp}`)

    try {
      const result = await replayEvent(ev, cfg)
      replayed++
      console.log(` -> ${result.action} -> ${result.status}`)
    } catch (err) {
      failed++
      console.error(` -> replay error: ${err && err.message ? err.message : err}`)
      if (!args.continueOnError) {
        process.exit(7)
      }
    }

    if (i < events.length - 1) await sleep(args.delay)
  }

  console.log(`Replay run completed (run_id=${runID}, replayed=${replayed}, failed=${failed})`)
  if (failed > 0) process.exit(7)
}

run().catch(err => { console.error(err); process.exit(2) })
