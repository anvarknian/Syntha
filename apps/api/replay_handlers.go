package main

import (
	"net/http"
	"os"
	"path/filepath"
)

type replayHTTPService struct {
	dataDir string
}

func newReplayHTTPService(dataDir string) *replayHTTPService {
	return &replayHTTPService{dataDir: dataDir}
}

func (s *replayHTTPService) handleList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "only GET is supported")
		return
	}
	files, err := listReplayFileNames(s.dataDir)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "replay_list_failed", err.Error())
		return
	}
	summaries := make([]replayFileSummary, 0, len(files))
	for _, file := range files {
		report, err := validateReplayFileDetailed(r.Context(), s.dataDir, file)
		if err != nil {
			filePath := filepath.Join(s.dataDir, "replays", file)
			info, statErr := os.Stat(filePath)
			summary := replayFileSummary{FileName: file, RunID: "unknown", EventKinds: map[string]int{}}
			if statErr == nil {
				summary.SizeBytes = info.Size()
				summary.ModifiedAt = info.ModTime().UTC()
			}
			summaries = append(summaries, summary)
			continue
		}
		summaries = append(summaries, report.Summary)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"files":     files,
		"summaries": summaries,
	})
}

func (s *replayHTTPService) handleIntegrity(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "only GET is supported")
		return
	}
	report, err := validateReplayFileDetailed(r.Context(), s.dataDir, r.URL.Query().Get("file"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "integrity_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, report)
}
