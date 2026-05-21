# Browser Worker

Playwright-based browser worker with deterministic replay event output.

Current capabilities:

- Persistent session state (`data/browser-sessions/<session-id>.json`)
- Multi-tab execution (`PLAYWRIGHT_EXTRA_URLS`)
- Screenshot artifacts per tab (`data/artifacts`)
- DOM snapshots per tab (`data/dom-snapshots`)
- CAPTCHA signal detection (reCAPTCHA/hCaptcha markers) and handling delay
- Replay event append to `data/events/playwright.jsonl`

Run locally (requires Node.js):

```bash
cd apps/browser-worker
npm ci
npm run start
```

To run against a specific URL instead of the default `about:blank`, set `PLAYWRIGHT_TARGET_URL`.

Optional environment variables:

- `PLAYWRIGHT_EXTRA_URLS`: comma-separated extra URLs opened in additional tabs.
- `PLAYWRIGHT_SESSION_ID`: session key for persistent storage state.
- `PLAYWRIGHT_PERSIST_SESSION`: `true/false`, defaults to `true`.
- `PLAYWRIGHT_CAPTURE_DOM`: `true/false`, defaults to `true`.
- `PLAYWRIGHT_CAPTCHA_TIMEOUT_MS`: wait time after CAPTCHA detection, defaults to `2000`.
