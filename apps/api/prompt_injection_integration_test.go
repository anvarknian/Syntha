package main

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Test that sending a scenario with prompt-injection increments the Prometheus metric.
func TestPromptInjectionIncrementsMetric(t *testing.T) {
	// start a prometheus handler on a random free port
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}
	addr := ln.Addr().String()
	go func() {
		_ = http.Serve(ln, promhttp.Handler())
	}()

	// create a request that triggers prompt injection
	body := "script: rm -rf /"
	req := httptest.NewRequest("POST", "/scenario", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/x-yaml")
	w := httptest.NewRecorder()

	// call handler directly
	scenarioHandler(w, req)

	// allow metrics to be recorded
	time.Sleep(20 * time.Millisecond)

	// fetch metrics from the prometheus handler
	resp, err := http.Get("http://" + addr + "/metrics")
	if err != nil {
		t.Fatalf("failed to fetch metrics: %v", err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("failed reading metrics body: %v", err)
	}
	bodyStr := string(b)

	if !strings.Contains(bodyStr, "syntha_prompt_injection_total") {
		t.Fatalf("expected syntha_prompt_injection_total in metrics, got:\n%s", bodyStr)
	}
}
