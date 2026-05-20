# Syntha Analytics

ClickHouse ingestion for deterministic replay events.

```bash
node services/analytics/clickhouse_ingest.js data/replays/test-replay.jsonl --dry-run
```

Insert into a running local ClickHouse:

```bash
CLICKHOUSE_URL=http://localhost:8123 node services/analytics/clickhouse_ingest.js data/replays/test-replay.jsonl
```

The destination schema is defined in `infrastructure/clickhouse/schema.sql` and mirrored in the Kubernetes ClickHouse manifest.
