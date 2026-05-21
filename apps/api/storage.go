package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/syntha/apps/api/security"
)

const maxStoredEventBytes = 1 << 20

var safeStreamName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$`)

type storageService struct {
	dataDir string
}

type storageFile struct {
	Name       string    `json:"name"`
	Path       string    `json:"path"`
	SizeBytes  int64     `json:"size_bytes"`
	ModifiedAt time.Time `json:"modified_at"`
	SHA256     string    `json:"sha256,omitempty"`
}

type storageCollection struct {
	Name       string        `json:"name"`
	Directory  string        `json:"directory"`
	Files      []storageFile `json:"files"`
	FileCount  int           `json:"file_count"`
	TotalBytes int64         `json:"total_bytes"`
}

type storageOverview struct {
	Root        string                       `json:"root"`
	GeneratedAt time.Time                    `json:"generated_at"`
	Collections map[string]storageCollection `json:"collections"`
	TotalBytes  int64                        `json:"total_bytes"`
}

type storageHealth struct {
	Status      string            `json:"status"`
	Root        string            `json:"root"`
	Writable    bool              `json:"writable"`
	CheckedAt   time.Time         `json:"checked_at"`
	Collections map[string]string `json:"collections"`
	Errors      []string          `json:"errors,omitempty"`
}

type retentionResult struct {
	DeletedFiles   []string  `json:"deleted_files"`
	DeletedBytes   int64     `json:"deleted_bytes"`
	KeptFiles      int       `json:"kept_files"`
	Cutoff         time.Time `json:"cutoff"`
	DryRun         bool      `json:"dry_run"`
	PreserveJSONL  bool      `json:"preserve_jsonl"`
	CollectionName string    `json:"collection_name,omitempty"`
}

type eventAppendRequest struct {
	Stream string                 `json:"stream"`
	Event  map[string]interface{} `json:"event"`
}

type eventAppendResponse struct {
	FileName   string    `json:"file_name"`
	LineBytes  int       `json:"line_bytes"`
	AppendedAt time.Time `json:"appended_at"`
}

func newStorageService(dataDir string) *storageService {
	return &storageService{dataDir: dataDir}
}

func (s *storageService) handleOverview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "only GET is supported")
		return
	}
	overview, err := s.overview(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_overview_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, overview)
}

func (s *storageService) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "only GET is supported")
		return
	}
	health := s.health()
	status := http.StatusOK
	if health.Status != "ok" {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, health)
}

func (s *storageService) handleEvents(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		collection, err := s.collection("events", true)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "storage_events_failed", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, collection)
	case http.MethodPost:
		response, err := s.appendEvent(r.Context(), r.Body)
		if err != nil {
			status := http.StatusBadRequest
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				status = http.StatusGatewayTimeout
			}
			writeError(w, status, "event_append_failed", err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, response)
	default:
		w.Header().Set("Allow", strings.Join([]string{http.MethodGet, http.MethodPost}, ", "))
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "only GET and POST are supported")
	}
}

func (s *storageService) handleArtifacts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "only GET is supported")
		return
	}
	kind := r.URL.Query().Get("kind")
	collectionName := "artifacts"
	if kind == "dom" || kind == "dom-snapshots" {
		collectionName = "dom-snapshots"
	}
	collection, err := s.collection(collectionName, false)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_artifacts_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, collection)
}

func (s *storageService) handleRetention(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "only POST is supported")
		return
	}
	var body struct {
		Collection    string `json:"collection"`
		MaxAgeDays    int    `json:"max_age_days"`
		DryRun        bool   `json:"dry_run"`
		PreserveJSONL *bool  `json:"preserve_jsonl"`
	}
	defer r.Body.Close()
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "retention request must be JSON")
		return
	}
	if body.MaxAgeDays <= 0 {
		writeError(w, http.StatusBadRequest, "invalid_retention", "max_age_days must be positive")
		return
	}
	preserveJSONL := true
	if body.PreserveJSONL != nil {
		preserveJSONL = *body.PreserveJSONL
	}
	result, err := s.applyRetention(body.Collection, body.MaxAgeDays, body.DryRun, preserveJSONL)
	if err != nil {
		writeError(w, http.StatusBadRequest, "retention_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *storageService) overview(ctx context.Context) (storageOverview, error) {
	names := []string{"events", "replays", "artifacts", "dom-snapshots"}
	overview := storageOverview{
		Root:        s.dataDir,
		GeneratedAt: time.Now().UTC(),
		Collections: make(map[string]storageCollection, len(names)),
	}
	for _, name := range names {
		if err := ctx.Err(); err != nil {
			return storageOverview{}, err
		}
		collection, err := s.collection(name, name == "events" || name == "replays")
		if err != nil {
			return storageOverview{}, err
		}
		overview.Collections[name] = collection
		overview.TotalBytes += collection.TotalBytes
	}
	return overview, nil
}

func (s *storageService) health() storageHealth {
	health := storageHealth{
		Status:      "ok",
		Root:        s.dataDir,
		CheckedAt:   time.Now().UTC(),
		Collections: map[string]string{},
	}
	if err := os.MkdirAll(s.dataDir, 0o755); err != nil {
		health.Status = "degraded"
		health.Errors = append(health.Errors, fmt.Sprintf("root not writable: %v", err))
	} else {
		probe := filepath.Join(s.dataDir, ".syntha-storage-health")
		if err := os.WriteFile(probe, []byte(time.Now().UTC().Format(time.RFC3339Nano)), 0o600); err != nil {
			health.Status = "degraded"
			health.Errors = append(health.Errors, fmt.Sprintf("write probe failed: %v", err))
		} else {
			health.Writable = true
			_ = os.Remove(probe)
		}
	}

	for _, name := range []string{"events", "replays", "artifacts", "dom-snapshots"} {
		dir := filepath.Join(s.dataDir, name)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			health.Status = "degraded"
			health.Collections[name] = "error"
			health.Errors = append(health.Errors, fmt.Sprintf("%s: %v", name, err))
		} else {
			health.Collections[name] = "ok"
		}
	}
	return health
}

func (s *storageService) collection(name string, includeHash bool) (storageCollection, error) {
	dir, err := safeCollectionDir(s.dataDir, name)
	if err != nil {
		return storageCollection{}, err
	}
	collection := storageCollection{
		Name:      name,
		Directory: dir,
		Files:     []storageFile{},
	}
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return collection, nil
	}
	if err != nil {
		return storageCollection{}, fmt.Errorf("read collection %s: %w", name, err)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return storageCollection{}, fmt.Errorf("stat %s: %w", entry.Name(), err)
		}
		file := storageFile{
			Name:       entry.Name(),
			Path:       filepath.Join(name, entry.Name()),
			SizeBytes:  info.Size(),
			ModifiedAt: info.ModTime().UTC(),
		}
		if includeHash {
			sum, err := sha256File(filepath.Join(dir, entry.Name()))
			if err != nil {
				return storageCollection{}, err
			}
			file.SHA256 = sum
		}
		collection.Files = append(collection.Files, file)
		collection.TotalBytes += file.SizeBytes
	}
	sort.Slice(collection.Files, func(i, j int) bool {
		return collection.Files[i].Name < collection.Files[j].Name
	})
	collection.FileCount = len(collection.Files)
	return collection, nil
}

func (s *storageService) appendEvent(ctx context.Context, body io.ReadCloser) (eventAppendResponse, error) {
	defer body.Close()
	raw, err := io.ReadAll(io.LimitReader(body, maxStoredEventBytes+1))
	if err != nil {
		return eventAppendResponse{}, fmt.Errorf("read event body: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return eventAppendResponse{}, err
	}
	if len(raw) > maxStoredEventBytes {
		return eventAppendResponse{}, fmt.Errorf("event body exceeds %d bytes", maxStoredEventBytes)
	}
	var req eventAppendRequest
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.UseNumber()
	if err := dec.Decode(&req); err != nil {
		return eventAppendResponse{}, fmt.Errorf("invalid JSON: %w", err)
	}
	if req.Stream == "" {
		req.Stream = "events"
	}
	if !safeStreamName.MatchString(req.Stream) {
		return eventAppendResponse{}, errors.New("stream must contain only letters, numbers, dots, underscores, or dashes")
	}
	if len(req.Event) == 0 {
		return eventAppendResponse{}, errors.New("event must be a JSON object")
	}
	req.Event = security.Scrub(req.Event).(map[string]interface{})

	dir := filepath.Join(s.dataDir, "events")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return eventAppendResponse{}, fmt.Errorf("mkdir events: %w", err)
	}
	fileName := req.Stream + ".jsonl"
	filePath := filepath.Join(dir, fileName)
	line, err := json.Marshal(req.Event)
	if err != nil {
		return eventAppendResponse{}, fmt.Errorf("marshal event: %w", err)
	}
	f, err := os.OpenFile(filePath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return eventAppendResponse{}, fmt.Errorf("open stream: %w", err)
	}
	defer f.Close()
	line = append(line, '\n')
	if _, err := f.Write(line); err != nil {
		return eventAppendResponse{}, fmt.Errorf("append event: %w", err)
	}
	return eventAppendResponse{
		FileName:   fileName,
		LineBytes:  len(line),
		AppendedAt: time.Now().UTC(),
	}, nil
}

func (s *storageService) applyRetention(collectionName string, maxAgeDays int, dryRun, preserveJSONL bool) (retentionResult, error) {
	collectionName = strings.TrimSpace(collectionName)
	if collectionName == "" {
		collectionName = "artifacts"
	}
	dir, err := safeCollectionDir(s.dataDir, collectionName)
	if err != nil {
		return retentionResult{}, err
	}
	cutoff := time.Now().UTC().Add(-time.Duration(maxAgeDays) * 24 * time.Hour)
	result := retentionResult{
		Cutoff:         cutoff,
		DryRun:         dryRun,
		PreserveJSONL:  preserveJSONL,
		CollectionName: collectionName,
		DeletedFiles:   []string{},
	}
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return result, nil
	}
	if err != nil {
		return retentionResult{}, fmt.Errorf("read collection: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return retentionResult{}, err
		}
		if preserveJSONL && strings.HasSuffix(entry.Name(), ".jsonl") {
			result.KeptFiles++
			continue
		}
		if info.ModTime().UTC().After(cutoff) {
			result.KeptFiles++
			continue
		}
		path := filepath.Join(dir, entry.Name())
		result.DeletedFiles = append(result.DeletedFiles, filepath.Join(collectionName, entry.Name()))
		result.DeletedBytes += info.Size()
		if !dryRun {
			if err := os.Remove(path); err != nil {
				return retentionResult{}, fmt.Errorf("delete %s: %w", entry.Name(), err)
			}
		}
	}
	sort.Strings(result.DeletedFiles)
	return result, nil
}

func safeCollectionDir(dataDir, name string) (string, error) {
	switch name {
	case "events", "replays", "artifacts", "dom-snapshots":
	default:
		return "", fmt.Errorf("unsupported collection %q", name)
	}
	dir := filepath.Join(dataDir, name)
	root := filepath.Clean(dataDir)
	clean := filepath.Clean(dir)
	if clean != root && !strings.HasPrefix(clean, root+string(os.PathSeparator)) {
		return "", errors.New("collection escapes data dir")
	}
	return clean, nil
}

func safeFilePath(root, fileName, requiredSuffix string) (string, error) {
	safeName := filepath.Base(fileName)
	if safeName != fileName || strings.Contains(fileName, string(os.PathSeparator)) {
		return "", errors.New("file name must not contain path separators")
	}
	if requiredSuffix != "" && !strings.HasSuffix(safeName, requiredSuffix) {
		return "", fmt.Errorf("file must end with %s", requiredSuffix)
	}
	filePath := filepath.Clean(filepath.Join(root, safeName))
	cleanRoot := filepath.Clean(root)
	if filePath != cleanRoot && !strings.HasPrefix(filePath, cleanRoot+string(os.PathSeparator)) {
		return "", errors.New("file escapes root")
	}
	return filePath, nil
}

func sha256File(filePath string) (string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", fmt.Errorf("open %s: %w", filepath.Base(filePath), err)
	}
	defer f.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, f); err != nil {
		return "", fmt.Errorf("hash %s: %w", filepath.Base(filePath), err)
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func intQuery(r *http.Request, key string, fallback int) int {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}
