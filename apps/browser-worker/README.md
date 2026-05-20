# Browser Worker

Simple scaffold for a Playwright-based browser worker. The prototype records one browser run, writes a screenshot to `data/artifacts`, and appends an event to `data/events/playwright.jsonl`.

Run locally (requires Node.js):

```bash
cd apps/browser-worker
npm ci
npm run start
```

To run against a specific URL instead of the default `about:blank`, set `PLAYWRIGHT_TARGET_URL`.
