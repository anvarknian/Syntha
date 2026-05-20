# Fake Gmail Service

Simple fake Gmail-like HTTP service for Phase 1.

Endpoints:
- `GET /inbox` — returns in-memory messages
- `GET /healthz` — simple health endpoint
- `POST /send` — send a message (body: `{to, from, subject, body}`)

Events are appended to `data/events/gmail.jsonl` using replay schema `v1` with sequence + checksum integrity fields.

Security and export controls:
- `EXPORT_ALLOW_RAW_PII=true` to disable PII scrubbing in exported replay events.
- `EXPORT_DENY_FIELDS=body,subject` to force-redact matching payload keys from exported events.

Run:

```bash
cd apps/fake-gmail
npm ci
npm start
```
