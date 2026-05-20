# Fake Slack

Fake Slack is a stateful SaaS simulator for Syntha scenarios. It exposes realistic channel and message workflows while recording replay schema `v1` events into `data/events/slack.jsonl`.

## Run

```bash
cd apps/fake-slack
npm ci
npm start
```

Default port: `3002`.

## Endpoints

- `GET /healthz`
- `GET /users`
- `GET /channels`
- `POST /channels`
- `GET /channels/:channelID/messages`
- `POST /channels/:channelID/messages`
- `POST /send`
- `POST /adversarial/prompt-injection`

## Controls

- `FAKE_SLACK_TOKEN`: require `Authorization: Bearer <token>` when set.
- `FAKE_SLACK_LATENCY_MS`: inject fixed API latency.
- `FAKE_SLACK_RATE_LIMIT_PER_MINUTE`: per-process rate limit.
- `EXPORT_DENY_FIELDS`: comma-separated fields to redact.
- `EXPORT_ALLOW_RAW_PII=true`: disable built-in PII scrubbing for controlled local debugging.
