#!/usr/bin/env bash
set -euo pipefail

echo "Starting dev stack with docker compose..."
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d
echo "Dev stack started."
echo "Dashboard: http://localhost:3000"
echo "OpenTelemetry Collector Prometheus endpoint: http://localhost:9464/metrics"
echo "API Prometheus metrics: http://localhost:9090/metrics"
echo "Fake Gmail health endpoint: http://localhost:3001/healthz"
echo "Fake Slack health endpoint: http://localhost:3002/healthz"
echo "To verify traces/metrics, curl the collector and API endpoints after starting services."
