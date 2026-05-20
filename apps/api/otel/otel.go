package otel

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	otlpmetric "go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	metric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.12.0"
)

// Init initializes OpenTelemetry tracing with OTLP HTTP exporter.
func Init(ctx context.Context) func(context.Context) error {
	baseEndpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if baseEndpoint == "" {
		baseEndpoint = "http://otel-collector:4318"
	}
	traceEndpoint := os.Getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
	if traceEndpoint == "" {
		traceEndpoint = strings.TrimRight(baseEndpoint, "/") + "/v1/traces"
	}
	exporter, err := otlptracehttp.New(ctx, otlptracehttp.WithEndpointURL(traceEndpoint))
	if err != nil {
		log.Printf("otel: failed to create exporter: %v", err)
		return func(context.Context) error { return nil }
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceNameKey.String("syntha-api"),
		),
	)
	if err != nil {
		log.Printf("otel: failed to create resource: %v", err)
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)

	metricEndpoint := os.Getenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT")
	if metricEndpoint == "" {
		metricEndpoint = strings.TrimRight(baseEndpoint, "/") + "/v1/metrics"
	}
	mexp, mErr := otlpmetric.New(ctx, otlpmetric.WithEndpointURL(metricEndpoint))

	var mp *metric.MeterProvider
	if mErr != nil {
		log.Printf("otel: failed to create metric exporter: %v", mErr)
	} else {
		reader := metric.NewPeriodicReader(mexp, metric.WithInterval(10*time.Second))
		mp = metric.NewMeterProvider(metric.WithReader(reader), metric.WithResource(res))
		otel.SetMeterProvider(mp)
	}

	return func(ctx context.Context) error {
		shutdownCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		if mp != nil {
			if err := mp.Shutdown(shutdownCtx); err != nil {
				log.Printf("otel: meter provider shutdown error: %v", err)
			}
		}
		if err := tp.Shutdown(shutdownCtx); err != nil {
			log.Printf("otel: tracer provider shutdown error: %v", err)
		}
		return nil
	}
}
