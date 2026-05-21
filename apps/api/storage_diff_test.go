package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStorageAppendEventAndOverview(t *testing.T) {
	dataDir := t.TempDir()
	svc := newStorageService(dataDir)

	body := bytes.NewBufferString(`{"stream":"audit","event":{"kind":"user_login","payload":{"email":"alice@example.com"}}}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/storage/events", body)
	w := httptest.NewRecorder()

	svc.handleEvents(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	eventsFile := filepath.Join(dataDir, "events", "audit.jsonl")
	raw, err := os.ReadFile(eventsFile)
	if err != nil {
		t.Fatalf("expected appended event file: %v", err)
	}
	if !bytes.Contains(raw, []byte("user_login")) {
		t.Fatalf("expected event payload in jsonl, got %s", raw)
	}

	overview, err := svc.overview(context.Background())
	if err != nil {
		t.Fatalf("overview failed: %v", err)
	}
	if overview.Collections["events"].FileCount != 1 {
		t.Fatalf("expected one events file, got %+v", overview.Collections["events"])
	}
}

func TestReplayDiffDetectsChangedAndAddedEvents(t *testing.T) {
	dataDir := t.TempDir()
	replayDir := filepath.Join(dataDir, "replays")
	if err := os.MkdirAll(replayDir, 0o755); err != nil {
		t.Fatal(err)
	}

	base := replayEvent{
		ID:        "evt-1",
		Timestamp: "2026-05-21T00:00:00Z",
		Kind:      "browser_action",
		Seed:      json.Number("7"),
		Payload:   map[string]interface{}{"url": "https://example.com"},
		Metadata:  map[string]interface{}{"run_id": "base-run", "schema_version": "v1"},
		Sequence:  json.Number("1"),
	}
	targetChanged := base
	targetChanged.Payload = map[string]interface{}{"url": "https://example.org"}
	targetChanged.Metadata = map[string]interface{}{"run_id": "target-run", "schema_version": "v1"}
	added := replayEvent{
		ID:        "evt-2",
		Timestamp: "2026-05-21T00:00:01Z",
		Kind:      "assertion",
		Seed:      json.Number("8"),
		Payload:   map[string]interface{}{"ok": true},
		Metadata:  map[string]interface{}{"run_id": "target-run", "schema_version": "v1"},
		Sequence:  json.Number("2"),
	}
	writeReplayFixture(t, filepath.Join(replayDir, "base.jsonl"), []replayEvent{base})
	writeReplayFixture(t, filepath.Join(replayDir, "target.jsonl"), []replayEvent{targetChanged, added})

	report, err := newReplayDiffService(dataDir).diff(context.Background(), replayDiffRequest{
		Base:   "base.jsonl",
		Target: "target.jsonl",
		Mode:   "execution",
		Limit:  10,
	})
	if err != nil {
		t.Fatalf("diff failed: %v", err)
	}
	if report.Summary.Changed != 1 || report.Summary.Added != 1 || report.Summary.Removed != 0 {
		t.Fatalf("unexpected summary: %+v", report.Summary)
	}
	if len(report.Changes) != 2 {
		t.Fatalf("expected two changes, got %+v", report.Changes)
	}
}

func TestLocalReplayRecorderAppendsValidDashboardEvent(t *testing.T) {
	dataDir := t.TempDir()
	recorder := newLocalReplayRecorder(dataDir)

	result, err := recorder.appendScenarioCreated(
		context.Background(),
		"scenario-1",
		42,
		time.Date(2026, 5, 21, 14, 45, 0, 0, time.UTC),
		map[string]interface{}{"task": map[string]interface{}{"objective": "test send event"}},
	)
	if err != nil {
		t.Fatalf("append scenario event: %v", err)
	}
	if result.FileName != dashboardReplayFile || result.Sequence != 1 {
		t.Fatalf("unexpected append result: %+v", result)
	}

	report, err := validateReplayFileDetailed(context.Background(), dataDir, dashboardReplayFile)
	if err != nil {
		t.Fatalf("validate replay: %v", err)
	}
	if report.Status != "ok" || report.Summary.EventCount != 1 || report.Summary.ValidChecksums != 1 {
		t.Fatalf("unexpected validation report: %+v", report)
	}
}

func writeReplayFixture(t *testing.T, path string, events []replayEvent) {
	t.Helper()
	var out bytes.Buffer
	for _, ev := range events {
		checksum, err := computeReplayChecksum(ev)
		if err != nil {
			t.Fatalf("checksum failed: %v", err)
		}
		ev.Checksum = checksum
		encoded, err := json.Marshal(ev)
		if err != nil {
			t.Fatalf("marshal event: %v", err)
		}
		out.Write(encoded)
		out.WriteByte('\n')
	}
	if err := os.WriteFile(path, out.Bytes(), 0o644); err != nil {
		t.Fatalf("write replay fixture: %v", err)
	}
}
