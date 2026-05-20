# Simulation Engine (api)

Minimal scaffold for the Simulation Engine HTTP API. Provides a single endpoint:

- `POST /scenario` — accepts a YAML scenario payload, validates it, and returns a `scenario_id`.

Prerequisites

- Go toolchain (recommended): install via Homebrew on macOS or from https://golang.org/dl/

Run locally (requires Go):

```bash
go run ./main.go
curl -X POST --data-binary @example.yaml http://localhost:8080/scenario
```

Run via Docker (no local Go required):

```bash
# from repository root
cd apps/api
docker run --rm -p 8080:8080 -v "$PWD":/app -w /app golang:1.26 sh -c "go run ."
```

Verify Go installation:

```bash
go version
```
