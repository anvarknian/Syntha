# Fake Salesforce

Stateful Salesforce-like simulator for Syntha scenarios.

## Run

```bash
cd apps/fake-salesforce
npm ci
npm start
```

Default port: `3004`.

## Endpoints

- `GET /healthz`
- `GET /accounts`
- `POST /cases`
- `GET /cases/:caseID`
- `POST /cases/:caseID/assign`

Replay events are recorded to `data/events/salesforce.jsonl` with schema `v1` + checksum integrity.
