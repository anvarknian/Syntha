#!/usr/bin/env node
const path = require('path')
const {
  parseJSONLFile,
  validateEvent,
} = require('../replay-engine/event_schema')

function usage() {
  console.error('Usage: node services/analytics/clickhouse_ingest.js <replay-file> [--dry-run]')
  process.exit(2)
}

function parseArgs(args) {
  if (args.length < 1) usage()
  return {
    replayFile: path.resolve(args[0]),
    dryRun: args.includes('--dry-run'),
    clickhouseURL: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
  }
}

function eventToRow(event) {
  validateEvent(event, { requireSequence: true, requireChecksum: true })
  return {
    timestamp: event.timestamp,
    run_id: event.metadata.run_id,
    event_id: event.id,
    sequence: event.sequence,
    kind: event.kind,
    seed: event.seed,
    checksum: event.checksum,
    payload_json: JSON.stringify(event.payload || {}),
    metadata_json: JSON.stringify(event.metadata || {}),
  }
}

async function insertRows(clickhouseURL, rows) {
  if (rows.length === 0) return
  const query = encodeURIComponent('INSERT INTO syntha.events FORMAT JSONEachRow')
  const endpoint = `${clickhouseURL.replace(/\/$/, '')}/?query=${query}`
  const body = rows.map(row => JSON.stringify(row)).join('\n')
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-ndjson' },
    body,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`ClickHouse insert failed: ${res.status} ${text}`)
  }
}

async function run() {
  const cfg = parseArgs(process.argv.slice(2))
  const rows = parseJSONLFile(cfg.replayFile).map(item => eventToRow(item.event))
  if (cfg.dryRun) {
    console.log(`validated ${rows.length} replay events for ClickHouse ingest`)
    return
  }
  await insertRows(cfg.clickhouseURL, rows)
  console.log(`inserted ${rows.length} replay events into ClickHouse`)
}

run().catch(err => {
  console.error(err.message || err)
  process.exit(2)
})
