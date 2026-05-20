package eventbus

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	kafka "github.com/segmentio/kafka-go"
)

type flakyWriter struct {
	failUntil int32
	attempts  int32
}

func (f *flakyWriter) WriteMessages(ctx context.Context, msgs ...kafka.Message) error {
	atomic.AddInt32(&f.attempts, 1)
	if atomic.LoadInt32(&f.attempts) <= atomic.LoadInt32(&f.failUntil) {
		return errors.New("simulated transient error")
	}
	return nil
}

func (f *flakyWriter) Close() error { return nil }

func TestRedpandaAdapterRetries(t *testing.T) {
	fw := &flakyWriter{failUntil: 2}
	adapter := &RedpandaAdapter{
		Writer:      fw,
		Topic:       "test",
		MaxRetries:  5,
		BaseBackoff: 10 * time.Millisecond,
		MaxBackoff:  100 * time.Millisecond,
	}
	ev := Event{ID: "1", Kind: "test"}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := adapter.Publish(ctx, ev); err != nil {
		t.Fatalf("publish failed: %v", err)
	}
	if atomic.LoadInt32(&fw.attempts) < 3 {
		t.Fatalf("expected at least 3 attempts, got %d", fw.attempts)
	}
}
