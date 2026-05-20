SHELL := /bin/bash
.PHONY: start-dev run-worker run-api run-fake-gmail run-fake-slack run-dashboard lint k8s-render

start-dev:
	./scripts/start-dev.sh

run-worker:
	node apps/browser-worker/run_playwright.js

run-api:
	cd apps/api && go run .

run-fake-gmail:
	cd apps/fake-gmail && npm start

run-fake-slack:
	cd apps/fake-slack && npm start

run-dashboard:
	cd apps/dashboard && npm run dev

k8s-render:
	kubectl kustomize infrastructure/kubernetes/base

lint:
	@echo "Running basic linters/checks"
	cd apps/api && go vet ./...
	cd apps/browser-worker && npm ci --no-audit --no-fund
	cd apps/fake-gmail && npm ci --no-audit --no-fund
	cd apps/fake-slack && npm ci --no-audit --no-fund && npm test
	cd apps/dashboard && npm ci --no-audit --no-fund && npm run typecheck && npm run build
	cd packages/sdk && npm ci --no-audit --no-fund && npm run typecheck && npm run build
	node --test services/replay-engine/tests/*.test.js
	node -c services/analytics/clickhouse_ingest.js
	node services/analytics/clickhouse_ingest.js data/replays/test-replay.jsonl --dry-run
	cd services/orchestrator && go test ./...
	kubectl kustomize infrastructure/kubernetes/base >/tmp/syntha-k8s.yaml
	docker compose -f infrastructure/docker/docker-compose.dev.yml config >/tmp/syntha-compose.yaml
