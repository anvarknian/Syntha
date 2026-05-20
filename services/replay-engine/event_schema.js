const crypto = require('crypto')

const REPLAY_SCHEMA_VERSION = 'v1'
const CHECKSUM_HEX_RE = /^[a-f0-9]{64}$/i

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stableSortValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableSortValue)
  }
  if (!isPlainObject(value)) {
    return value
  }
  const out = {}
  for (const key of Object.keys(value).sort()) {
    out[key] = stableSortValue(value[key])
  }
  return out
}

function stableStringify(value) {
  return JSON.stringify(stableSortValue(value))
}

function parseJSONLFile(filePath) {
  const fs = require('fs')
  const lines = fs.readFileSync(filePath, 'utf8').split('\n')
  const parsed = []
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim()
    if (!line) continue
    let event
    try {
      event = JSON.parse(line)
    } catch (err) {
      throw new Error(`invalid JSON in ${filePath}:${idx + 1}: ${err.message}`)
    }
    parsed.push({ event, line: idx + 1 })
  }
  return parsed
}

function deriveSeed(rawEvent) {
  const hash = crypto.createHash('sha256').update(stableStringify(rawEvent)).digest()
  return hash.readInt32BE(0)
}

function deriveDeterministicID(rawEvent, sourceFile, sourceLine) {
  const idSource = stableStringify({
    source_file: sourceFile || 'unknown',
    source_line: sourceLine || 0,
    timestamp: rawEvent.timestamp || '',
    kind: rawEvent.kind || '',
    payload: rawEvent.payload || {},
  })
  const suffix = crypto.createHash('sha256').update(idSource).digest('hex').slice(0, 12)
  return `evt_${suffix}`
}

function normalizeEvent(rawEvent, opts = {}) {
  if (!isPlainObject(rawEvent)) {
    throw new Error('event must be an object')
  }
  const normalized = {
    id: typeof rawEvent.id === 'string' && rawEvent.id.trim() !== ''
      ? rawEvent.id.trim()
      : deriveDeterministicID(rawEvent, opts.sourceFile, opts.sourceLine),
    timestamp: String(rawEvent.timestamp || ''),
    kind: typeof rawEvent.kind === 'string' ? rawEvent.kind.trim() : '',
    seed: Number.isInteger(rawEvent.seed) ? rawEvent.seed : deriveSeed(rawEvent),
    payload: isPlainObject(rawEvent.payload) ? rawEvent.payload : {},
    metadata: isPlainObject(rawEvent.metadata) ? { ...rawEvent.metadata } : {},
  }

  if (rawEvent.sequence !== undefined) {
    normalized.sequence = rawEvent.sequence
  }
  if (rawEvent.checksum !== undefined) {
    normalized.checksum = rawEvent.checksum
  }

  if (opts.runID && typeof normalized.metadata.run_id !== 'string') {
    normalized.metadata.run_id = opts.runID
  }
  if (opts.sourceFile && typeof normalized.metadata.source_file !== 'string') {
    normalized.metadata.source_file = opts.sourceFile
  }
  if (opts.sourceLine && normalized.metadata.source_line === undefined) {
    normalized.metadata.source_line = opts.sourceLine
  }
  if (typeof normalized.metadata.schema_version !== 'string') {
    normalized.metadata.schema_version = REPLAY_SCHEMA_VERSION
  }

  return normalized
}

function checksumBaseEvent(event) {
  const base = {
    id: event.id,
    timestamp: event.timestamp,
    kind: event.kind,
    seed: event.seed,
    payload: event.payload,
    metadata: event.metadata,
    sequence: event.sequence,
  }
  return stableSortValue(base)
}

function computeEventChecksum(event) {
  return crypto.createHash('sha256').update(stableStringify(checksumBaseEvent(event))).digest('hex')
}

function withIntegrity(event, sequence) {
  const updated = { ...event, sequence }
  updated.checksum = computeEventChecksum(updated)
  return updated
}

function validateEvent(event, opts = {}) {
  if (!isPlainObject(event)) throw new Error('event must be object')
  if (typeof event.id !== 'string' || event.id.trim() === '') throw new Error('missing event id')
  if (typeof event.kind !== 'string' || event.kind.trim() === '') throw new Error('missing event kind')
  if (typeof event.timestamp !== 'string' || Number.isNaN(Date.parse(event.timestamp))) {
    throw new Error('invalid event timestamp')
  }
  if (!Number.isInteger(event.seed)) throw new Error('event seed must be an integer')
  if (!isPlainObject(event.payload)) throw new Error('event payload must be an object')
  if (!isPlainObject(event.metadata)) throw new Error('event metadata must be an object')
  if (event.metadata.schema_version !== REPLAY_SCHEMA_VERSION) {
    throw new Error(`unsupported schema_version: ${event.metadata.schema_version}`)
  }
  if (opts.requireSequence && (!Number.isInteger(event.sequence) || event.sequence < 1)) {
    throw new Error('event sequence must be a positive integer')
  }
  if (opts.requireChecksum) {
    if (typeof event.checksum !== 'string' || !CHECKSUM_HEX_RE.test(event.checksum)) {
      throw new Error('event checksum must be a 64-char hex string')
    }
    const expected = computeEventChecksum(event)
    if (event.checksum !== expected) {
      throw new Error('event checksum mismatch')
    }
  }
}

function deterministicCompare(a, b) {
  const ta = Date.parse(a.timestamp)
  const tb = Date.parse(b.timestamp)
  if (ta !== tb) return ta - tb
  if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
  return a.id.localeCompare(b.id)
}

module.exports = {
  REPLAY_SCHEMA_VERSION,
  deterministicCompare,
  normalizeEvent,
  parseJSONLFile,
  stableStringify,
  validateEvent,
  withIntegrity,
  computeEventChecksum,
}
