package eventbus

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/syntha/apps/api/security"
)

type LocalAdapter struct {
	Dir string
}

func NewLocalAdapter(dir string) *LocalAdapter {
	return &LocalAdapter{Dir: dir}
}

func (l *LocalAdapter) Publish(ctx context.Context, e Event) error {
	if ctx != nil {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
	}
	if l.Dir == "" {
		l.Dir = filepath.Join("data", "events")
	}
	if err := os.MkdirAll(l.Dir, 0o755); err != nil {
		return fmt.Errorf("mkdir: %w", err)
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
	fpath := filepath.Join(l.Dir, "events.jsonl")
	f, err := os.OpenFile(fpath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return fmt.Errorf("open events file: %w", err)
	}
	defer f.Close()
	if _, err := f.Write(append(b, '\n')); err != nil {
		return fmt.Errorf("append event: %w", err)
	}
	if incEventPublished != nil {
		incEventPublished()
	}
	return nil
}
