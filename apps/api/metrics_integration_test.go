package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	kafka "github.com/segmentio/kafka-go"
	"github.com/syntha/apps/api/eventbus"
	"github.com/syntha/apps/api/metrics"
)

// flakyWriter fails N times then succeeds
type flakyWriter struct {
	mu    sync.Mutex
	fails int
	calls int
}

func (f *flakyWriter) WriteMessages(ctx context.Context, msgs ...kafka.Message) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	if f.calls <= f.fails {
		return errors.New("simulated write failure")
	}
	return nil
}

func (f *flakyWriter) Close() error { return nil }

func TestRedpandaAdapterRetriesEmitMetrics(t *testing.T) {
	// start metrics server on test port
	metrics.StartMetricsServer(":9093")

	// wire eventbus hooks to metrics
	eventbus.SetMetricsHooks(func(adapter string) {
		metrics.IncPublishRetries(adapter)
	}, func() {
		metrics.IncEventPublished()
	})

	// create adapter with flaky writer that fails 3 times
	fw := &flakyWriter{fails: 3}
	ra := &eventbus.RedpandaAdapter{
		Writer:      fw,
		Topic:       "test-topic",
		MaxRetries:  5,
		BaseBackoff: 1 * time.Millisecond,
		MaxBackoff:  10 * time.Millisecond,
	}

	// publish an event; should succeed after retries
	ev := eventbus.Event{ID: "evt1", Kind: "test", Timestamp: time.Now().UTC()}
	if err := ra.Publish(context.Background(), ev); err != nil {
		t.Fatalf("Publish failed: %v", err)
	}

	// allow metrics handler to update
	time.Sleep(50 * time.Millisecond)

	// fetch metrics
	resp, err := http.Get("http://localhost:9093/metrics")
	if err != nil {
		t.Fatalf("failed to fetch metrics: %v", err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("failed reading metrics body: %v", err)
	}
	body := string(b)

	// expect publish retries = 3 and events published = 1
	if !strings.Contains(body, "syntha_publish_retries_total{adapter=\"redpanda\"} 3") {
		t.Fatalf("expected 3 retries in metrics, got:\n%s", body)
	}
	if !strings.Contains(body, "syntha_events_published_total 1") {
		t.Fatalf("expected 1 event published in metrics, got:\n%s", body)
	}
}
