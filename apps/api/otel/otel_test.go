package otel

import (
	"context"
	"testing"
)

func TestInitReturnsShutdown(t *testing.T) {
	shutdown := Init(context.Background())
	if shutdown == nil {
		t.Fatalf("expected shutdown function, got nil")
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown returned error: %v", err)
	}
}
