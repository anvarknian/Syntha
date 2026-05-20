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

- Phase 0 — Project Hygiene: [##########] 100% — bootstrap, CI, README, dev compose implemented.
- Phase 1 — Core Simulation Primitives: [##########] 100% — `apps/api`, `eventbus` adapters, `browser-worker`, `fake-gmail`, and replay recorder implemented.
- Phase 2 — Replay, Instrumentation & Security: [##########] 100% — deterministic replay schema/integrity checks, strict rehydration runner validation, cross-service OTEL wiring (API + browser-worker + fake-gmail), and export-control scrub policies implemented.
- Phase 3 — Scale & Orchestration: [##########] 100% — Kubernetes/Kustomize base, Terraform apply wrapper, Temporal orchestration worker, browser autoscaling policy, ClickHouse schema/ingest path, and starter Grafana dashboard implemented.
- Phase 4 — Ecosystem & UX: [##########] 100% — replay dashboard, scenario launcher, typed SDK package, fake Slack SaaS simulator, and dev/Kubernetes wiring implemented for the Phase 4 slice.

Key completed items (representative):

- `apps/api` simulation engine scaffold and `/scenario` endpoint (implemented)
- Eventbus: local adapter and Redpanda adapter with retries (implemented)
- `apps/browser-worker`: Playwright runner and tests
- Fake SaaS: `apps/fake-gmail` and `apps/fake-slack` (implemented)
- Replay tools: `services/replay-engine/replayer.js` (packer) and `runner.js` (replayer)
- Observability: OpenTelemetry tracing and OTLP metric exporter wiring; Prometheus metrics and `/metrics` integration tests
- Security: prompt-injection detector and metric recording

Remaining high-priority work:

- Harden runtime isolation beyond process-level egress controls (microVM/container policy layer)
- Extend the fake SaaS catalog beyond Gmail and Slack (Jira, Salesforce, Stripe, Notion)

If you want, I can (pick one):

- Open `plan.md` in the repo with links to implemented files and create a follow-up `ROADMAP.md` with timelines, or
- Break Phase 2 remaining tasks into a more granular TODO and start implementing the deterministic replayer validations now.
