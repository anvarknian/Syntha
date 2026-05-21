SHELL := /bin/bash
.PHONY: start-dev run-worker run-api run-fake-gmail run-fake-slack run-fake-jira run-fake-salesforce run-dashboard lint k8s-render build-cli run-cli-help clean

start-dev:
	./scripts/start-dev.sh

clean:
	@echo "Cleaning up cached data, dependencies, and Docker volumes for a fresh restart..."
	docker compose -f infrastructure/docker/docker-compose.dev.yml down -v --remove-orphans
	@for dir in data/events data/replays data/artifacts data/dom-snapshots; do \
		if [[ -d "$$dir" ]]; then \
			find "$$dir" -type f ! -name "*.jsonl" -delete; \
			find "$$dir" -mindepth 1 -type d -empty -delete; \
		fi; \
	done
	rm -rf bin/syntha
	find . -name "node_modules" -type d -prune -exec rm -rf '{}' +
	find . -name ".next" -type d -prune -exec rm -rf '{}' +
	@echo "Clean complete."

run-worker:
	node apps/browser-worker/run_playwright.js

run-api:
	cd apps/api && go run .

run-fake-gmail:
	cd apps/fake-gmail && npm start

run-fake-slack:
	cd apps/fake-slack && npm start

run-fake-jira:
	cd apps/fake-jira && npm start

run-fake-salesforce:
	cd apps/fake-salesforce && npm start

run-dashboard:
	cd apps/dashboard && npm run dev

build-cli:
	cd apps/cli && go build -o ../../bin/syntha .

run-cli-help:
	cd apps/cli && go run . help

k8s-render:
	kubectl kustomize infrastructure/kubernetes/base

lint:
	@echo "Running basic linters/checks"
	cd apps/api && go vet ./...
	cd apps/browser-worker && npm ci --no-audit --no-fund
	cd apps/fake-gmail && npm ci --no-audit --no-fund
	cd apps/fake-slack && npm ci --no-audit --no-fund && npm test
	cd apps/fake-jira && npm ci --no-audit --no-fund && npm test
	cd apps/fake-salesforce && npm ci --no-audit --no-fund && npm test
	cd apps/dashboard && npm ci --no-audit --no-fund && npm run typecheck && npm run build
	cd packages/sdk && npm ci --no-audit --no-fund && npm run typecheck && npm run build
	node --test services/replay-engine/tests/*.test.js
	node -c services/analytics/clickhouse_ingest.js
	node services/analytics/clickhouse_ingest.js data/replays/test-replay.jsonl --dry-run
	cd services/orchestrator && go test ./...
	kubectl kustomize infrastructure/kubernetes/base >/tmp/syntha-k8s.yaml
	docker compose -f infrastructure/docker/docker-compose.dev.yml config >/tmp/syntha-compose.yaml
