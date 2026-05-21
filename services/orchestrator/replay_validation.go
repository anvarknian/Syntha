package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const replaySchemaVersion = "v1"

type replayEvent struct {
	ID        string                 `json:"id"`
	Timestamp string                 `json:"timestamp"`
	Kind      string                 `json:"kind"`
	Seed      json.Number            `json:"seed"`
	Payload   map[string]interface{} `json:"payload"`
	Metadata  map[string]interface{} `json:"metadata"`
	Sequence  json.Number            `json:"sequence"`
	Checksum  string                 `json:"checksum"`
}

type replayValidationSummary struct {
	RunID      string
	EventCount int
}

func validateReplayFile(ctx context.Context, replayFile string) (replayValidationSummary, error) {
	file, err := os.Open(replayFile)
	if err != nil {
		return replayValidationSummary{}, fmt.Errorf("open replay file: %w", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 1024), 16*1024*1024)

	var (
		lineNo        int
		eventCount    int
		lastSeq       int64
		lastTimestamp time.Time
		runID         string
	)

	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return replayValidationSummary{}, err
		}
		lineNo++
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		eventCount++

		ev, err := decodeReplayEvent(line)
		if err != nil {
			return replayValidationSummary{}, fmt.Errorf("line %d: %w", lineNo, err)
		}
		if err := validateReplayEvent(ev, &lastSeq, &lastTimestamp, &runID); err != nil {
			return replayValidationSummary{}, fmt.Errorf("line %d: %w", lineNo, err)
		}
	}
	if err := scanner.Err(); err != nil {
		return replayValidationSummary{}, fmt.Errorf("scan replay file: %w", err)
	}
	if eventCount == 0 {
		return replayValidationSummary{}, errors.New("replay file has no events")
	}
	if runID == "" {
		return replayValidationSummary{}, errors.New("replay file missing run_id metadata")
	}

	return replayValidationSummary{
		RunID:      runID,
		EventCount: eventCount,
	}, nil
}

func summarizeReplayKinds(ctx context.Context, replayFile string) (map[string]int, error) {
	file, err := os.Open(replayFile)
	if err != nil {
		return nil, fmt.Errorf("open replay file: %w", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 1024), 16*1024*1024)

	out := map[string]int{}
	lineNo := 0
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		lineNo++
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		ev, err := decodeReplayEvent(line)
		if err != nil {
			return nil, fmt.Errorf("line %d: %w", lineNo, err)
		}
		if strings.TrimSpace(ev.Kind) == "" {
			return nil, fmt.Errorf("line %d: missing event kind", lineNo)
		}
		out[ev.Kind]++
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan replay file: %w", err)
	}
	if len(out) == 0 {
		return nil, errors.New("replay file has no events")
	}
	return out, nil
}

func decodeReplayEvent(line string) (replayEvent, error) {
	dec := json.NewDecoder(strings.NewReader(line))
	dec.UseNumber()

	var ev replayEvent
	if err := dec.Decode(&ev); err != nil {
		return replayEvent{}, fmt.Errorf("invalid JSON: %w", err)
	}
	return ev, nil
}

func validateReplayEvent(ev replayEvent, lastSeq *int64, lastTimestamp *time.Time, runID *string) error {
	if strings.TrimSpace(ev.ID) == "" {
		return errors.New("missing event id")
	}
	if strings.TrimSpace(ev.Kind) == "" {
		return errors.New("missing event kind")
	}

	ts, err := parseReplayTimestamp(ev.Timestamp)
	if err != nil {
		return fmt.Errorf("invalid timestamp: %w", err)
	}
	if !lastTimestamp.IsZero() && ts.Before(*lastTimestamp) {
		return errors.New("non-monotonic timestamp")
	}
	*lastTimestamp = ts

	seed, err := numberToInt64(ev.Seed)
	if err != nil {
		return fmt.Errorf("invalid seed: %w", err)
	}
	_ = seed

	if ev.Payload == nil {
		return errors.New("event payload must be an object")
	}
	if ev.Metadata == nil {
		return errors.New("event metadata must be an object")
	}

	seq, err := numberToInt64(ev.Sequence)
	if err != nil {
		return fmt.Errorf("invalid sequence: %w", err)
	}
	if seq <= 0 {
		return errors.New("event sequence must be a positive integer")
	}
	if seq != *lastSeq+1 {
		return errors.New("non-contiguous sequence")
	}
	*lastSeq = seq

	schemaVersion, ok := ev.Metadata["schema_version"].(string)
	if !ok || strings.TrimSpace(schemaVersion) == "" {
		return errors.New("missing metadata.schema_version")
	}
	if schemaVersion != replaySchemaVersion {
		return fmt.Errorf("unsupported schema_version: %s", schemaVersion)
	}

	eventRunID, ok := ev.Metadata["run_id"].(string)
	if !ok || strings.TrimSpace(eventRunID) == "" {
		return errors.New("missing metadata.run_id")
	}
	if *runID == "" {
		*runID = eventRunID
	} else if eventRunID != *runID {
		return errors.New("run_id mismatch")
	}

	if len(ev.Checksum) != 64 {
		return errors.New("event checksum must be a 64-char hex string")
	}
	if _, err := hex.DecodeString(ev.Checksum); err != nil {
		return errors.New("event checksum must be hex")
	}

	expected, err := computeReplayChecksum(ev)
	if err != nil {
		return fmt.Errorf("compute checksum: %w", err)
	}
	if ev.Checksum != expected {
		return errors.New("event checksum mismatch")
	}

	return nil
}

func computeReplayChecksum(ev replayEvent) (string, error) {
	seed, err := numberToInt64(ev.Seed)
	if err != nil {
		return "", err
	}
	seq, err := numberToInt64(ev.Sequence)
	if err != nil {
		return "", err
	}

	base := map[string]interface{}{
		"id":        ev.ID,
		"timestamp": ev.Timestamp,
		"kind":      ev.Kind,
		"seed":      seed,
		"payload":   ev.Payload,
		"metadata":  ev.Metadata,
		"sequence":  seq,
	}

	normalized, err := normalizeForChecksum(base)
	if err != nil {
		return "", err
	}

	encoded, err := json.Marshal(normalized)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:]), nil
}

func normalizeForChecksum(v interface{}) (interface{}, error) {
	switch x := v.(type) {
	case map[string]interface{}:
		out := make(map[string]interface{}, len(x))
		for k, val := range x {
			norm, err := normalizeForChecksum(val)
			if err != nil {
				return nil, err
			}
			out[k] = norm
		}
		return out, nil
	case []interface{}:
		out := make([]interface{}, len(x))
		for i := range x {
			norm, err := normalizeForChecksum(x[i])
			if err != nil {
				return nil, err
			}
			out[i] = norm
		}
		return out, nil
	case json.Number:
		if i, err := x.Int64(); err == nil {
			return i, nil
		}
		f, err := x.Float64()
		if err != nil {
			return nil, err
		}
		return f, nil
	default:
		return v, nil
	}
}

func numberToInt64(n json.Number) (int64, error) {
	if n == "" {
		return 0, errors.New("number is required")
	}
	if i, err := n.Int64(); err == nil {
		return i, nil
	}
	f, err := strconv.ParseFloat(n.String(), 64)
	if err != nil {
		return 0, err
	}
	if f != float64(int64(f)) {
		return 0, errors.New("number must be integer")
	}
	return int64(f), nil
}

func parseReplayTimestamp(raw string) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}, errors.New("timestamp is required")
	}
	if ts, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return ts, nil
	}
	return time.Parse(time.RFC3339, raw)
}
