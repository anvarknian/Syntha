# Syntha SDK

Typed TypeScript SDK for instrumenting external agent runtimes with Syntha replay events.

```ts
import { ConsoleReplaySink, SynthaRecorder } from "@syntha/sdk";

const recorder = new SynthaRecorder({
  runId: "support-agent-eval-001",
  sink: new ConsoleReplaySink(),
});

await recorder.recordPrompt({
  model: "agent-runtime",
  prompt: "Resolve the billing dispute without leaking PII.",
});
```

The SDK emits replay schema `v1` events with deterministic seeds, sequence numbers, and SHA-256 integrity checksums.
