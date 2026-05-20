package eventbus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"strings"
	"time"

	kafka "github.com/segmentio/kafka-go"

	"github.com/syntha/apps/api/security"
)

// kafkaWriter defines the methods we need from kafka.Writer so we can test with fakes.
type kafkaWriter interface {
	WriteMessages(ctx context.Context, msgs ...kafka.Message) error
	Close() error
}

type RedpandaAdapter struct {
	Writer      kafkaWriter
	Topic       string
	MaxRetries  int           // maximum number of retry attempts
	BaseBackoff time.Duration // initial backoff duration
	MaxBackoff  time.Duration // maximum backoff duration
}

// NewRedpandaAdapter creates a new adapter given a list of brokers and a topic.
// The adapter uses sensible defaults for retries and backoff.
func NewRedpandaAdapter(brokers []string, topic string) *RedpandaAdapter {
	w := &kafka.Writer{
		Addr:         kafka.TCP(brokers...),
		Topic:        topic,
		Balancer:     &kafka.LeastBytes{},
		RequiredAcks: kafka.RequireOne,
		Async:        false,
	}
	return &RedpandaAdapter{
		Writer:      w,
		Topic:       topic,
		MaxRetries:  5,
		BaseBackoff: 100 * time.Millisecond,
		MaxBackoff:  5 * time.Second,
	}
}

// Publish writes the event to Redpanda with retries and exponential backoff.
func (r *RedpandaAdapter) Publish(ctx context.Context, e Event) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if r == nil || r.Writer == nil {
		return errors.New("redpanda adapter not configured")
	}
	if e.Timestamp.IsZero() {
		e.Timestamp = time.Now().UTC()
	}
	if e.Payload != nil {
		if scrubbed, ok := security.Scrub(e.Payload).(map[string]interface{}); ok {
			e.Payload = scrubbed
		}
	}
	b, err := json.Marshal(e)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}
	msg := kafka.Message{
		Key:   []byte(strings.Join([]string{e.Kind, e.ID}, "-")),
		Value: b,
	}

	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	attempt := 0
	backoff := r.BaseBackoff
	for {
		attempt++
		if err := r.Writer.WriteMessages(ctx, msg); err != nil {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}
			if attempt > r.MaxRetries {
				return fmt.Errorf("kafka write failed after %d attempts: %w", attempt-1, err)
			}

			jitter := time.Duration(rng.Int63n(int64(backoff)))
			sleep := backoff + jitter/2
			if sleep > r.MaxBackoff {
				sleep = r.MaxBackoff
			}
			if incRetryMetric != nil {
				incRetryMetric("redpanda")
			}
			if err := waitOrDone(ctx, sleep); err != nil {
				return err
			}

			backoff *= 2
			if backoff > r.MaxBackoff {
				backoff = r.MaxBackoff
			}
			continue
		}
		if incEventPublished != nil {
			incEventPublished()
		}
		return nil
	}
}

func (r *RedpandaAdapter) Close(ctx context.Context) error {
	if r == nil || r.Writer == nil {
		return nil
	}
	return r.Writer.Close()
}

func waitOrDone(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	if ctx == nil {
		<-timer.C
		return nil
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
