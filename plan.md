# Syntha Implementation Plan

This document is a concise, actionable plan to implement the Synthetic Internet (Syntha) platform. It organizes work into phases, top-priority milestones, and immediate next steps so contributors can make steady, verifiable progress.

## Summary
- Goal: Build a deterministic, observable, and secure simulation platform for evaluating autonomous AI agents at scale.
- Scope: browser cluster, fake SaaS ecosystem, replay system, orchestration, observability, infra, and developer tools.

## Guiding Constraints
- Deterministic replayability (record seeds, inputs, environment state).
- Secure-by-default isolation for untrusted agent code.
- Observable: OpenTelemetry traces, metrics, logs, artifacts.
- Modular microservices for horizontal scaling.

## Phases & Milestones

Phase 0 — Project Hygiene & Onboarding (1–2 weeks)
- Tasks:
  - Create `plan.md` (this file) and high-level docs.
  - Add development bootstrap: `docker-compose` or dev `Makefile` for local runs.
  - Define repository structure and minimal `README` changes.
  - Add CI job templates for linting/tests.

Phase 1 — Core Simulation Primitives (2–4 weeks)
- Tasks:
  - Simulation engine scaffold (Go service): accept scenario YAMLs, emit events.
  - Event bus integration (Kafka/Redpanda-compatible interface).
  - Minimal browser cluster (Playwright) worker: spawn ephemeral sessions, capture screenshots, DOM snapshots.
  - Simple fake SaaS service (HTTP API) — implement a basic Gmail-like inbox simulator.
  - Basic replay recorder: append-only event storage to S3/Local filesystem.

Phase 2 — Replay, Instrumentation, and Security (3–6 weeks)
- Tasks:
  - Deterministic replay runner: rehydrate events, re-execute flows, validate outputs.
  - OpenTelemetry instrumentation across services and forwarding to local collector.
  - Security subsystem: sandboxing guidance, prompt-injection detector middleware, scrubbers.
  - Add PII scrubbing plugins and export controls.

Phase 3 — Scale, Orchestration & Observability (4–8 weeks)
- Tasks:
  - Kubernetes manifests / Helm charts and Terraform modules.
  - Temporal workflow integration for long-running simulations.
  - Autoscaling browser-cluster (resource/operator guidance).
  - ClickHouse analytics pipeline and example dashboards.

Phase 4 — Ecosystem & UX (ongoing)
- Tasks:
  - Expand fake SaaS integrations (Slack, Jira, Salesforce, Stripe, Notion).
  - Dashboard (Next.js) for trace visualization, replay timeline, and scenario management.
  - SDKs for instrumenting external agent runtimes.

## Initial Priorities (what to do first)
1. Add a small reproducible dev environment: `docker-compose` that starts:
   - a local Redis / Kafka replacement or Redpanda
   - a local OpenTelemetry collector
   - a minimal Playwright worker container
2. Implement a minimal Simulation Engine HTTP API (Go): POST scenario -> returns scenario id.
3. Implement a Playwright worker that consumes tasks from the event bus and records events to a local folder.
4. Create the initial replay format (JSONL events with deterministic seeds) and a small replayer CLI.

## Deliverables for MVP
- `simulation-engine` service (receives scenarios)
- `browser-worker` (Playwright-based executor)
- `event-bus` adapter (local dev mode)
- `replay-recorder` (JSONL, S3/local)
- basic `docs/` describing how to run the dev stack

## File Structure (recommended)

```
/apps
  /api                 # simulation engine, REST endpoints
  /cli                 # syntha CLI
  /browser-worker      # Playwright worker
  /dashboard           # Next.js dashboard

/packages
  /sdk
  /proto

/services
  /replay-engine
  /event-bus-adapter

/infrastructure
  /docker
  /k8s
  /terraform
```

## Roles & Ownership (initial)
- Core infra: `infra-agent` — cluster, k8s, terraform.
- Browser & UI: `frontend-agent` — Playwright worker & dashboard.
- Replay & determinism: `replay-agent` — event schema and replayer.
- Security: `security-agent` — sanitizers and runtime guards.

## Estimates & Metrics
- Sprint-sized milestones: plan work in 2-week sprints.
- Key metrics to track: successful replay rate, simulation throughput, security violations, avg runtime, cost per run.

## Risks & Mitigations
- Risk: non-determinism in browser playback. Mitigation: capture network responses, seeds, DOM snapshots.
- Risk: unsafe agent code. Mitigation: run in microVMs or strict container sandboxes; restrict egress.

## Immediate Next Steps (for me)
1. Summarize the loaded Markdown files and extract action items (in-progress).
2. Create a minimal `docker-compose` dev stack scaffold and `apps/api` service skeleton.
3. Implement a very small Playwright worker prototype and a JSONL recorder.

---
Created by automation on repository scan. To iterate: edit this file and assign owners to tasks.

## Progress Overview (automated review)

Phase completion bars use a 10-step scale.

- Phase 0 — Project Hygiene: [##########] 100% — bootstrap, CI, README, and dev compose are in place.
- Phase 1 — Core Simulation Primitives: [#########-] 90% — `apps/api`, eventbus adapters, browser worker prototype, fake Gmail/Slack, and replay recorder are implemented; multi-tab/CAPTCHA/DOM snapshot depth remains.
- Phase 2 — Replay, Instrumentation & Security: [########--] 80% — replay schema/integrity checks and egress allowlist are implemented; broader deterministic re-execution coverage and stronger runtime isolation are still open.
- Phase 3 — Scale & Orchestration: [########--] 85% — Kubernetes base, Terraform apply wrapper, Temporal worker scaffolding, staged workflow orchestration, autoscaling policy, and ClickHouse ingest path are implemented.
- Phase 4 — Ecosystem & UX: [########--] 80% — replay dashboard, scenario launcher, typed SDK package, fake Slack simulator, and an initial `syntha` CLI are implemented.

Key completed items (representative):

- `apps/api` simulation engine scaffold and `/scenario` endpoint (implemented)
- Eventbus: local adapter and Redpanda adapter with retries (implemented)
- `apps/browser-worker`: Playwright runner and tests
- Fake SaaS: `apps/fake-gmail` and `apps/fake-slack` (implemented)
- Replay tools: `services/replay-engine/replayer.js` (packer) and `runner.js` (replayer)
- Observability: OpenTelemetry tracing and OTLP metric exporter wiring; Prometheus metrics and `/metrics` integration tests
- Security: prompt-injection detector and metric recording
- CLI: `apps/cli` now supports `world create`, `browsers start`, and `eval run`

## Next Phases (Grouped by Theme)

Phase 5 — Browser Intelligence & Realism
- Implement robust CAPTCHA solving strategies (beyond signal detection).
- Expand browser action tracing fidelity for replay/debugging (navigation, form actions, network captures).

Phase 6 — Fake SaaS Expansion
- Add new simulators: Notion, Zendesk, Stripe, internal dashboards.
- Expand enterprise catalog with SAP, ServiceNow, and Workday simulators.
- Preserve deterministic replay event contracts and test fixtures for each new service.

Phase 7 — Deep Observability & Evaluation Signals
- Capture prompt/tool-call level traces across all runtimes.
- Add token-usage and model-cost telemetry pipelines.
- Enrich replay analytics and dashboard visualizations for failure attribution.

Phase 8 — Runtime Isolation Platform
- Add Firecracker microVM (or equivalent hardened sandbox) execution path.
- Define workload policy profiles (network, filesystem, resource, credential scopes) per agent class.
- Integrate isolation controls with orchestrator scheduling and replay reproducibility guarantees.

Phase 9 — Scale & World Simulation
- Build multi-agent world orchestration primitives.
- Add adversarial user generation and synthetic enterprise dataset evolution workflows.
- Validate high-concurrency execution targets (thousands of agents, millions of interactions).

Phase 10 — Integrations & Ecosystem Connectivity
- Add first-class framework adapters: LangGraph, CrewAI, AutoGen, OpenAI Agents SDK, LangChain, Semantic Kernel.
- Add cloud/system integration surfaces: AWS, GCP, Azure, SIEM/audit/policy-engine connectors.
- Ship stable SDK/API integration contracts with replay-safe instrumentation defaults.

Phase 11 — Benchmark Ecosystem & Standards
- Launch benchmark marketplace and reusable scenario packs.
- Publish public evaluation leaderboards.
- Define compliance/certification-style evaluation tracks.
- Standardize an industry-grade benchmark suite for autonomous agent behavior.

## Phase 12+ Opportunity Map (Impact/Effort Ranked)

Legend:
- Impact: `H` high, `M` medium
- Effort: `L` low, `M` medium, `H` high

Priority Tier A (high-impact, near-term):
- Counterfactual replay engine (`H` impact / `M` effort)
  - Re-run the same trace with different model/tool policies and generate deterministic diffs.
- Agent flight recorder (`H` impact / `M` effort)
  - Capture decision boundaries, tool arguments, memory mutations, and policy checkpoints per run.
- Safety gate simulation (`H` impact / `M` effort)
  - Inline policy-gate testing before tool execution; score preventions, misses, and false positives.
- Cost/latency optimizer (`H` impact / `M` effort)
  - Auto-tune model routing/prompt/tool strategies against reliability, latency, and budget constraints.

Priority Tier B (platform differentiation):
- Scenario DSL + compiler (`H` impact / `H` effort)
  - Introduce typed scenario definitions that compile to deterministic world/event/failure plans.
- Synthetic human behavior models (`H` impact / `H` effort)
  - Persona-driven users that evolve over time (urgency, frustration, deception, compliance drift).
- Governance/compliance layer (`H` impact / `M` effort)
  - Map control requirements to measurable simulation checks and attestable outputs.

Priority Tier C (ecosystem expansion):
- Adversary marketplace (`M` impact / `M` effort)
  - Shareable/red-team scenario packs for prompt injection, phishing, and privilege escalation families.
- Benchmark-as-a-service (`H` impact / `H` effort)
  - Hosted runs with signed reproducibility artifacts and public/private leaderboard submissions.
- Digital twin mode (`H` impact / `H` effort)
  - Mirror enterprise workflows safely via anonymized schemas and replay-safe surrogate data.
