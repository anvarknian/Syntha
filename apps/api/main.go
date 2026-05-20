package main

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/syntha/apps/api/eventbus"
	"github.com/syntha/apps/api/metrics"
	otelinit "github.com/syntha/apps/api/otel"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"gopkg.in/yaml.v3"
)

const (
	maxScenarioBodyBytes = 1 << 20
	publishTimeout       = 5 * time.Second
)

var publisher eventbus.Publisher

func scenarioHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "only POST is supported")
		return
	}
	defer r.Body.Close()

	body, err := io.ReadAll(io.LimitReader(r.Body, maxScenarioBodyBytes+1))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read_failed", "failed to read request body")
		return
	}
	if len(body) == 0 {
		writeError(w, http.StatusBadRequest, "empty_body", "scenario payload cannot be empty")
		return
	}
	if len(body) > maxScenarioBodyBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "payload_too_large", "scenario payload exceeds 1MiB limit")
		return
	}

	var payload interface{}
	if err := yaml.Unmarshal(body, &payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_yaml", "invalid YAML payload")
		return
	}
	if detectPromptInjection(payload) {
		metrics.IncPromptInjection()
		writeError(w, http.StatusBadRequest, "prompt_injection", "prompt-injection detected in scenario payload")
		return
	}

	if publisher == nil {
		writeError(w, http.StatusServiceUnavailable, "event_bus_unavailable", "event publisher is not configured")
		return
	}

	scenarioID := uuid.NewString()
	seed := deterministicSeed(body)
	now := time.Now().UTC()
	ev := eventbus.Event{
		ID:        scenarioID,
		Timestamp: now,
		Kind:      "scenario_created",
		Seed:      seed,
		Payload:   map[string]interface{}{"body": payload},
		Metadata: map[string]string{
			"source":         "simulation-api",
			"schema_version": "v1",
		},
	}

	publishCtx, cancel := context.WithTimeout(r.Context(), publishTimeout)
	defer cancel()
	if err := publisher.Publish(publishCtx, ev); err != nil {
		log.Printf("scenario publish failed: %v", err)
		status := http.StatusServiceUnavailable
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			status = http.StatusGatewayTimeout
		}
		writeError(w, status, "event_publish_failed", "failed to persist scenario event")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"scenario_id": scenarioID,
		"seed":        seed,
		"created_at":  now.Format(time.RFC3339Nano),
	})
}

// detectPromptInjection scans decoded YAML payload for suspicious strings.
func detectPromptInjection(v interface{}) bool {
	// Collect all strings recursively and test for known suspicious patterns.
	suspicious := []string{"curl ", "wget ", "rm -rf", "<script>", "prompt(", "exec(", "base64 ", "eval("}
	stack := []interface{}{v}
	for len(stack) > 0 {
		item := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		switch x := item.(type) {
		case map[string]interface{}:
			for _, val := range x {
				stack = append(stack, val)
			}
		case []interface{}:
			for _, val := range x {
				stack = append(stack, val)
			}
		case string:
			lower := strings.ToLower(x)
			for _, pat := range suspicious {
				if strings.Contains(lower, pat) {
					return true
				}
			}
		}
	}
	return false
}

func deterministicSeed(payload []byte) int64 {
	sum := sha256.Sum256(payload)
	return int64(binary.BigEndian.Uint64(sum[:8]))
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("response encode failed: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]interface{}{
		"error": map[string]string{
			"code":    code,
			"message": message,
		},
	})
}

func main() {
	// Initialize OpenTelemetry.
	shutdown := otelinit.Init(context.Background())
	defer func() { _ = shutdown(context.Background()) }()

	if err := metrics.InitOtel(context.Background()); err != nil {
		log.Printf("metrics: failed to init otel instruments: %v", err)
	}
	metrics.StartMetricsServer(":9090")

	dataDir := os.Getenv("SYNTHA_DATA_DIR")
	if dataDir == "" {
		dataDir = "data"
	}
	eventsDir := dataDir + "/events"
	brokers := os.Getenv("REDPANDA_BROKERS")
	if brokers != "" {
		b := strings.Split(brokers, ",")
		topic := os.Getenv("REDPANDA_TOPIC")
		if topic == "" {
			topic = "syntha-events"
		}
		publisher = eventbus.NewRedpandaAdapter(b, topic)
	} else {
		publisher = eventbus.NewLocalAdapter(eventsDir)
	}

	eventbus.SetMetricsHooks(func(adapter string) {
		metrics.IncPublishRetries(adapter)
	}, func() {
		metrics.IncEventPublished()
	})

	mux := http.NewServeMux()
	mux.Handle("/scenario", otelhttp.NewHandler(http.HandlerFunc(scenarioHandler), "ScenarioHTTP"))

	server := &http.Server{
		Addr:    ":8080",
		Handler: mux,
	}
	log.Println("simulation-api listening on :8080")
	log.Fatal(server.ListenAndServe())
}
