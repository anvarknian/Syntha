# Fake Jira

Stateful Jira-like simulator for Syntha scenarios.

## Run

```bash
cd apps/fake-jira
npm ci
npm start
```

Default port: `3003`.

## Endpoints

- `GET /healthz`
- `GET /projects`
- `POST /issues`
- `GET /issues/:issueID`
- `POST /issues/:issueID/transition`

Replay events are recorded to `data/events/jira.jsonl` with schema `v1` + checksum integrity.
