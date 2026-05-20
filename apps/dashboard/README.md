# Syntha Dashboard

Next.js control surface for Phase 4 trace visualization, replay integrity checks, and scenario launch workflows.

## Run

```bash
cd apps/dashboard
npm ci
npm run dev
```

Environment:

- `SYNTHA_API_URL`: simulation API base URL, defaults to `http://localhost:8080`.
- `SYNTHA_DATA_DIR`: data directory containing `replays/`, defaults to the repo `data` directory in local development.
