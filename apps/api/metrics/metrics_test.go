package metrics

import (
	"testing"

	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestPrometheusCounters(t *testing.T) {
	// Ensure counters start from 0
	if v := testutil.ToFloat64(PromptInjectionCounter); v != 0 {
		t.Fatalf("expected prompt injection counter 0, got %v", v)
	}

	IncPromptInjection()
	if v := testutil.ToFloat64(PromptInjectionCounter); v != 1 {
		t.Fatalf("expected prompt injection counter 1, got %v", v)
	}

	// Publish retries counter with label
	IncPublishRetries("redpanda")
	if v := testutil.ToFloat64(PublishRetriesCounter.WithLabelValues("redpanda")); v != 1 {
		t.Fatalf("expected publish retries counter 1, got %v", v)
	}

	// Events published counter
	IncEventPublished()
	if v := testutil.ToFloat64(EventsPublishedCounter); v != 1 {
		t.Fatalf("expected events published counter 1, got %v", v)
	}
}
