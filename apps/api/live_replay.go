package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const dashboardReplayFile = "dashboard-events.jsonl"
const maxDashboardReplaySeed = int64(1<<31 - 1)

type localReplayRecorder struct {
	dataDir string
	mu      sync.Mutex
}

type replayAppendResult struct {
	FileName string `json:"replay_file"`
	Sequence int64  `json:"replay_sequence"`
}

func newLocalReplayRecorder(dataDir string) *localReplayRecorder {
	return &localReplayRecorder{dataDir: dataDir}
}

func (r *localReplayRecorder) appendScenarioCreated(ctx context.Context, scenarioID string, seed int64, createdAt time.Time, payload interface{}) (replayAppendResult, error) {
	if r == nil {
		return replayAppendResult{}, nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	if err := ctx.Err(); err != nil {
		return replayAppendResult{}, err
	}

	dir := filepath.Join(r.dataDir, "replays")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return replayAppendResult{}, fmt.Errorf("mkdir replay dir: %w", err)
	}
	filePath := filepath.Join(dir, dashboardReplayFile)
	sequence, err := nextReplaySequence(filePath)
	if err != nil {
		return replayAppendResult{}, err
	}

	payloadMap := map[string]interface{}{"body": payload}
	replaySeed := seed % maxDashboardReplaySeed
	if replaySeed < 0 {
		replaySeed = -replaySeed
	}
	ev := replayEvent{
		ID:        scenarioID,
		Timestamp: createdAt.Format(time.RFC3339Nano),
		Kind:      "scenario_created",
		Seed:      json.Number(fmt.Sprintf("%d", replaySeed)),
		Payload:   payloadMap,
		Metadata: map[string]interface{}{
			"run_id":         "dashboard-events",
			"schema_version": "v1",
			"source":         "dashboard",
			"source_file":    dashboardReplayFile,
			"source_line":    sequence,
			"original_seed":  fmt.Sprintf("%d", seed),
		},
		Sequence: json.Number(fmt.Sprintf("%d", sequence)),
	}
	checksum, err := computeReplayChecksum(ev)
	if err != nil {
		return replayAppendResult{}, fmt.Errorf("compute checksum: %w", err)
	}
	ev.Checksum = checksum

	encoded, err := json.Marshal(ev)
	if err != nil {
		return replayAppendResult{}, fmt.Errorf("marshal replay event: %w", err)
	}
	f, err := os.OpenFile(filePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return replayAppendResult{}, fmt.Errorf("open replay file: %w", err)
	}
	defer f.Close()
	if _, err := f.Write(append(encoded, '\n')); err != nil {
		return replayAppendResult{}, fmt.Errorf("append replay event: %w", err)
	}

	return replayAppendResult{FileName: dashboardReplayFile, Sequence: sequence}, nil
}

func nextReplaySequence(filePath string) (int64, error) {
	file, err := os.Open(filePath)
	if os.IsNotExist(err) {
		return 1, nil
	}
	if err != nil {
		return 0, fmt.Errorf("open replay file for sequence: %w", err)
	}
	defer file.Close()

	var count int64
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 1024), 16*1024*1024)
	for scanner.Scan() {
		if strings.TrimSpace(scanner.Text()) != "" {
			count++
		}
	}
	if err := scanner.Err(); err != nil {
		return 0, fmt.Errorf("scan replay file for sequence: %w", err)
	}
	return count + 1, nil
}
