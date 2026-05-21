# Replay Engine — Packer

Deterministic packer that reads `data/events/*.jsonl`, normalizes events to schema `v1`, sorts deterministically, assigns contiguous `sequence` numbers, and computes event `checksum` values.

Run:

```bash
node services/replay-engine/replayer.js
```

Replay runner

```bash
node services/replay-engine/runner.js data/replays/replay-<ts>.jsonl --delay-ms=200
```

Notes:
- Validate replay integrity only:

```bash
node services/replay-engine/replayer_run.js data/replays/replay-<ts>.jsonl
```

- By default `email_received` events are replayed to `http://localhost:3001/send`. Set `FAKE_GMAIL_URL` to change the target.
- By default fake Slack events (`slack_channel_created`, `slack_message_posted`, `slack_prompt_injection`) replay to `http://localhost:3002`. Set `FAKE_SLACK_URL` to change the target.
- By default fake Jira events (`jira_issue_created`, `jira_issue_transitioned`) replay to `http://localhost:3003`. Set `FAKE_JIRA_URL` to change the target.
- By default fake Salesforce events (`salesforce_case_created`, `salesforce_case_assigned`) replay to `http://localhost:3004`. Set `FAKE_SALESFORCE_URL` to change the target.
- Replay egress is sandboxed with an allowlist. Override with:
  - `REPLAY_ALLOWED_ORIGINS=http://localhost:3001,http://localhost:3002,http://localhost:3003,http://localhost:3004,http://localhost:8080`
- Replay status validation is strict. You can set per-event `metadata.expected_status` in replay events.
- Continue after event failures with:
  - `--continue-on-error`
