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
	"path/filepath"
	"sort"
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

type replayEventRecord struct {
	Event  replayEvent `json:"event"`
	Line   int         `json:"line"`
	Valid  bool        `json:"valid"`
	Issues []string    `json:"issues,omitempty"`
}

type replayFileSummary struct {
	FileName         string         `json:"file_name"`
	RunID            string         `json:"run_id"`
	EventCount       int            `json:"event_count"`
	ValidChecksums   int            `json:"valid_checksums"`
	InvalidChecksums int            `json:"invalid_checksums"`
	FirstTimestamp   string         `json:"first_timestamp,omitempty"`
	LastTimestamp    string         `json:"last_timestamp,omitempty"`
	EventKinds       map[string]int `json:"event_kinds"`
	SizeBytes        int64          `json:"size_bytes"`
	ModifiedAt       time.Time      `json:"modified_at"`
}

type replayIntegrityReport struct {
	FileName string              `json:"file_name"`
	Summary  replayFileSummary   `json:"summary"`
	Events   []replayEventRecord `json:"events"`
	Issues   []string            `json:"issues"`
	Status   string              `json:"status"`
}

func replayPath(dataDir, fileName string) (string, error) {
	if strings.TrimSpace(fileName) == "" {
		files, err := listReplayFileNames(dataDir)
		if err != nil {
			return "", err
		}
		if len(files) == 0 {
			return filepath.Join(dataDir, "replays", "test-replay.jsonl"), nil
		}
		fileName = files[len(files)-1]
	}
	return safeFilePath(filepath.Join(dataDir, "replays"), fileName, ".jsonl")
}

func listReplayFileNames(dataDir string) ([]string, error) {
	dir := filepath.Join(dataDir, "replays")
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read replay dir: %w", err)
	}
	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		files = append(files, entry.Name())
	}
	sort.Strings(files)
	return files, nil
}

func readReplayEvents(ctx context.Context, replayFile string) ([]replayEventRecord, error) {
	file, err := os.Open(replayFile)
	if err != nil {
		return nil, fmt.Errorf("open replay file: %w", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 1024), 16*1024*1024)

	var records []replayEventRecord
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
		record := replayEventRecord{Line: lineNo}
		if err != nil {
			record.Valid = false
			record.Issues = append(record.Issues, err.Error())
		} else {
			record.Event = ev
		}
		records = append(records, record)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan replay file: %w", err)
	}
	return records, nil
}

func validateReplayFileDetailed(ctx context.Context, dataDir, fileName string) (replayIntegrityReport, error) {
	replayFile, err := replayPath(dataDir, fileName)
	if err != nil {
		return replayIntegrityReport{}, err
	}

	records, err := readReplayEvents(ctx, replayFile)
	if err != nil {
		return replayIntegrityReport{}, err
	}

	info, statErr := os.Stat(replayFile)
	if statErr != nil {
		return replayIntegrityReport{}, fmt.Errorf("stat replay file: %w", statErr)
	}

	report := replayIntegrityReport{
		FileName: filepath.Base(replayFile),
		Issues:   []string{},
		Events:   []replayEventRecord{},
		Summary: replayFileSummary{
			FileName:   filepath.Base(replayFile),
			RunID:      "unknown",
			EventKinds: map[string]int{},
			SizeBytes:  info.Size(),
			ModifiedAt: info.ModTime().UTC(),
		},
		Status: "ok",
	}

	var (
		lastSeq       int64
		lastTimestamp time.Time
		runID         string
	)

	for idx := range records {
		record := &records[idx]
		if len(record.Issues) == 0 {
			record.Issues = validateReplayEventAgainstChain(record.Event, &lastSeq, &lastTimestamp, &runID)
			record.Valid = len(record.Issues) == 0
		}

		if record.Event.Kind != "" {
			report.Summary.EventKinds[record.Event.Kind]++
		}
		if report.Summary.FirstTimestamp == "" && record.Event.Timestamp != "" {
			report.Summary.FirstTimestamp = record.Event.Timestamp
		}
		if record.Event.Timestamp != "" {
			report.Summary.LastTimestamp = record.Event.Timestamp
		}
		if record.Valid {
			report.Summary.ValidChecksums++
		} else {
			report.Summary.InvalidChecksums++
			for _, issue := range record.Issues {
				report.Issues = append(report.Issues, fmt.Sprintf("line %d: %s", record.Line, issue))
			}
		}
	}

	report.Events = records
	report.Summary.EventCount = len(records)
	if runID != "" {
		report.Summary.RunID = runID
	}
	if len(records) == 0 {
		report.Status = "failed"
		report.Issues = append(report.Issues, "replay file has no events")
	} else if report.Summary.InvalidChecksums > 0 {
		report.Status = "failed"
	}

	return report, nil
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

func validateReplayEventAgainstChain(ev replayEvent, lastSeq *int64, lastTimestamp *time.Time, runID *string) []string {
	var issues []string
	if strings.TrimSpace(ev.ID) == "" {
		issues = append(issues, "missing event id")
	}
	if strings.TrimSpace(ev.Kind) == "" {
		issues = append(issues, "missing event kind")
	}

	ts, err := parseReplayTimestamp(ev.Timestamp)
	if err != nil {
		issues = append(issues, fmt.Sprintf("invalid timestamp: %v", err))
	} else {
		if !lastTimestamp.IsZero() && ts.Before(*lastTimestamp) {
			issues = append(issues, "non-monotonic timestamp")
		}
		*lastTimestamp = ts
	}

	if _, err := numberToInt64(ev.Seed); err != nil {
		issues = append(issues, fmt.Sprintf("invalid seed: %v", err))
	}
	if ev.Payload == nil {
		issues = append(issues, "event payload must be an object")
	}
	if ev.Metadata == nil {
		issues = append(issues, "event metadata must be an object")
	}

	seq, err := numberToInt64(ev.Sequence)
	if err != nil {
		issues = append(issues, fmt.Sprintf("invalid sequence: %v", err))
	} else {
		if seq <= 0 {
			issues = append(issues, "event sequence must be a positive integer")
		}
		if seq != *lastSeq+1 {
			issues = append(issues, "non-contiguous sequence")
		}
		*lastSeq = seq
	}

	if ev.Metadata != nil {
		schemaVersion, ok := ev.Metadata["schema_version"].(string)
		if !ok || strings.TrimSpace(schemaVersion) == "" {
			issues = append(issues, "missing metadata.schema_version")
		} else if schemaVersion != replaySchemaVersion {
			issues = append(issues, fmt.Sprintf("unsupported schema_version: %s", schemaVersion))
		}

		eventRunID, ok := ev.Metadata["run_id"].(string)
		if !ok || strings.TrimSpace(eventRunID) == "" {
			issues = append(issues, "missing metadata.run_id")
		} else if *runID == "" {
			*runID = eventRunID
		} else if eventRunID != *runID {
			issues = append(issues, "run_id mismatch")
		}
	}

	if len(ev.Checksum) != 64 {
		issues = append(issues, "event checksum must be a 64-char hex string")
	} else if _, err := hex.DecodeString(ev.Checksum); err != nil {
		issues = append(issues, "event checksum must be hex")
	} else {
		expected, err := computeReplayChecksum(ev)
		if err != nil {
			issues = append(issues, fmt.Sprintf("compute checksum: %v", err))
		} else if ev.Checksum != expected {
			issues = append(issues, "event checksum mismatch")
		}
	}

	return issues
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

func eventComparableHash(ev replayEvent) (string, error) {
	normalized, err := normalizeForChecksum(map[string]interface{}{
		"id":        ev.ID,
		"timestamp": ev.Timestamp,
		"kind":      ev.Kind,
		"seed":      ev.Seed,
		"payload":   ev.Payload,
		"metadata":  ev.Metadata,
		"sequence":  ev.Sequence,
	})
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
