# Syntha CLI

CLI for core local Syntha workflows.

## Build

```bash
cd apps/cli
go build -o ../../bin/syntha .
```

## Commands

```bash
# create a world/scenario
syntha world create acme-corp

# run browser worker once
syntha browsers start --target-url https://example.com

# submit eval scenario and optionally replay validation
syntha eval run data/scenarios/support-agent.yaml --replay-file data/replays/test-replay.jsonl
```

All commands support `--json` for machine-readable output.
