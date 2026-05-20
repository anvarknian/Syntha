CREATE DATABASE IF NOT EXISTS syntha;

CREATE TABLE IF NOT EXISTS syntha.events
(
  timestamp DateTime64(3, 'UTC'),
  run_id String,
  event_id String,
  sequence UInt64,
  kind LowCardinality(String),
  seed Int64,
  checksum FixedString(64),
  payload_json String,
  metadata_json String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (run_id, sequence, timestamp);

CREATE TABLE IF NOT EXISTS syntha.replay_runs
(
  started_at DateTime64(3, 'UTC'),
  run_id String,
  replay_file String,
  replayed UInt64,
  failed UInt64
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(started_at)
ORDER BY (run_id, started_at);
