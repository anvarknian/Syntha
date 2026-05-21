# Syntha - Synthetic Internet


<p align="center">
  <a href="https://github.com/anvarknian/syntha/actions/workflows/ci.yml?branch=main">
  <img src="https://img.shields.io/github/actions/workflow/status/openclaw/openclaw/ci.yml?branch=main&style=for-the-badge" alt="CI status">
  </a>
  <a href="https://github.com/anvarknian/syntha/releases">
  <img src="https://img.shields.io/github/v/release/anvarknian/syntha?include_prereleases&style=for-the-badge" alt="GitHub release">
  </a>
  <a href="LICENSE">
  <img src="https://img.shields.io/badge/License-Non_Commercial-blue.svg?style=for-the-badge" alt="Non-Commercial License">
  </a>
</p>

Synthetic Internet is a simulation platform for autonomous AI agents.
It creates realistic digital environments — browsers, SaaS apps, APIs, inboxes, users, and workflows — so agents can be tested safely at scale.

Instead of deploying agents directly into production, teams can run them against a synthetic enterprise world and evaluate:

* reliability
* hallucinations
* tool misuse
* security risks
* workflow failures
* adversarial behavior
* cost regressions
* long-running task performance

---

# The Problem

AI agents are increasingly interacting with:

* browsers
* APIs
* enterprise SaaS tools
* financial systems
* customer data
* production infrastructure

Yet most teams still evaluate them using:

* static benchmarks
* toy datasets
* handcrafted prompts
* human spot checks

Real-world deployment introduces:

* flaky browser behavior
* adversarial users
* prompt injection
* permission misuse
* long-running state corruption
* unpredictable API failures

There is currently no standard environment for safely testing autonomous agents at scale.

---

# Why This Exists

AI agents are becoming:

* autonomous
* stateful
* browser-native
* tool-using
* long-running

But today they are mostly tested with:

* static prompts
* toy datasets
* unrealistic evals
* manual QA

That breaks down quickly in production.

Synthetic Internet solves this by creating:

* fake companies
* fake users
* fake inboxes
* fake SaaS tools
* fake support systems
* fake browser workflows

…all fully interactive and dynamically generated.

---

# Why Existing Benchmarks Fall Short

Most AI benchmarks evaluate:

* reasoning
* coding
* static QA tasks

But autonomous agents operate in:

* dynamic environments
* stateful workflows
* unreliable systems
* adversarial conditions

Synthetic Internet focuses on:

* browser interaction
* enterprise workflows
* long-running execution
* security failures
* tool misuse
* real-world operational complexity

---

# Core Concepts

## Synthetic Worlds

A world is a fully simulated environment containing:

* users
* organizations
* permissions
* APIs
* browsers
* documents
* communication channels
* workflows
## Developer Quick Start

Developer prerequisites:


Start the dev stack (Redis + OpenTelemetry collector + API + browser-worker + fake SaaS apps + dashboard):

```bash
./scripts/start-dev.sh
```

Verify observability endpoints:

- OpenTelemetry Collector Prometheus endpoint: `http://localhost:9464/metrics`
- API Prometheus metrics: `http://localhost:9090/metrics`
- Dashboard: `http://localhost:3000`
- Fake Gmail health endpoint: `http://localhost:3001/healthz`
- Fake Slack health endpoint: `http://localhost:3002/healthz`
- Fake Jira health endpoint: `http://localhost:3003/healthz`
- Fake Salesforce health endpoint: `http://localhost:3004/healthz`
- ClickHouse HTTP endpoint: `http://localhost:8123`

Example verification commands:

```bash
# collector metrics
curl http://localhost:9464/metrics | head

# api metrics
curl http://localhost:9090/metrics | grep syntha
```

Run the API locally (requires Go) or via Docker:

```bash
# local (requires go):
go run ./apps/api

# via Docker:
cd apps/api
docker run --rm -p 8080:8080 -v "$PWD":/app -w /app golang:1.26 sh -c "go run ."
```

Run the browser-worker prototype:

```bash
cd apps/browser-worker
npm ci
npm run start
```

Run the dashboard locally:

```bash
cd apps/dashboard
npm ci
npm run dev
```

Run fake Slack locally:

```bash
cd apps/fake-slack
npm ci
npm start
```

Run fake Jira locally:

```bash
cd apps/fake-jira
npm ci
npm start
```

Run fake Salesforce locally:

```bash
cd apps/fake-salesforce
npm ci
npm start
```

Build the typed SDK for external agent instrumentation:

```bash
cd packages/sdk
npm ci
npm run build
```

Build the Syntha CLI:

```bash
cd apps/cli
go build -o ../../bin/syntha .
```

Render the Kubernetes base:

```bash
kubectl kustomize infrastructure/kubernetes/base
```

Validate a replay and ingest it into ClickHouse:

```bash
node services/replay-engine/replayer_run.js data/replays/test-replay.jsonl
node services/analytics/clickhouse_ingest.js data/replays/test-replay.jsonl --dry-run
```


Example:

```yaml
world:
  company: Acme Corp
  employees: 500
  tools:
    - Slack
    - Salesforce
    - Jira
    - Gmail
    - SAP
```

---

## Agent Evaluation

Run agents against realistic enterprise tasks:

```yaml
task:
  objective: "Resolve billing dispute"
  constraints:
    - max_cost: $2
    - no_human_help: true
    - pii_leakage: forbidden
```

---

## Adversarial Simulation

Generate:

* phishing emails
* malicious prompts
* broken APIs
* slow networks
* deceptive users
* permission escalation attempts

---

## Deterministic Replay

Replay every execution exactly:

* browser state
* tool outputs
* prompts
* memory
* API responses
* environment conditions

---

# Design Principles

## Deterministic

Every execution must be replayable.

## Stateful

Agents should experience persistent environments.

## Adversarial

The system should actively generate failures and attacks.

## Scalable

Simulations should run across thousands of concurrent agents.

## Observable

Every action, prompt, and tool call should be traceable.

## Provider-Agnostic

Compatible with any model or agent framework.

---

# Architecture

```text
                ┌────────────────────┐
                │ Agent Under Test   │
                └─────────┬──────────┘
                          │
              ┌───────────▼────────────┐
              │ Synthetic Internet API │
              └───────┬───────┬────────┘
                      │       │
         ┌────────────▼──┐ ┌──▼─────────────┐
         │ Fake SaaS Apps│ │ Browser Worlds │
         └───────────────┘ └────────────────┘
                      │
           ┌──────────▼───────────┐
           │ Scenario Orchestrator│
           └──────────┬───────────┘
                      │
         ┌────────────▼────────────┐
         │ State + Event Simulation│
         └─────────────────────────┘
```

---

# Features

## Browser Simulation

Current (implemented):

* Playwright execution with persistent session state
* Multi-tab runs via configurable URL sets
* Deterministic seed capture per run target
* Screenshot artifact recording per tab
* DOM snapshot capture per tab
* CAPTCHA signal detection (reCAPTCHA/hCaptcha indicators)
* Replay event emission (`playwright_run`)

Planned (not yet implemented):

* Robust CAPTCHA solving strategies

Built with:

* Playwright
* Chrome DevTools Protocol

---

## Fake SaaS Ecosystem

Current (implemented):

* Gmail
* Slack
* Jira
* Salesforce

* realistic APIs
* latency
* permissions
* failures
* evolving state

Planned:

* Notion
* Zendesk
* Stripe
* internal dashboards

---

## Scenario Engine

Create dynamic simulations:

```yaml
scenario:
  trigger:
    type: phishing_email

  expected_behavior:
    - detect_attack
    - avoid_clicking_link
    - report_security_issue
```

---

## Observability

Current telemetry includes:

* replay events
* screenshots
* publish retries and event counters
* OpenTelemetry traces and OTLP metrics

Planned:

* prompt/tool-call level capture across all runtimes
* token-usage reporting
* richer browser action traces

Powered by:

* OpenTelemetry
* ClickHouse
* Kafka/Redpanda

---

## Massive Parallel Simulation

Current state:

* local and Kubernetes deployment scaffolding
* horizontal pod autoscaling policies for key services

Long-term target:

* thousands of agents
* across millions of synthetic interactions
* in isolated containerized environments

Powered by:

* Kubernetes
* Temporal workflows

Planned isolation hardening:

* Firecracker microVMs / equivalent sandboxed execution

---

# Supported Frameworks

Current:

* custom agent runtimes via REST + SDK + replay schema

Planned integrations:

* LangGraph
* CrewAI
* AutoGen
* OpenAI Agents SDK
* custom agent runtimes

Integration is provided through:

* SDKs
* OpenTelemetry traces
* REST APIs
* browser instrumentation

---

# AI Security Research

Synthetic Internet can be used to evaluate:

* prompt injection resistance
* jailbreak susceptibility
* privilege escalation
* sensitive data exfiltration
* phishing vulnerability
* unsafe autonomous actions

The platform enables reproducible AI security testing in isolated environments.

---

# Example Workflow

1. Create a synthetic enterprise environment
2. Deploy a customer-support agent
3. Generate 50,000 synthetic customer interactions
4. Inject adversarial prompts and API failures
5. Record every execution trace
6. Replay failures deterministically
7. Compare model/provider performance
8. Generate evaluation reports

---

# Example Use Cases

## Enterprise AI QA

Before deploying a customer support agent:

* simulate 100k angry customers
* inject malicious prompts
* replay edge cases
* measure hallucination rates

---

## Browser Agent Benchmarking

Evaluate:

* checkout flows
* CRM automation
* procurement workflows
* recruiting tasks

Across:

* different models
* prompts
* memory systems

---

## Security Testing

Test:

* prompt injection resistance
* data exfiltration
* privilege escalation
* unsafe tool usage

---

# Tech Stack

| Layer              | Technology    |
| ------------------ | ------------- |
| Frontend           | Next.js       |
| Backend            | Go            |
| Workflow Engine    | Temporal      |
| Browser Automation | Playwright    |
| Containers         | Docker        |
| Isolation          | Firecracker   |
| Orchestration      | Kubernetes    |
| Event Streaming    | Redpanda      |
| Database           | Postgres      |
| Analytics          | ClickHouse    |
| Vector Search      | pgvector      |
| Storage            | S3/R2         |
| Tracing            | OpenTelemetry |

---

# Quick Start

## Start Infrastructure

```bash
./scripts/start-dev.sh
```

---

## Create a Synthetic World

```bash
./bin/syntha world create acme-corp
```

---

## Launch Browser Cluster

```bash
./bin/syntha browsers start
```

---

## Run Agent Evaluation

```bash
./bin/syntha eval run data/scenarios/support-agent.yaml
```

---

# Example Evaluation Output

```json
{
  "success_rate": 0.82,
  "hallucination_rate": 0.04,
  "security_violations": 2,
  "avg_cost": 0.38,
  "avg_runtime_seconds": 41
}
```

---

# Planned Integrations

## SaaS Simulators

* Slack
* Salesforce
* Jira
* SAP
* ServiceNow
* Workday

## Cloud Platforms

* AWS
* GCP
* Azure

## Security Systems

* SIEM integrations
* audit pipelines
* policy engines

## Agent Frameworks

* LangChain
* OpenAI Agents
* Semantic Kernel

---

# Open Source Philosophy

Synthetic Internet is built around:

* open evaluation standards
* reproducible benchmarks
* portable simulations
* framework interoperability

We believe AI agent evaluation infrastructure should be transparent, reproducible, and community-driven.

---

# Roadmap

## Phase 1

* Browser simulation
* Fake SaaS apps
* Replay engine
* Trace collection

## Phase 2

* Multi-agent worlds
* Adversarial user generation
* Synthetic enterprise datasets
* Security testing

## Phase 3

* Benchmark marketplace
* Public evaluation leaderboards
* Compliance certification
* Industry-standard agent benchmarks

---

# Vision

Software engineering eventually standardized around:

* CI/CD
* testing frameworks
* observability
* staging environments

AI agents will require the same evolution.

Synthetic Internet aims to become the standard simulation layer for autonomous systems operating on the internet.

---

# Long-Term Vision

Synthetic Internet aims to become:

> The standard testing environment for autonomous AI systems.

Like:

* BrowserBench for browsers
* MLPerf for machine learning
* Kubernetes for orchestration

…but for AI agents operating in the real world.

---

# License

Custom Non-Commercial License (See [LICENSE](LICENSE))
