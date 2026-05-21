package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

type replayDiffService struct {
	dataDir string
}

type replayDiffRequest struct {
	Base   string `json:"base"`
	Target string `json:"target"`
	Mode   string `json:"mode"`
	Limit  int    `json:"limit"`
}

type replayDiffSummary struct {
	BaseFile         string         `json:"base_file"`
	TargetFile       string         `json:"target_file"`
	Mode             string         `json:"mode"`
	Same             int            `json:"same"`
	Changed          int            `json:"changed"`
	Added            int            `json:"added"`
	Removed          int            `json:"removed"`
	BaseRunID        string         `json:"base_run_id"`
	TargetRunID      string         `json:"target_run_id"`
	BaseEventKinds   map[string]int `json:"base_event_kinds"`
	TargetEventKinds map[string]int `json:"target_event_kinds"`
	GeneratedAt      time.Time      `json:"generated_at"`
}

type replayDiffChange struct {
	Type           string `json:"type"`
	Key            string `json:"key"`
	BaseSequence   string `json:"base_sequence,omitempty"`
	TargetSequence string `json:"target_sequence,omitempty"`
	BaseKind       string `json:"base_kind,omitempty"`
	TargetKind     string `json:"target_kind,omitempty"`
	BaseID         string `json:"base_id,omitempty"`
	TargetID       string `json:"target_id,omitempty"`
	Reason         string `json:"reason,omitempty"`
}

type replayDiffReport struct {
	Summary replayDiffSummary  `json:"summary"`
	Changes []replayDiffChange `json:"changes"`
}

func newReplayDiffService(dataDir string) *replayDiffService {
	return &replayDiffService{dataDir: dataDir}
}

func (s *replayDiffService) handleDiff(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		req := replayDiffRequest{
			Base:   r.URL.Query().Get("base"),
			Target: r.URL.Query().Get("target"),
			Mode:   r.URL.Query().Get("mode"),
			Limit:  intQuery(r, "limit", 250),
		}
		report, err := s.diff(r.Context(), req)
		if err != nil {
			writeError(w, http.StatusBadRequest, "diff_failed", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, report)
	case http.MethodPost:
		var req replayDiffRequest
		defer r.Body.Close()
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json", "diff request must be JSON")
			return
		}
		if req.Limit == 0 {
			req.Limit = 250
		}
		report, err := s.diff(r.Context(), req)
		if err != nil {
			writeError(w, http.StatusBadRequest, "diff_failed", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, report)
	default:
		w.Header().Set("Allow", strings.Join([]string{http.MethodGet, http.MethodPost}, ", "))
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "only GET and POST are supported")
	}
}

func (s *replayDiffService) handleMode(mode string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "only GET is supported")
			return
		}
		req := replayDiffRequest{
			Base:   r.URL.Query().Get("base"),
			Target: r.URL.Query().Get("target"),
			Mode:   mode,
			Limit:  intQuery(r, "limit", 250),
		}
		report, err := s.diff(r.Context(), req)
		if err != nil {
			writeError(w, http.StatusBadRequest, "diff_failed", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, report)
	}
}

func (s *replayDiffService) diff(ctx context.Context, req replayDiffRequest) (replayDiffReport, error) {
	mode := strings.TrimSpace(req.Mode)
	if mode == "" {
		mode = "execution"
	}
	switch mode {
	case "branch", "trace", "execution":
	default:
		return replayDiffReport{}, fmt.Errorf("unsupported diff mode %q", mode)
	}
	if req.Limit <= 0 || req.Limit > 1000 {
		req.Limit = 250
	}

	basePath, err := replayPath(s.dataDir, req.Base)
	if err != nil {
		return replayDiffReport{}, err
	}
	targetPath, err := replayPath(s.dataDir, req.Target)
	if err != nil {
		return replayDiffReport{}, err
	}
	if filepath.Base(basePath) == filepath.Base(targetPath) {
		return replayDiffReport{}, fmt.Errorf("base and target replay files must differ")
	}

	baseReport, err := validateReplayFileDetailed(ctx, s.dataDir, filepath.Base(basePath))
	if err != nil {
		return replayDiffReport{}, err
	}
	targetReport, err := validateReplayFileDetailed(ctx, s.dataDir, filepath.Base(targetPath))
	if err != nil {
		return replayDiffReport{}, err
	}

	baseByKey := map[string]replayEventRecord{}
	targetByKey := map[string]replayEventRecord{}
	for _, record := range baseReport.Events {
		baseByKey[diffKey(mode, record.Event)] = record
	}
	for _, record := range targetReport.Events {
		targetByKey[diffKey(mode, record.Event)] = record
	}

	seen := map[string]bool{}
	var changes []replayDiffChange
	summary := replayDiffSummary{
		BaseFile:         filepath.Base(basePath),
		TargetFile:       filepath.Base(targetPath),
		Mode:             mode,
		BaseRunID:        baseReport.Summary.RunID,
		TargetRunID:      targetReport.Summary.RunID,
		BaseEventKinds:   baseReport.Summary.EventKinds,
		TargetEventKinds: targetReport.Summary.EventKinds,
		GeneratedAt:      time.Now().UTC(),
	}

	for key, base := range baseByKey {
		seen[key] = true
		target, ok := targetByKey[key]
		if !ok {
			summary.Removed++
			changes = appendLimited(changes, req.Limit, diffChange("removed", key, base, replayEventRecord{}, "event missing from target"))
			continue
		}
		same, reason := recordsEqual(base.Event, target.Event, mode)
		if same {
			summary.Same++
			continue
		}
		summary.Changed++
		changes = appendLimited(changes, req.Limit, diffChange("changed", key, base, target, reason))
	}
	for key, target := range targetByKey {
		if seen[key] {
			continue
		}
		summary.Added++
		changes = appendLimited(changes, req.Limit, diffChange("added", key, replayEventRecord{}, target, "event missing from base"))
	}

	if changes == nil {
		changes = []replayDiffChange{}
	}
	return replayDiffReport{Summary: summary, Changes: changes}, nil
}

func diffKey(mode string, ev replayEvent) string {
	switch mode {
	case "branch":
		if ev.ID != "" {
			return ev.ID
		}
	case "trace":
		if ev.Sequence != "" {
			return ev.Sequence.String()
		}
	}
	if ev.Sequence != "" {
		return ev.Sequence.String()
	}
	if ev.ID != "" {
		return ev.ID
	}
	return fmt.Sprintf("%s:%s", ev.Kind, ev.Timestamp)
}

func recordsEqual(base, target replayEvent, mode string) (bool, string) {
	if mode == "trace" {
		if base.Kind != target.Kind {
			return false, "kind changed"
		}
		if base.Timestamp != target.Timestamp {
			return false, "timestamp changed"
		}
		if base.ID != target.ID {
			return false, "event id changed"
		}
	}
	if base.Checksum != "" && target.Checksum != "" && base.Checksum == target.Checksum {
		return true, ""
	}
	baseHash, err := eventComparableHash(base)
	if err != nil {
		return false, fmt.Sprintf("base hash failed: %v", err)
	}
	targetHash, err := eventComparableHash(target)
	if err != nil {
		return false, fmt.Sprintf("target hash failed: %v", err)
	}
	if baseHash == targetHash {
		return true, ""
	}
	return false, "event content changed"
}

func appendLimited(changes []replayDiffChange, limit int, change replayDiffChange) []replayDiffChange {
	if len(changes) >= limit {
		return changes
	}
	return append(changes, change)
}

func diffChange(changeType, key string, base, target replayEventRecord, reason string) replayDiffChange {
	change := replayDiffChange{
		Type:   changeType,
		Key:    key,
		Reason: reason,
	}
	if base.Event.ID != "" {
		change.BaseID = base.Event.ID
		change.BaseKind = base.Event.Kind
		change.BaseSequence = base.Event.Sequence.String()
	}
	if target.Event.ID != "" {
		change.TargetID = target.Event.ID
		change.TargetKind = target.Event.Kind
		change.TargetSequence = target.Event.Sequence.String()
	}
	return change
}
