package metrics

import (
	"context"
	"log"
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

var (
	PromptInjectionCounter = prometheus.NewCounter(
		prometheus.CounterOpts{Namespace: "syntha", Name: "prompt_injection_total", Help: "Number of prompt injection detections."},
	)
	PublishRetriesCounter = prometheus.NewCounterVec(
		prometheus.CounterOpts{Namespace: "syntha", Name: "publish_retries_total", Help: "Number of publish retries by adapter."},
		[]string{"adapter"},
	)
	EventsPublishedCounter = prometheus.NewCounter(
		prometheus.CounterOpts{Namespace: "syntha", Name: "events_published_total", Help: "Number of events successfully published."},
	)
	// OpenTelemetry instruments (optional)
	otelMeter           metric.Meter
	otelPromptInjection metric.Int64Counter
	otelPublishRetries  metric.Int64Counter
	otelEventsPublished metric.Int64Counter
)

func init() {
	prometheus.MustRegister(PromptInjectionCounter)
	prometheus.MustRegister(PublishRetriesCounter)
	prometheus.MustRegister(EventsPublishedCounter)
}

// StartMetricsServer starts an HTTP server exposing Prometheus metrics on the given address.
func StartMetricsServer(addr string) {
	go func() {
		mux := http.NewServeMux()
		mux.Handle("/metrics", promhttp.Handler())
		log.Printf("metrics: listening on %s/metrics", addr)
		if err := http.ListenAndServe(addr, mux); err != nil {
			log.Printf("metrics: server exited: %v", err)
		}
	}()
}

// Helpers
func IncPromptInjection() {
	PromptInjectionCounter.Inc()
	IncPromptInjectionOtel(context.Background())
}
func IncPublishRetries(adapter string) {
	PublishRetriesCounter.WithLabelValues(adapter).Inc()
	IncPublishRetriesOtel(context.Background(), adapter)
}
func IncEventPublished() {
	EventsPublishedCounter.Inc()
	IncEventPublishedOtel(context.Background())
}

// InitOtel initializes OpenTelemetry metric instruments using the global MeterProvider.
func InitOtel(ctx context.Context) error {
	otelMeter = otel.Meter("syntha")
	var err error
	otelPromptInjection, err = otelMeter.Int64Counter("syntha_prompt_injection_total")
	if err != nil {
		return err
	}
	otelPublishRetries, err = otelMeter.Int64Counter("syntha_publish_retries_total")
	if err != nil {
		return err
	}
	otelEventsPublished, err = otelMeter.Int64Counter("syntha_events_published_total")
	if err != nil {
		return err
	}
	return nil
}

// OTEL-aware increment helpers
func IncPromptInjectionOtel(ctx context.Context) {
	if otelPromptInjection != nil {
		otelPromptInjection.Add(ctx, 1)
	}
}
func IncPublishRetriesOtel(ctx context.Context, adapter string) {
	if otelPublishRetries != nil {
		otelPublishRetries.Add(ctx, 1, metric.WithAttributes(attribute.String("adapter", adapter)))
	}
}
func IncEventPublishedOtel(ctx context.Context) {
	if otelEventsPublished != nil {
		otelEventsPublished.Add(ctx, 1)
	}
}
